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
import { cleanMusic } from './dsp.js';

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);
const stage = (step, state, extra = {}) => post({ type: 'stage', step, state, ...extra });
const progress = (step, frac, detail = '') => post({ type: 'progress', step, frac, detail });
const SR = 48000;

let current = null;          // { lang, lex, src }

// Nur für Testskripte: Schnittkosten frei vs. mit enthaltenem Wort
if (globalThis.SLINKY_DEBUG) globalThis.__slinky = {
  stemReport(text) {
    const base = cut(text, null, {});
    return base.tgt.words.map((w, wi) => {
      if (base.instances[wi]?.length) return null;
      const free = cut(text, null, { words: { [wi]: -1 } }).total;
      const sts = stems(base.tgt, wi, null, 6).map(st => {
        const pins = Object.fromEntries(st.map);
        return `${st.word}@${st.at.toFixed(0)} ${(cut(text, null, { words: { [wi]: -1 }, pins }).total - free).toFixed(1)}`;
      });
      return sts.length ? `${w}: frei ${free.toFixed(1)} · ${sts.join(' · ')}` : null;
    }).filter(Boolean);
  },
};

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'lookup') {
      const hit = await cache.get(m.key);
      if (hit?.alignVersion === ALIGN_VERSION) {
        // gespeicherte Analyse von vor der Musik-Filterung: hier nachholen (einmal)
        if (hit.music48 && (hit.musicClean ?? 0) < MUSIC_CLEAN) {
          stage('align', 'running');
          hit.music48 = cleanVoiceFrom(hit.music48, hit.voice48, hit.phones);
          hit.musicClean = MUSIC_CLEAN;
          await cache.put(m.key, hit).catch(() => {});
          stage('align', 'done', { phones: hit.phones.length });
        }
        await prepare(hit);
      }
      else if (hit?.raw) await build({ key: m.key, lang: hit.lang, ...hit.raw, voice16: hit.voice16, voice48: hit.voice48, music48: hit.music48, musicClean: hit.musicClean, sources: hit.sources ?? null });
      else post({ type: 'missing' });
    } else if (m.type === 'build') await build(m);
    else if (m.type === 'addSource') await addSource(m);
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
const ALIGN_VERSION = 5;   // 3: Lexikon wählt die Standardform (wir → [viːɐ̯], nicht [mɐ]); 4: Zahlen werden ausgesprochen; 5: Längen aus dem Wörterbuch, Vokal-Vokal-Grenzen

const MUSIC_CLEAN = 2;      // Fassung der Stimmrest-Filterung der Musik
const lexicon = lang => fetch(`/data/slinky/lex-${lang}.txt?v=${ALIGN_VERSION}`).then(r => r.text()).then(parseLexicon);

/** Stimmreste aus der Musik; die Zischlaute der Stimme kennen wir aus dem Alignment. */
function cleanVoiceFrom(music48, voice48, phones) {
  const hiss = phones.filter(p => /^(s|z|ʃ|ʒ|ts|tʃ|f|v|ç|x|t|k|p|h)$/.test(p.t)).map(p => [p.s - 0.02, p.e + 0.02]);
  return cleanMusic(music48, voice48, { hiss });
}

/**
 * Weitere Aufnahme desselben Sprechers anhängen: Ton, Wörter und Laut-Wahrscheinlichkeiten
 * werden hinter die bisherigen gelegt (mit einer Sekunde Stille), dann wird alles neu verortet.
 * Für den Schnitt ist es danach eine einzige, längere Quelle; `sources` sagt, wo welche liegt.
 */
