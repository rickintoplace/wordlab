// Slinky-Cut: Verorten, Quelle vorbereiten und schneiden – im Hintergrund-Thread.
// Die schweren Modelle laufen vorher in stages.js (je ein Worker pro Stufe).
//
//   {type:'lookup', key}                         → 'ready' | 'missing'
//   {type:'build', key, lang, words, post, V, vocab, voice16, voice48, music48, speakers}
//   {type:'mix', id, text, speaker, force}       → 'mixed'   (ein Satz, „Take“)
//   {type:'variants', id, text, speaker, force, wi} → 'variants' (Alternativen für Wort wi)
//   {type:'find', id, query, speaker}            → 'found'   (Bausteine: Wörter, Silben, Laute)

import { parseLexicon, pronounceSync } from './g2p.js';
import { alignWords } from './align.js';
import { buildSource, targetPhones, select, plan, render, wholeWords, wordKey, syllableBounds, splitWords } from './engine.js';
import { isVowel, soundClass, canon } from './phones.js';
import * as cache from './cache.js';

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);
const stage = (step, state, extra = {}) => post({ type: 'stage', step, state, ...extra });
const progress = (step, frac, detail = '') => post({ type: 'progress', step, frac, detail });
const SR = 48000;

let current = null;          // { lang, lex, src }

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'lookup') {
      const hit = await cache.get(m.key);
      if (hit?.alignVersion === ALIGN_VERSION) await prepare(hit);
      else if (hit?.raw) await build({ key: m.key, lang: hit.lang, ...hit.raw, voice16: hit.voice16, voice48: hit.voice48, music48: hit.music48 });
      else post({ type: 'missing' });
    } else if (m.type === 'build') await build(m);
    else if (m.type === 'mix') post(take(m), []);
    else if (m.type === 'variants') variants(m);
    else if (m.type === 'sylVariants') sylVariants(m);
    else if (m.type === 'phrase') post(phrase(m));
    else if (m.type === 'rewrite') post(rewrite(m));
    else if (m.type === 'find') post({ type: 'found', id: m.id, query: m.query, results: find(m.query, m.speaker) });
  } catch (err) {
    post({ type: 'error', id: m.id, message: err?.message ?? String(err), stack: err?.stack });
  }
};

// Ändert sich das Verorten (Lexikon, Grenzen), wird es aus den gespeicherten
// Modell-Ergebnissen neu gerechnet – ohne die langsamen Stufen zu wiederholen.
const ALIGN_VERSION = 4;   // 3: Lexikon wählt die Standardform (wir → [viːɐ̯], nicht [mɐ]); 4: Zahlen werden ausgesprochen

const lexicon = lang => fetch(`/data/slinky/lex-${lang}.txt?v=${ALIGN_VERSION}`).then(r => r.text()).then(parseLexicon);

async function build({ key, lang, words, post: P, V, vocab, voice16, voice48, music48 }) {
  stage('align', 'running');
  const lex = await lexicon(lang);
  const al = alignWords({ words, post: P, V, vocab, audio16: voice16,
    pronounce: w => pronounceSync(w, lang, lex).toks, progress: (d, t) => progress('align', d / t) });
  stage('align', 'done', { phones: al.phones.length });
  const entry = { lang, words: al.words, phones: al.phones, voice48, voice16, music48, alignVersion: ALIGN_VERSION,
    raw: { words, post: P, V, vocab } };
  await cache.put(key, entry).catch(() => {});
  await prepare(entry, lex);
}

async function prepare({ lang, words, phones, voice16, voice48, music48 }, lex = null) {
  stage('prepare', 'running');
  lex ??= await lexicon(lang);
  const src = buildSource({ lang, words, phones, a16: voice16, a48: voice48 });
  current = { lang, lex, src };
  stage('prepare', 'done');

  // Sprecher: wie viel Sprechzeit hat jeder?
  const spk = new Map();
  for (const w of src.words) {
    if (w.ps < 0) continue;
    const id = w.spk ?? 0, x = spk.get(id) ?? spk.set(id, { id, words: 0, seconds: 0 }).get(id);
    x.words++; x.seconds += (w.ae ?? w.e) - (w.as ?? w.s);
  }
  const speakers = [...spk.values()].sort((a, b) => b.seconds - a.seconds);

  const music = music48 ? music48.slice() : null, voice = voice48.slice();
  post({ type: 'ready', lang,
    words: src.words.map(w => ({ w: w.w, s: w.as ?? w.s, e: w.ae ?? w.e, spk: w.spk ?? 0 })),
    speakers, hasMusic: !!music, music, voice, accent: [...src.accent] },
  [voice.buffer, ...(music ? [music.buffer] : [])]);
}

// ---------------------------------------------------------------- Schnitt
const bySpeaker = (src, speaker) => (speaker == null ? null : p => (src.words[p.w].spk ?? 0) === speaker);

/** Vorgaben vereinheitlichen: {words: {wi: …}, pins: {ti: Quelllaut}} (früher: nur Wörter). */
function normForce(force = {}) {
  if (force.words || force.pins || force.avoid || force.pauses)
    return { words: { ...force.words }, pins: { ...force.pins }, avoid: { ...force.avoid }, pauses: { ...force.pauses } };
  return { words: { ...force }, pins: {}, avoid: {}, pauses: {} };
}

/**
 * Einen Satz schneiden.
 *   force.words[wi]: Quellwort-Index (genau dieses Vorkommen), -1 (aus Teilen bauen)
 *                    oder {avoid:[Laut-Indizes]} (andere Laute als diese)
 *   force.pins[ti]:  Ziellaut ti kommt genau aus Quelllaut i (gewählte Silbe)
 */
function cut(text, speaker, force = {}) {
  const { lang, lex, src } = current;
  const F = normForce(force);
  const only = bySpeaker(src, speaker);
  // Wörter, die aus einem bestimmten Vorkommen kommen sollen, bekommen dessen Aussprache
  const inst = Object.fromEntries(Object.entries(F.words).filter(([, f]) => typeof f === 'number' && f >= 0));
  const tgt = targetPhones(text, lang, lex, src, { inst, pauses: F.pauses });
  const { constrain, instances } = wholeWords(src, tgt, only);
  const phonesOf = wi => tgt.phones.map((p, i) => (p.w === wi ? i : -1)).filter(i => i >= 0);
  // Gleicher Laut oder wenigstens gleiche Klasse – sonst klänge die Alternative nach einem anderen Wort
  const fits = (p, T) => canon(p.real) === canon(T.t) || p.t === T.t || p.cls === T.cls;
  for (const [k, f] of Object.entries(F.words)) {
    const wi = Number(k), idx = phonesOf(wi);
    if (typeof f === 'number' && f >= 0) {
      const sw = src.words[f];
      if (sw && sw.pe - sw.ps + 1 === idx.length) idx.forEach((ti, j) => { constrain[ti] = p => p.i === sw.ps + j; });
    } else if (f === -1) idx.forEach(ti => delete constrain[ti]);
    else if (f?.avoid) {
      const ban = new Set(f.avoid);
      idx.forEach(ti => { const T = tgt.phones[ti]; constrain[ti] = p => !ban.has(p.i) && fits(p, T) && p.e - p.s >= 0.015 && p.lp > -4; });
    }
  }
  // Gepinnte Silben: Das Wort darf dann nicht mehr „nur am Stück“ kommen
  for (const ti of Object.keys(F.pins)) {
    const w = tgt.phones[ti]?.w;
    if (w == null) continue;
    for (const tj of phonesOf(w)) if (!(tj in F.pins) && !(w in F.words)) delete constrain[tj];
  }
  for (const [ti, si] of Object.entries(F.pins)) if (tgt.phones[ti]) constrain[ti] = p => p.i === si;
  // einzelne Laute: diese Quellstellen meiden (andere Bauweise einer Silbe)
  for (const [ti, ban] of Object.entries(F.avoid)) {
    const T = tgt.phones[ti], b = new Set(ban);
    if (T) constrain[ti] = p => !b.has(p.i) && fits(p, T) && p.e - p.s >= 0.015 && p.lp > -4;
  }
  const { chosen, stepCost } = select(src, tgt, 250, constrain, 'all', only);
  const segs = plan(src, tgt, chosen);
  const audio = render(src, segs);
  return { tgt, chosen, segs, audio, instances, force: F, stepCost };
}