async function addSource({ key, name, size, mainName, mainSize, words, post: P, V, vocab, voice16, voice48, music48 }) {
  const hit = await cache.get(key);
  if (!hit?.raw) throw new Error('The analysis of this video is not stored any more. Reload the video first.');
  if (hit.raw.V !== V) throw new Error('The sound model changed since this video was analysed. Analyse it again first.');
  const len1 = hit.voice16.length / 16000;
  const offset = Math.ceil((len1 + 1) / 0.02) * 0.02;            // auf Laut-Raster (20 ms)
  const o16 = Math.round(offset * 16000), o48 = Math.round(offset * 48000), oF = Math.round(offset / 0.02);
  const cat = (a, b, o) => { const out = new Float32Array(o + b.length); out.set(a); out.set(b, o); return out; };
  const frames1 = hit.raw.post.length / V;
  const post = new Float32Array((oF + P.length / V) * V).fill(-1e9);
  post.set(hit.raw.post);
  const blank = Math.max(0, vocab.indexOf('<pad>'));
  for (let f = frames1; f < oF; f++) post[f * V + blank] = 0;     // Lücke: „nichts gesagt“
  post.set(P, oF * V);
  const sources = [...(hit.sources ?? [{ name: mainName, size: mainSize, offset: 0, duration: len1 }]),
    { name, size, offset, duration: voice16.length / 16000 }];
  const music = hit.music48 ? cat(hit.music48, music48 ?? new Float32Array(voice48.length), o48) : null;
  await build({ key, lang: hit.lang, words: [...hit.raw.words, ...words.map(w => ({ ...w, s: w.s + offset, e: w.e + offset }))],
    post, V, vocab, voice16: cat(hit.voice16, voice16, o16), voice48: cat(hit.voice48, voice48, o48), music48: music,
    musicClean: hit.musicClean ?? 0, cleanFrom: music48 ? offset : 0, sources });
}

async function build({ key, lang, words, post: P, V, vocab, voice16, voice48, music48, musicClean = 0, cleanFrom = 0, sources = null }) {
  stage('align', 'running');
  const lex = await lexicon(lang);
  const al = alignWords({ words, post: P, V, vocab, audio16: voice16,
    pronounce: w => pronounceSync(w, lang, lex).toks, progress: (d, t) => progress('align', d / t) });
  // Stimmreste aus der Musik (einmal; gespeicherte Analysen holen es hier nach). Die
  // Zischlaute der Stimme kennen wir jetzt aus dem Alignment.
  if (music48 && musicClean < MUSIC_CLEAN) {
    music48 = cleanVoiceFrom(music48, voice48, al.phones);
    musicClean = MUSIC_CLEAN;
  } else if (music48 && cleanFrom > 0) {
    // nur die neu angehängte Aufnahme (die alte ist schon gefiltert)
    const o = Math.round(cleanFrom * 48000);
    const ph = al.phones.filter(p => p.s >= cleanFrom).map(p => ({ ...p, s: p.s - cleanFrom, e: p.e - cleanFrom }));
    music48.set(cleanVoiceFrom(music48.subarray(o), voice48.subarray(o), ph), o);
  }
  stage('align', 'done', { phones: al.phones.length });
  const entry = { lang, words: al.words, phones: al.phones, voice48, voice16, music48, musicClean, alignVersion: ALIGN_VERSION,
    raw: { words, post: P, V, vocab }, ...(sources ? { sources } : {}) };
  await cache.put(key, entry).catch(() => {});
  await prepare(entry, lex);
}

async function prepare({ lang, words, phones, voice16, voice48, music48, sources = null }, lex = null) {
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
    speakers, hasMusic: !!music, music, voice, accent: [...src.accent], sources },
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
  // Neues Wort, in dem ein Wort aus dem Video ganz steckt („treibens“): dieses Wort am Stück
  // nehmen und nur den Rest bauen – aber nur, wenn es kaum schlechter passt als frei gebaut
  // (Hörtest: „treiben“ + s klar besser, bei deutlich teurerem Anschluss lieber frei)
  if (!globalThis.SLINKY_NO_STEMS) {
    let base = null;
    tgt.words.forEach((_, wi) => {
      if (instances[wi]?.length || wi in F.words || phonesOf(wi).some(ti => ti in F.pins)) return;
      const sts = stems(tgt, wi, speaker, 3);
      if (!sts.length) return;
      base ??= select(src, tgt, 250, constrain, 'all', only).total;
      let best = null;
      for (const st of sts.filter(x => x.L === sts[0].L || x.word === sts[0].word)) {
        const c = { ...constrain };
        for (const [ti, pi] of st.map) c[ti] = p => p.i === pi;
        const t = select(src, tgt, 250, c, 'all', only).total;
        if (!best || t < best.t) best = { t, c };
      }
      if (best && best.t - base <= STEM_MARGIN) { Object.assign(constrain, best.c); base = best.t; }
    });
  }
  const { chosen, stepCost, total } = select(src, tgt, 250, constrain, 'all', only);
  const segs = plan(src, tgt, chosen);
  const audio = render(src, segs);
  return { tgt, chosen, segs, audio, instances, force: F, stepCost, total };
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
    current: sig === cur, picks, fit: r.total, feel: feel(r, wi), ...extra };
}