/** Wo im Quellwort ein Stück liegt: ganz, Anfang, Ende oder Mitte. */
function posIn(first, last) {
  return first.wordInitial && last.wordFinal ? 'all' : first.wordInitial ? 'start' : last.wordFinal ? 'end' : 'middle';
}

/** Silben eines Zielworts als Laut-Indexbereiche [a, b]. */
function syllablesOf(tgt, wi) {
  const idx = tgt.phones.map((p, i) => (p.w === wi ? i : -1)).filter(i => i >= 0);
  const bounds = syllableBounds(tgt.phones), out = [];
  let a = idx[0];
  for (const i of idx.slice(1)) if (bounds.has(i)) { out.push([a, i - 1]); a = i; }
  if (idx.length) out.push([a, idx.at(-1)]);
  return out;
}

/** Ergebnis eines Schnitts für die Oberfläche: Wörter und Silben mit Güte und Lage im Ton. */
function describe({ tgt, chosen, segs, instances, stepCost = [] }) {
  const { src } = current;
  // Ausgabeposition jeder Lauthälfte (Schritt st), Anfang und Ende
  const outAt = new Map(), segOf = new Map();
  for (const seg of segs) for (const st of seg.parts) {
    const p = chosen[st].p, t = st % 2 === 0 ? p.s : p.mid;
    outAt.set(st, (seg.o0 ?? 0) / SR + Math.max(0, t - seg.start));
    segOf.set(st, seg);
  }
  const endAt = ti => { const st = 2 * ti + 1, seg = segOf.get(st), p = chosen[st].p; return seg ? (seg.o0 ?? 0) / SR + (p.e - seg.start) : outAt.get(st); };
  const clean = w => w.replace(/[^\p{L}\p{N}'-]/gu, '');
  const words = tgt.words.map((w, wi) => {
    const steps = tgt.phones.flatMap((p, i) => (p.w === wi ? [2 * i, 2 * i + 1] : []));
    // ohne Laute (sollte nicht vorkommen): nichts zu schneiden, nichts zu zeigen
    if (!steps.length) return { w, quality: 'sounds', pieces: 0, source: tgt.wordInfo[wi].source, start: 0, end: 0, used: [], from: [], spanned: [], at: 0, hasWhole: false, syls: [] };
    let pieces = 0, prev = null;
    const used = new Set(), from = [];
    for (const st of steps) {
      const p = chosen[st].p;
      const contiguous = prev && (prev === p || (st % 2 === 0 && prev.next === p.i));
      if (!contiguous) { pieces++; from.push(clean(src.words[p.w].w)); }
      prev = p; used.add(p.i);
    }
    const nsyl = tgt.phones.filter(p => p.w === wi && isVowel(p.t)).length || 1;
    const quality = pieces <= 1 ? 'whole' : pieces <= nsyl + 1 ? 'syllables' : 'sounds';
    const ti0 = steps[0] / 2, ti1 = (steps.at(-1) - 1) / 2;
    const syls = syllablesOf(tgt, wi).map(([a, b]) => {
      const parts = [];
      for (let ti = a; ti <= b; ti++) {
        const p = chosen[2 * ti].p, last = parts.at(-1);
        if (last && last.next === p.i) { last.text += p.real; last.next = p.next; last.lastP = p; }
        else parts.push({ text: p.real, word: clean(src.words[p.w].w), next: p.next, firstP: p, lastP: p });
      }
      return { a, b, start: outAt.get(2 * a) ?? 0, end: endAt(b) ?? 0, text: tgt.phones.slice(a, b + 1).map(p => p.t).join(''),
        from: parts[0]?.word ?? '',
        parts: parts.map(({ text, word, firstP, lastP }) => ({ text, word, at: firstP.s, pos: posIn(firstP, lastP) })) };
    });
    const spanned = [...new Set([...used].sort((x, y) => x - y).map(i => src.phones[i].w))].map(k => clean(src.words[k].w));
    // Mittlere Kosten je Halblaut: wie gut das Wort zusammenpasst (0 = am Stück aus der Quelle)
    const cost = steps.reduce((a, st) => a + (stepCost[st] ?? 0), 0) / steps.length;
    return { w, quality, pieces, cost: +cost.toFixed(2), source: tgt.wordInfo[wi].source, start: outAt.get(2 * ti0) ?? 0, end: endAt(ti1) ?? 0,
      used: [...used], from: [...new Set(from)], spanned, at: src.phones[Math.min(...used)].s, hasWhole: !!instances[wi]?.length, syls };
  });
  const pieces = segs.map(s => ({ start: s.start, end: s.end, at: (s.o0 ?? 0) / SR, len: ((s.o1 ?? s.o0) - s.o0) / SR }));
  return { words, pieces };
}

function take({ id, text, speaker, force }) {
  const r = cut(text, speaker, force);
  return { type: 'mixed', id, text, speaker, force: r.force, audio: r.audio, ...describe(r) };
}

/**
 * Ein Stück Originalstimme als bearbeitbarer Satz: jedes Wort fest an seinem
 * Vorkommen, die Pausen wie in der Quelle. So klingt es wie vorher, bis man ein
 * Wort oder eine Silbe tauscht.
 */
function phrase({ id, si, speaker }) {
  const { src } = current;
  const ws = si.map(i => src.words[i]);
  const text = ws.map(w => w.w).join(' ');
  const words = {}, pauses = {};
  si.forEach((i, k) => {
    words[k] = i;
    const next = src.words[si[k + 1]];
    if (next) { const gap = (next.as ?? next.s) - (ws[k].ae ?? ws[k].e); if (gap > 0.08) pauses[k] = Math.min(1.5, gap); }
  });
  const r = cut(text, speaker, { words, pins: {}, avoid: {}, pauses });
  return { type: 'phrase', id, text, speaker, force: r.force, audio: r.audio, ...describe(r) };
}

/**
 * Ein Wort im Satz umschreiben (auch durch mehrere Wörter oder durch nichts).
 * Alles andere bleibt, wie es gewählt war: feste Vorkommen, gewählte Silben,
 * Pausen – die Vorgaben werden auf die neuen Wort- und Lautnummern umgerechnet.
 */
function rewrite({ id, text, speaker, force, wi, replacement }) {
  const { lang, lex, src } = current;
  const F = normForce(force);
  const instOf = f => Object.fromEntries(Object.entries(f.words).filter(([, v]) => typeof v === 'number' && v >= 0));
  const old = targetPhones(text, lang, lex, src, { inst: instOf(F), pauses: F.pauses });
  const words = splitWords(text);
  const rep = splitWords(replacement.trim());
  // Satzzeichen am Ende des alten Worts bleiben, wenn das neue keins hat
  const punct = words[wi]?.match(/[.,!?;:…]+["“”»]*$/)?.[0];
  if (rep.length && punct && !/[.,!?;:…]$/.test(rep.at(-1))) rep[rep.length - 1] += punct;
  const next = [...words.slice(0, wi), ...rep, ...words.slice(wi + 1)];
  if (!next.length) return { type: 'error', id, message: 'Nothing left to say.' };
  const d = rep.length - 1, mapW = k => (k < wi ? k : k > wi ? k + d : null);
  const G = { words: {}, pins: {}, avoid: {}, pauses: {} };
  for (const [k, v] of Object.entries(F.words)) { const n = mapW(Number(k)); if (n != null) G.words[n] = v; }
  for (const [k, v] of Object.entries(F.pauses)) { const n = mapW(Number(k)); if (n != null) G.pauses[n] = v; else if (rep.length) G.pauses[wi + d] = v; }
  const newText = next.join(' ');
  const tgt = targetPhones(newText, lang, lex, src, { inst: instOf(G), pauses: G.pauses });
  const first = (phones, w) => phones.findIndex(p => p.w === w);
  for (const key of ['pins', 'avoid']) {
    for (const [ti, v] of Object.entries(F[key])) {
      const p = old.phones[ti];
      if (!p) continue;
      const n = mapW(p.w);
      if (n == null) continue;
      const nt = first(tgt.phones, n) + (Number(ti) - first(old.phones, p.w));
      if (tgt.phones[nt]?.w === n) G[key][nt] = v;
    }
  }
  const r = cut(newText, speaker, G);
  return { type: 'rewritten', id, text: newText, speaker, force: r.force, audio: r.audio, ...describe(r), wi: rep.length ? wi : -1 };
}

/** Eine Alternative: Ton und Beschreibung, mit Signatur gegen Doppelte. */
function option(text, speaker, force, wi, label, kind, seen, cur, extra = {}) {
  const r = cut(text, speaker, force);
  const d = describe(r), w = d.words[wi];
  const sig = w.used.join(',');
  if (seen.has(sig)) return null;
  seen.add(sig);
  const picks = Object.fromEntries(r.tgt.phones.map((_, ti) => [ti, [r.chosen[2 * ti].p.i, r.chosen[2 * ti + 1].p.i]]));
  return { label, kind, force: r.force, quality: w.quality, pieces: w.pieces, audio: r.audio, words: d.words, segs: d.pieces,
    current: sig === cur, picks, ...extra };
}

/** Alternativen für ein Wort im Satz: andere Vorkommen, frei gebaut, weitere Bauweisen. */
function variants({ id, text, speaker, force = {}, wi }) {
  const { src } = current;
  const F = normForce(force);
  const base = cut(text, speaker, F);
  const cur = describe(base).words[wi];
  const opts = [], seen = new Set(), curSig = cur.used.join(',');
  const without = { ...F, words: { ...F.words }, pins: Object.fromEntries(Object.entries(F.pins).filter(([ti]) => base.tgt.phones[ti]?.w !== wi)) };
  const push = o => o && opts.push(o);
  // Die aktuelle Fassung zuerst, damit man vergleichen kann
  push(option(text, speaker, F, wi, `Current: ${cur.quality === 'whole' ? `“${cur.spanned.join(' ')}” at ${clock(cur.at)}` : `from ${cur.from.join(' + ')}`}`, 'current', seen, curSig,
    { info: cur.quality === 'whole' ? { kind: 'whole', word: cur.spanned.join(' '), at: cur.at } : { kind: 'mix', from: cur.from } }));
  // 1. jedes Vorkommen des ganzen Worts (beim Sprecher), mit Zeitstempel
  for (const si of base.instances[wi] ?? []) {
    const sw = src.words[si];
    push(option(text, speaker, { ...without, words: { ...without.words, [wi]: si } }, wi,
      `“${sw.w.replace(/[^\p{L}\p{N}'-]/gu, '')}” at ${clock(sw.as ?? sw.s)}`, 'whole', seen, curSig,
      { at: sw.as ?? sw.s, info: { kind: 'whole', word: sw.w.replace(/[^\p{L}\p{N}'-]/gu, ''), at: sw.as ?? sw.s } }));
    if (opts.length >= 8) break;
  }
  // 2. aus Teilen gebaut, dann weitere Bauweisen, die die Laute der vorigen meiden
  let avoid = [];
  for (let k = 0; k < 4 && opts.length < 10; k++) {
    const f = k === 0 ? -1 : { avoid };
    const o = option(text, speaker, { ...without, words: { ...without.words, [wi]: f } }, wi, '', 'built', seen, curSig);
    if (o) { o.label = `Built from ${o.words[wi].from.join(' + ')}`; o.info = { kind: 'mix', from: o.words[wi].from }; opts.push(o); }
    const used = (o ?? opts.at(-1))?.words[wi].used ?? cur.used;
    // nur die Laute meiden, die nicht am Wortrand hängen: so ändert sich wirklich etwas
    avoid = [...new Set([...avoid, ...used])];
  }
  post({ type: 'variants', id, wi, options: opts }, opts.map(o => o.audio.buffer));
}

/** Alternativen für eine Silbe: dieselbe Lautfolge an anderen Stellen der Quelle. */
function sylVariants({ id, text, speaker, force = {}, wi, si }) {
  const { src } = current;
  const F = normForce(force);
  const base = cut(text, speaker, F);
  const d0 = describe(base), cur = d0.words[wi], syl = cur.syls[si];
  if (!syl) { post({ type: 'variants', id, wi, si, options: [] }); return; }
  const T = base.tgt.phones.slice(syl.a, syl.b + 1), n = T.length;
  const ph = src.phones, only = bySpeaker(src, speaker);
  const hits = [];
  for (let i = 0; i + n <= ph.length; i++) {
    if (only && !only(ph[i])) continue;
    let ok = true, score = 0;
    for (let k = 0; k < n; k++) {
      const p = ph[i + k];
      if (k > 0 && ph[i + k - 1].next !== p.i) { ok = false; break; }
      if (p.real === T[k].t || p.t === T[k].t) score += 3;
      else if (p.cls === T[k].cls) score += 1;
      else { ok = false; break; }
      score += Math.max(-2, p.lp) * 0.5;
    }
    if (!ok) continue;
    const first = ph[i], last = ph[i + n - 1];
    const exact = T.every((x, k) => ph[i + k].real === x.t || ph[i + k].t === x.t);
    // gleiche Lage im Wort und gleiche Nachbarn klingen natürlicher
    if (first.wordInitial === (T[0].wpos[0] === 'I')) score += 2;
    if (last.wordFinal === (T[n - 1].wpos.at(-1) === 'F')) score += 2;
    if (first.prevT && first.prevT === T[0].prevT) score += 1;
    if (last.nextT && last.nextT === T[n - 1].nextT) score += 1;
    hits.push({ i, score, exact });
  }
  hits.sort((a, b) => b.score - a.score);
  const opts = [], seen = new Set(), curSig = cur.used.join(',');
  const clean = w => w.replace(/[^\p{L}\p{N}'-]/gu, '');
  // Beschriftung mit dem, was dort wirklich zu hören ist (Laute der Quelle), nicht dem Ziel
  const heard = (i, k) => ph.slice(i, i + k).map(p => p.real).join('');
  const label = (i, exact) => `/${heard(i, n)}/ in “${clean(src.words[ph[i].w].w)}” at ${clock(ph[i].s)}${exact ? '' : ' (similar)'}`;
  const parts = syl.parts;
  const push = o => o && opts.push(o);
  push(option(text, speaker, F, wi, `Current: ${parts.map(x => `/${x.text}/ in “${x.word}”`).join(' + ')}`, 'current', seen, curSig,
    { info: parts.length === 1 ? { kind: 'syllable', word: parts[0].word, at: parts[0].at, pos: parts[0].pos } : { kind: 'mix', from: parts.map(x => x.word) } }));
  for (const h of hits) {
    if (opts.length >= 9) break;
    // Die anderen Silben des Worts bleiben, wie sie sind; nur diese wechselt
    const pins = { ...F.pins };
    for (const y of cur.syls) for (let ti = y.a; ti <= y.b; ti++) pins[ti] = base.chosen[2 * ti].p.i;
    for (let k = 0; k < n; k++) pins[syl.a + k] = h.i + k;
    const words = { ...F.words };
    // ein festes Vorkommen bleibt (es bestimmt die Laute des Worts), sonst frei
    if (!(typeof words[wi] === 'number' && words[wi] >= 0)) delete words[wi];
    push(option(text, speaker, { ...F, words, pins }, wi, label(h.i, h.exact), 'syllable', seen, curSig,
      { at: ph[h.i].s, info: { kind: 'syllable', word: clean(src.words[ph[h.i].w].w), at: ph[h.i].s, similar: !h.exact, pos: posIn(ph[h.i], ph[h.i + n - 1]) } }));
  }
  // Dazu: die Silbe anders zusammensetzen (Rest des Worts bleibt), je ohne die schon benutzten Laute
  const keep = {};
  for (const y of cur.syls) if (y !== syl) for (let ti = y.a; ti <= y.b; ti++) keep[ti] = base.chosen[2 * ti].p.i;
  const ban = {};
  for (let ti = syl.a; ti <= syl.b; ti++) ban[ti] = [base.chosen[2 * ti].p.i, base.chosen[2 * ti + 1].p.i];
  for (let k = 0; k < 3 && opts.length < 12; k++) {
    const words = { ...F.words };
    // ein festes Vorkommen bleibt (es bestimmt die Laute des Worts), sonst frei
    if (!(typeof words[wi] === 'number' && words[wi] >= 0)) delete words[wi];
    const pins = { ...F.pins, ...keep };
    for (let ti = syl.a; ti <= syl.b; ti++) delete pins[ti];
    const o = option(text, speaker, { words, pins, pauses: F.pauses, avoid: { ...F.avoid, ...Object.fromEntries(Object.entries(ban).map(([t, v]) => [t, [...v]])) } }, wi, '', 'built', seen, curSig);
    if (!o) break;
    // Beschriftung aus dem, was die neue Fassung für diese Silbe nimmt
    const y = o.words[wi].syls[cur.syls.indexOf(syl)];
    o.label = `Built: ${y?.parts?.map(x => `/${x.text}/ in “${x.word}”`).join(' + ') ?? 'another way'}`;
    o.info = { kind: 'mix', from: (y?.parts ?? []).map(x => x.word) };
    opts.push(o);
    for (let ti = syl.a; ti <= syl.b; ti++) ban[ti].push(...(o.picks?.[ti] ?? []));
  }
  post({ type: 'variants', id, wi, si, options: opts }, opts.map(o => o.audio.buffer));
}

// ---------------------------------------------------------------- Bausteine suchen
/**
 * Suche nach Wörtern (Schreibung) und Lautfolgen (Aussprache der Eingabe) in der Quelle.
 * Ergebnis: [{kind:'word'|'part', label, s, e, word, spk}]
 */
function find(query, speaker) {
  const { lang, lex, src } = current;
  const q = wordKey(query);
  if (!q) return [];
  const only = bySpeaker(src, speaker);
  const out = [], seen = new Set();
  const push = r => { const k = `${r.s.toFixed(3)}-${r.e.toFixed(3)}`; if (!seen.has(k)) { seen.add(k); out.push(r); } };
  // ganze Wörter: gleich, dann beginnend mit
  const ws = src.words.map((w, i) => ({ w, i })).filter(({ w }) => w.ps >= 0 && (!only || only(src.phones[w.ps])));
  for (const pass of [k => k === q, k => k.startsWith(q) && k !== q]) {
    for (const { w, i } of ws) if (pass(wordKey(w.w))) push({ kind: 'word', label: w.w.replace(/[^\p{L}\p{N}'-]/gu, ''), s: w.as, e: w.ae, word: i, spk: w.spk ?? 0 });
  }
  // Lautfolge: Aussprache der Eingabe, in der Quelle zusammenhängend
  const toks = pronounceSync(query, lang, lex).toks.map(x => x.t);
  if (toks.length) {
    const ph = src.phones, hits = [];
    const sylB = new Set();
    // Silbengrenzen der Quelle (für die Rangfolge)
    const sb = syllableBounds(ph.map(p => ({ t: p.t, w: p.w })));
    for (const b of sb) sylB.add(b);
    for (let i = 0; i + toks.length <= ph.length; i++) {
      let ok = true, exact = 0;
      for (let k = 0; k < toks.length; k++) {
        const p = ph[i + k];
        if (k > 0 && ph[i + k - 1].next !== p.i) { ok = false; break; }
        if (p.real === toks[k] || p.t === toks[k]) exact++;
        else if (p.cls !== soundClass(toks[k])) { ok = false; break; }
      }
      if (!ok || (only && !only(ph[i]))) continue;
      const a = ph[i], b = ph[i + toks.length - 1];
      const edges = (a.wordInitial ? 2 : sylB.has(i) ? 1 : 0) + (b.wordFinal ? 2 : sylB.has(i + toks.length) ? 1 : 0);
      const lp = ph.slice(i, i + toks.length).reduce((x, p) => x + p.lp, 0) / toks.length;
      hits.push({ i, n: toks.length, score: exact * 3 + edges * 2 + lp });
    }
    hits.sort((x, y) => y.score - x.score);
    for (const h of hits.slice(0, 24)) {
      const a = ph[h.i], b = ph[h.i + h.n - 1], w = src.words[a.w];
      push({ kind: 'part', label: `${toks.join('')}`, s: a.s, e: b.e, word: a.w, context: w.w.replace(/[^\p{L}\p{N}'-]/gu, ''), spk: w.spk ?? 0 });
    }
  }
  return out.slice(0, 40);
}

const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