/**
 * Wörter aus dem Video, die als Ganzes im Zielwort stecken (am Anfang, am Ende oder
 * mittendrin; mindestens drei Laute und die Hälfte des Worts, aber nicht das ganze):
 * „treiben“ + s, ge + „fangen“ + e. Je Wort das am sichersten erkannte Vorkommen,
 * die längsten zuerst, höchstens drei. rest = Buchstaben davor und danach.
 */
const STEM_MARGIN = 3.0;   // so viel teurer (Schnittkosten) darf „Wort am Stück + Rest“ sein
function stems(tgt, wi, speaker, perWord = 1) {
  const { src } = current;
  const only = bySpeaker(src, speaker);
  const T = tgt.phones.map((p, ti) => [p, ti]).filter(([p]) => p.w === wi);
  const n = T.length, key = tgt.words[wi].replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (n < 4) return [];
  const same = (p, t) => canon(p.real) === canon(t.t) || p.cls === t.cls;
  const best = new Map();
  src.words.forEach(sw => {
    if (sw.ps < 0 || (only && !only(src.phones[sw.ps]))) return;
    const L = sw.pe - sw.ps + 1;
    if (L < 4 || L < n / 2 || L >= n) return;                 // kurze Wörter („ist“ in „frisst“) zählen nicht
    const ps = src.phones.slice(sw.ps, sw.pe + 1);
    if (ps.some(p => p.e - p.s < 0.012)) return;
    let off = -1;
    for (let o = 0; o + L <= n && off < 0; o++) if (ps.every((p, k) => same(p, T[o + k][0]))) off = o;
    if (off < 0) return;
    const word = sw.w.replace(/[^\p{L}\p{N}'-]/gu, ''), wk = word.toLowerCase();
    // Buchstaben davor/danach, wenn die Schreibung passt, sonst die Laute
    const at = key.indexOf(wk);
    const before = at >= 0 ? key.slice(0, at) : T.slice(0, off).map(([t]) => t.t).join('');
    const after = at >= 0 ? key.slice(at + wk.length) : T.slice(off + L).map(([t]) => t.t).join('');
    const conf = ps.reduce((x, p) => x + p.lp, 0) / L;
    const list = best.get(wk) ?? best.set(wk, []).get(wk);
    list.push({ word, before, after, L, conf, at: sw.as ?? sw.s, map: ps.map((p, k) => [T[off + k][1], p.i]) });
  });
  return [...best.values()].flatMap(l => l.sort((x, y) => y.conf - x.conf).slice(0, perWord))
    .sort((x, y) => y.L - x.L || y.conf - x.conf).slice(0, 3 * perWord);
}

/** Die Wörter um ein Stück Quelle herum (zwei davor, zwei danach), zum Wiedererkennen. */
function contextOf(used) {
  const { src } = current;
  if (!used?.length) return '';
  const si = src.phones[Math.min(...used)].w;
  return src.words.slice(Math.max(0, si - 2), si + 3).map(x => x.w).join(' ');
}

/**
 * Wie das Wort im Vergleich zu seinen Nachbarn im Satz klingt: Tonhöhe (Halbtöne)
 * und Tempo (Dauer relativ zur üblichen Dauer der Laute). Hilft beim Aussuchen nach Gehör.
 */
function feel(r, wi) {
  const { src } = current;
  const med = xs => { const a = xs.filter(x => x != null && Number.isFinite(x)).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : null; };
  const of = w => r.tgt.phones.map((p, ti) => (p.w === w ? r.chosen[2 * ti].p : null)).filter(Boolean);
  const pitch = ps => med(ps.filter(p => isVowel(p.t) && p.F?.m?.f0).map(p => Math.log2(p.F.m.f0)));
  const rate = ps => med(ps.map(p => (p.e - p.s) / src.typical(p.t)));
  const me = of(wi), nb = [...of(wi - 1), ...of(wi + 1)];
  if (!nb.length) return null;
  const f0 = pitch(me), f1 = pitch(nb), r0 = rate(me), r1 = rate(nb);
  return { pitch: f0 != null && f1 != null ? +(12 * (f0 - f1)).toFixed(1) : null, tempo: r0 && r1 ? +(r0 / r1).toFixed(2) : null };
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
  // Steckt ein ganzes Wort aus dem Video darin (Vorgabe bei neuen Wörtern), so heißt es auch so
  const stemNow = cur.quality === 'whole' ? null : stems(base.tgt, wi, speaker, 3).find(st => st.map.every(([, pi]) => cur.used.includes(pi)));
  const curInfo = cur.quality === 'whole' ? { kind: 'whole', word: cur.spanned.join(' '), at: cur.at, context: contextOf(cur.used) }
    : stemNow ? { kind: 'stem', word: stemNow.word, before: stemNow.before, after: stemNow.after, at: stemNow.at, context: contextOf([stemNow.map[0][1]]) }
    : { kind: 'mix', from: cur.from };
  push(option(text, speaker, F, wi, `Current: ${cur.quality === 'whole' ? `“${cur.spanned.join(' ')}” at ${clock(cur.at)}` : `from ${cur.from.join(' + ')}`}`, 'current', seen, curSig,
    { info: curInfo }));
  // 0. ein Wort aus dem Video, das ganz im Zielwort steckt, und der Rest dazugebaut
  //    („treiben“ + s, ge + „fangen“ + e)
  for (const st of stems(base.tgt, wi, speaker).filter(st => !st.map.every(([, pi]) => cur.used.includes(pi)))) {
    const pins = { ...without.pins };
    st.map.forEach(([ti, pi]) => { pins[ti] = pi; });
    const o = option(text, speaker, { ...without, words: { ...without.words, [wi]: -1 }, pins }, wi,
      [st.before, `“${st.word}”`, st.after].filter(Boolean).join(' + '), 'stem', seen, curSig,
      { at: st.at, info: { kind: 'stem', word: st.word, before: st.before, after: st.after, at: st.at, context: contextOf([st.map[0][1]]) } });
    if (o) opts.push(o);
  }
  // 1. jedes Vorkommen des ganzen Worts (beim Sprecher), mit Zeitstempel und dem Satz drumherum;
  //    das am besten passende zuerst (geringste Schnittkosten im ganzen Satz)
  const whole = [];
  for (const si of (base.instances[wi] ?? []).slice(0, 12)) {
    const sw = src.words[si], word = sw.w.replace(/[^\p{L}\p{N}'-]/gu, '');
    const around = contextOf([sw.ps]);
    const o = option(text, speaker, { ...without, words: { ...without.words, [wi]: si } }, wi,
      `“${word}” at ${clock(sw.as ?? sw.s)}`, 'whole', seen, curSig,
      { at: sw.as ?? sw.s, info: { kind: 'whole', word, at: sw.as ?? sw.s, context: around } });
    if (o) whole.push(o);
  }
  // „In use“ (falls ganzes Wort) zählt beim Vergleich mit
  const cmp = [...whole, ...opts.filter(o => o.current && o.quality === 'whole')];
  const best = cmp.length > 1 ? cmp.reduce((a, b) => (b.fit < a.fit ? b : a)) : null;
  if (best) best.best = true;
  opts.push(...whole.sort((a, b) => a.fit - b.fit).slice(0, 7));
  // 2. aus Teilen gebaut, dann weitere Bauweisen, die die Laute der vorigen meiden
  let avoid = [];
  for (let k = 0; k < 6 && opts.length < 12; k++) {
    const f = k === 0 ? -1 : { avoid };
    const o = option(text, speaker, { ...without, words: { ...without.words, [wi]: f } }, wi, '', 'built', seen, curSig);
    if (o) { o.label = `Built from ${o.words[wi].from.join(' + ')}`; o.info = { kind: 'mix', from: o.words[wi].from }; opts.push(o); }
    const used = (o ?? opts.at(-1))?.words[wi].used ?? cur.used;
    // Die nächste Bauweise meidet diese Laute und den Vokal aus denselben Quellwörtern
    // (alle Vorkommen, z. B. jedes „Doch“): so kommt der Kern des Worts wirklich woanders her
    const keys = new Set(used.filter(i => isVowel(src.phones[i].t)).map(i => wordKey(src.words[src.phones[i].w].w)));
    const sameVowel = src.phones.filter(q => isVowel(q.t) && keys.has(wordKey(src.words[q.w].w))).map(q => q.i);
    avoid = [...new Set([...avoid, ...used, ...sameVowel])];
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
