// Slinky-Cut Engine: Zielsatz → Laute → beste Folge von Quellstücken → Audio.
//
// Einheiten sind Halblaute; geschnitten wird bevorzugt an Wortgrenzen und an
// leisen Stellen. Kontext: Nachbarlaute, Lautposition im Wort, Phrasengrenze,
// Betonung, Dauer, Tonhöhe, Klangfarbe an der Fuge. Quelle: gelernter Akzent
// und ein Aussprachelexikon des Sprechers.
//
// Reine Rechnung ohne Ein-/Ausgabe – läuft im Browser-Worker und in Node.
// Entstanden im Hörtest-Spike (spike/mix.mjs), Gewichte aus neun Runden.

import { soundClass, isVowel, canon } from './phones.js';
import { mfcc, f0At } from './dsp.js';
import { pronounceSync, deSuffixes } from './g2p.js';

// ---------- Gewichte (später per Hörtest zu tunen) ----------
export const W = {
  sameClass: 1.5,        // anderer Laut derselben Klasse (z. B. ɛ statt eː)
  ctxExact: 0,           // Nachbarlaut in der Quelle wie im Ziel
  ctxClass: 0.4,
  ctxGroup: 1.0,         // gleiche Lautgruppe (z. B. beide Nasale)
  ctxOther: 2.0,
  ctxPause: 3.0,         // Phrasenrand vs. Wortinneres (Auslaut vor Pause klingt anders)
  stress: 0.8,
  lowConf: 1.5,          // pro Logit unter -0.7
  realized: 1.2,         // Modell hört in der Quelle eigentlich einen anderen Laut
  cutMid: 1.6,           // Grundpreis eines Schnitts in der Lautmitte
  cutEdge: 2.2,          // Grundpreis eines Schnitts an der Lautgrenze
  cutWord: 0.3,          // Schnitt an einer Wortgrenze, die auch in der Quelle eine ist
  maskRange: 30,         // dB unter lauter Sprache, ab denen ein Schnitt verdeckt ist
  spec: 0.045,           // MFCC-Abstand
  f0: 10.0,              // |log2 f0-Verhältnis| (2 Halbtöne ≈ 1,7)
  voicing: 1.5,
  energy: 0.06,          // pro dB
  wordBonus: 0.3,
  wpos: 1.5,             // Lautposition im Wort (Anlaut/Inlaut/Auslaut) passt nicht
  bound: 1.5,            // letztes Wort vor einer Grenze: Grenztyp (Aussage/Frage/Aufzählung) passt nicht
  prom: 1.5,             // Betonung: Prominenz des Quellvokals passt nicht zum Ziel
  dur: 2.5,              // zusammengesetzter Laut deutlich kürzer als üblich
  midVowel: 2.5,         // Aufschlag für Schnitte mitten in Vokalen (klingt nach anderem Vokal)
  midSonorant: 1.0,      // … in Nasalen und Liquiden
  durDev: 1.2,           // pro |ln(Dauer / erwartete Dauer)| (Sprechrhythmus)
  fricCut: 0.35,         // Schnitt mitten in stimmlosem Reibelaut (s, sch, f, ch): fast unhörbar, trägt kaum Stimmfarbe
  near: 0,               // Stücke aus weit auseinanderliegenden Stellen der Quelle (andere Szene, andere Stimmung)
  burstLeak: 2.0,        // behauchter Anfang nach stimmlosem Verschluss, wo das Ziel keinen hat („lol“ → „klol“), je 20 ms
  sylRole: 1.0,          // Konsonant im Silbenanfang vs. Silbenende (anders gesprochen: „ts“ in „Wur-zeln“ ≠ „Furz“)
  sylLast: 0.6,          // Vokal/Endkonsonant aus letzter vs. nicht letzter Silbe des Worts (Längung am Wortende)
  codaPos: 1,            // Anteil von wpos, wenn beide im Silbenendrand stehen und sich nur Wortende/Wortinneres unterscheidet
  boundVowelOnly: 1,     // Grenztyp nur am Vokal der letzten Silbe prüfen
  vowelCtx: 2.5,
  lenSwap: 1.0,          // gleicher Vokal, andere Länge (o/oː); die Dauer bewertet durDev zusätzlich
  vowelSwap: 4.0,        // anderer Vokal derselben Klasse (ɔ statt oː, ɛ statt eː)
  shortV: 0.06,          // Vokal so kurz, dass der Knall des Verschlusses davor ihn ganz färbt (s)
  reuse: 4.0,            // derselbe Quellvokal schon in einem anderen Wort des Satzes (hörbar kopiert)
  chain: 1.5,            // Bonus, wenn zwei Wörter am Stück aus der Quelle kommen (Satzmelodie bleibt natürlich)
  normLoud: 0,           // Stücke auf globale Sprechlautstärke bringen (Runde 4: eher störend)
};

const GROUP = t => {
  const c = soundClass(t);
  if (isVowel(t) || ['R', 'OY', 'AI', 'AU', 'SCHWA', 'A', 'E', 'I', 'O', 'U', 'Y', 'OE'].includes(c)) return 'V';
  if (/^[mnŋ]$/.test(t)) return 'nasal';
  if (/^[pbtdkɡ]$/.test(t)) return 'stop';
  if (/^(f|v|s|z|ʃ|ʒ|ç|x|h|CH)$/.test(t) || c === 'CH') return 'fric';
  if (/^(ts|pf|tʃ|dʒ)$/.test(t)) return 'affr';
  if (/^[lj]$/.test(t)) return 'approx';
  return t;
};

function ctxCost(src, tgt) {          // Nachbarlaut in Quelle vs. Ziel (null = Pause/Rand)
  if (!src && !tgt) return 0;
  if (!src || !tgt) return W.ctxPause;
  if (src === tgt || canon(src) === canon(tgt)) return W.ctxExact;
  if (soundClass(src) === soundClass(tgt)) return W.ctxClass;
  if (GROUP(src) === GROUP(tgt)) return W.ctxGroup;
  return W.ctxOther;
}

// ---------- Quelle laden ----------
/**
 * Quelle vorbereiten: Laute aus dem Alignment plus Audio (16 kHz für Merkmale,
 * 48 kHz zum Schneiden, beides die getrennte Stimme, sofern vorhanden).
 */
export function buildSource({ lang, words, phones, a16, a48, feat = null }) {
  const data = { lang, words, phones: phones.map(p => ({ ...p })) };
  feat = feat ?? mfcc(a16, 16000, 80);
  const ph = data.phones;
  // Was der Sprecher tatsächlich sagt (z. B. britisches [ɑː] in „disaster“, wo
  // das Wörterbuch [æ] hat): Innerhalb derselben Lautklasse gilt das Gehörte,
  // bei unsicherem Alignment auch über Klassengrenzen.
  // Lang gegen kurz (aː/a, eː/ɛ, iː/ɪ …): Da irrt das Modell oft, das Wörterbuch weiß es besser –
  // und die Länge unterscheidet Wörter (Blase/Masse)
  const lenOnly = (a, b) => a !== b && isVowel(a) && isVowel(b) && soundClass(a) === soundClass(b) && a.includes('ː') !== b.includes('ː');
  for (const p of ph) p.real = p.raw && !lenOnly(p.raw, p.t) && (soundClass(p.raw) === p.cls || p.lp < -1) ? p.raw : p.t;
  ph.forEach((p, i) => {
    p.i = i;
    const nb = ph[i + 1], pv = ph[i - 1];
    p.next = nb && !p.pauseAfter ? i + 1 : -1;
    p.prevT = pv && !pv.pauseAfter ? pv.real : null;
    p.nextT = p.next >= 0 ? nb.real : null;
    p.pauseBefore = !pv || pv.pauseAfter;
    p.wordInitial = p.pauseBefore || pv.w !== p.w;
    p.wordFinal = !nb || p.pauseAfter || nb.w !== p.w;
    p.wpos = posCode(p.wordInitial, p.wordFinal);
    // Deutsch: Vokal am Wortanfang beginnt mit Knacklaut ([ʔ]), auch mitten im Satz
    if (data.lang === 'de' && isVowel(p.t) && p.wordInitial && !p.pauseBefore) p.prevT = 'ʔ';
    if (data.lang === 'de' && nb && !p.pauseAfter && nb.w !== p.w && isVowel(nb.t)) p.nextT = 'ʔ';
    p.word = data.words[p.w].w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    p.mid = (p.s + p.e) / 2;
    p.F = {};
    for (const [key, t] of [['s', p.s + 0.008], ['m', p.mid], ['e', p.e - 0.008]]) p.F[key] = pointFeat(feat, a16, t);
  });
  sylRoles(ph);
  // Nach einem stimmlosen Verschluss (k, t, p, ts) ist der Folgelaut oft erst behaucht
  // ([kʰl̥] in „Klover“): Wie lange dauert es, bis die Stimme einsetzt?
  const VLESS = /^(p|t|k|ts|tʃ)$/, VOICED = /^(l|m|n|ŋ|r|ʁ|ɾ|ɹ|j|w|v|z)$/;
  // Liegt die Verschlusslösung des Laut davor (das „g“ von „Augen“, das „t“ vor „hat“)
  // noch in diesem Laut? Dann klingt sein Anfang danach – Abstand in Sekunden.
  for (const p of ph) {
    const pv = ph[p.i - 1];
    p.burstIn = pv && pv.next === p.i && pv.burst != null && pv.burst > p.s - 0.004 ? +Math.max(0, pv.burst - p.s).toFixed(3) + 0.004 : 0;
  }
  for (const p of ph) {
    const pv = ph[p.i - 1];
    p.voiceOn = 0;
    if (!pv || pv.next !== p.i || !VLESS.test(pv.t) || !(isVowel(p.t) || VOICED.test(p.t))) continue;
    let t = p.s;
    while (t < p.e && !f0At(a16, Math.round(t * 16000))) t += 0.005;
    p.voiceOn = +(t - p.s).toFixed(3);
  }
  const sorted = Float32Array.from(feat.energy).sort();
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const eAt = t => feat.energy[Math.min(feat.frames - 1, Math.max(0, Math.round(t * 200)))];
  for (const p of ph) { p.Es = eAt(p.s); p.Em = eAt(p.mid); p.Ee = eAt(p.e); }
  // Ein Laut, in dem eine echte Pause liegt, ist falsch verortet: Das Alignment hat
  // ein Wort über die Pause gezogen (falsch transkribiertes „Orthum“ greift sich das
  // „m“ aus dem folgenden „Damit“). Solche Wörter taugen weder ganz noch in Teilen.
  const SIL = Math.max(sorted[Math.floor(sorted.length * 0.05)] + 6, loud - 22);
  const silent = (a, b) => {
    let run = 0, best = 0;
    for (let f = Math.ceil(a * 200); f < Math.floor(b * 200); f++) { run = feat.energy[f] < SIL ? run + 1 : 0; best = Math.max(best, run); }
    return best / 200;
  };
  const STOP = /^(p|b|t|d|k|ɡ|ts|tʃ|pf)$/;
  // im Laut selbst oder in einer Lücke zwischen zwei Lauten desselben Worts
  // (Lücken zwischen Lauten eines Worts lässt das Alignment sonst kaum; über 0,3 s ist es keins)
  const stretched = (p, q) => (q && q.s - p.e > 0.3) || silent(p.s, q ? q.s : p.e) > (STOP.test(p.t) || STOP.test(q?.t ?? '') ? 0.25 : 0.15);
  for (const w of data.words) {
    if (w.ps < 0) continue;
    const bad = ph.slice(w.ps, w.pe + 1).some((p, k, a) => stretched(p, a[k + 1]));
    w.stretched = bad;
    if (bad) for (let k = w.ps; k <= w.pe; k++) ph[k].lp = Math.min(ph[k].lp, -9);
  }

  // Typische Dauer pro Laut und Prominenz der Vokale (Dauer + Lautstärke + Tonhöhe
  // relativ zur Umgebung) – die tatsächliche Betonung, nicht die aus dem Wörterbuch.
  const durs = new Map();
  for (const p of ph) (durs.get(p.t) ?? durs.set(p.t, []).get(p.t)).push(p.e - p.s);
  const stat = new Map([...durs].map(([t, xs]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 0.02;
    xs.sort((a, b) => a - b);
    return [t, { m, sd, med: xs[xs.length >> 1] }];
  }));
  const typical = t => stat.get(t)?.med ?? 0.06;
  for (const p of ph) {
    if (!isVowel(p.t)) continue;
    const st = stat.get(p.t);
    const near = ph.slice(Math.max(0, p.i - 15), p.i + 16).filter(q => isVowel(q.t));
    const eMed = near.map(q => q.Em).sort((a, b) => a - b)[near.length >> 1];
    const fs = near.map(q => q.F.m.f0).filter(Boolean).sort((a, b) => a - b), fMed = fs[fs.length >> 1];
    p.locE = eMed;
    p.prom = (p.e - p.s - st.m) / st.sd + 0.15 * (p.Em - eMed) + (p.F.m.f0 && fMed ? 4 * Math.log2(p.F.m.f0 / fMed) : 0);
  }
  // Lokale Sprechlautstärke (Median der Vokale ±15 Laute) für jeden Laut, global als Bezug
  const vowE = ph.filter(p => p.locE != null);
  for (const p of ph) if (p.locE == null) p.locE = (vowE.find(q => q.i >= p.i) ?? vowE.at(-1)).locE;
  const globE = vowE.map(p => p.Em).sort((a, b) => a - b)[vowE.length >> 1];
  // Grenztyp: Gehört der Laut zur letzten Silbe vor einer Grenze, und zu welcher?
  // S = Aussage (. !), Q = Frage, C = weiterweisend (Komma oder Pause ohne Satzzeichen).
  // Nur die letzte Silbe trägt die Satzmelodie; der Rest des Worts klingt wie sonst auch.
  for (const p of ph) {
    const w = data.words[p.w], last = ph[w.pe];
    let lastV = w.pe;
    while (lastV > w.ps && !isVowel(ph[lastV].t)) lastV--;
    p.bound = p.i >= lastV ? boundType(w.w, last?.pauseAfter) : '';
  }
  // Aussprachelexikon dieses Sprechers: pro Wort die am sichersten erkannte Realisierung
  const lexicon = new Map();
  data.words.forEach(w => {
    if (w.ps < 0) return;
    const ps = ph.slice(w.ps, w.pe + 1), key = w.w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    if (!key || ps.some(p => p.lp < -4)) return;
    // Nur verlässliche Vorkommen: Was das Modell hört, muss zur Lautklasse des
    // Wörterbuchs passen (sonst war das Wort falsch verortet: „wir“ → [mɜ]).
    const reduced = t => /^(ə|ɜ|ɐ|ɚ)$/.test(t);
    if (ps.some(p => p.real !== p.t && soundClass(p.real) !== p.cls && !(reduced(p.real) && isVowel(p.t)))) return;
    const score = ps.reduce((a, p) => a + p.lp, 0) / ps.length, old = lexicon.get(key);
    if (!old || score > old.score) lexicon.set(key, { score, toks: ps.map(p => ({ t: p.real, stress: p.stress })) });
  });
  // Akzent des Sprechers lernen: Wie realisiert er Laute, die das Wörterbuch
  // vorgibt? (z. B. britisch: [ɾ] → [t], [ɑː] → [ɒ]/[ɔ], [ɚ] → [ə]). Nur Vokale und
  // der Flap – bei Konsonanten sind Abweichungen meist Wortgrenzen-Effekte.
  const counts = new Map();
  for (const p of ph) {
    const c = counts.get(p.t) ?? counts.set(p.t, new Map()).get(p.t);
    c.set(p.real, (c.get(p.real) ?? 0) + 1);
  }
  const accent = new Map();
  for (const [t, c] of counts) {
    if (!(isVowel(t) || t === 'ɾ')) continue;
    const tot = [...c.values()].reduce((a, b) => a + b, 0);
    const [top, n] = [...c].sort((a, b) => b[1] - a[1])[0];
    if (tot >= 8 && top !== t && !lenOnly(top, t) && n / tot >= 0.4) accent.set(t, top);
  }
  return { ...data, a16, a48, feat, loud, typical, globE, lexicon, accent };

}


function pointFeat(feat, a16, t) {
  const fr = Math.round(t * 200), n = feat.nC;
  const m = new Float32Array(n);
  let e = 0, k = 0;
  for (let d = -1; d <= 1; d++) {
    const f = fr + d; if (f < 0 || f >= feat.frames) continue;
    for (let c = 0; c < n; c++) m[c] += feat.mfcc[f * n + c];
    e += feat.energy[f]; k++;
  }
  for (let c = 0; c < n; c++) m[c] /= k || 1;
  return { m, e: e / (k || 1), f0: f0At(a16, Math.round(t * 16000)) };
}

function featDist(A, B) {
  let d = 0;
  for (let c = 0; c < A.m.length; c++) d += (A.m[c] - B.m[c]) ** 2;
  let cost = W.spec * Math.sqrt(d) + W.energy * Math.abs(A.e - B.e);
  if (A.f0 && B.f0) cost += W.f0 * Math.abs(Math.log2(A.f0 / B.f0));
  else if (!!A.f0 !== !!B.f0) cost += W.voicing;
  return cost;
}

// ---------- Ziel ----------
function posCode(initial, final) { return initial && final ? 'IF' : initial ? 'I' : final ? 'F' : 'M'; }
function boundType(word, pause) {
  if (/[.!…]["“”»]*$/.test(word)) return 'S';
  if (/\?["“”»]*$/.test(word)) return 'Q';
  if (/[,;:–—]$/.test(word) || pause) return 'C';
  return '';
}

/**
 * Zielsatz in Laute. Wörter, die der Sprecher selbst sagt, bekommen seine
 * Aussprache; neue Wörter kommen aus dem Lexikon (bzw. Regeln) und werden an
 * seinen Akzent angepasst. `source` je Wort: speaker | lexicon | compound | rules.
 */
export function targetPhones(text, lang, g2pLex, src = null, { inst = {}, pauses = {} } = {}) {
  const words = splitWords(text);
  const lexicon = src?.lexicon, accent = src?.accent;
  const out = [], wordInfo = [];
  words.forEach((w, wi) => {
    // inst[wi]: genau dieses Vorkommen in der Quelle – dann gilt seine Aussprache
    const sw = inst[wi] != null ? src?.words[inst[wi]] : null;
    const fixed = sw && sw.ps >= 0 ? src.phones.slice(sw.ps, sw.pe + 1).map(p => ({ t: p.real, stress: p.stress })) : null;
    const key = w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    let known = fixed ?? lexicon?.get(key);
    // Wort des Sprechers + Endung („Giganten“ + s): seine Aussprache des Stamms
    if (!known && lang === 'de' && lexicon) {
      for (const { stem, toks } of deSuffixes(key)) {
        const k = lexicon.get(stem);
        if (k) { known = [...(k.toks ?? k), ...toks.map(t => ({ t: t.t, stress: 0 }))]; break; }
      }
    }
    const pr = known ? null : pronounceSync(w, lang, g2pLex);
    wordInfo.push({ w, source: known ? 'speaker' : pr.source });
    let toks = known ? (known.toks ?? known) : pr.toks.map(x => accent?.has(x.t) ? { ...x, t: accent.get(x.t) } : x);
    if (!known && lexicon && g2pLex) toks = speakerParts(key, toks, src, lang, g2pLex);
    // pauses[wi]: Pause nach dem Wort wie in der Quelle (beim Bearbeiten der Originalstimme)
    const pause = pauses[wi] ?? (/[.!?…]$/.test(w) ? 0.35 : /[,;:–—]$/.test(w) ? 0.15 : 0);
    let lastV = toks.length - 1;
    while (lastV > 0 && !isVowel(toks[lastV].t)) lastV--;
    toks.forEach((x, k) => out.push({ t: x.t, fin: k >= lastV, cls: soundClass(x.t), stress: x.stress, w: wi,
      word: w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(), pauseAfter: k === toks.length - 1 ? pause : 0,
      wpos: posCode(k === 0, k === toks.length - 1),
      bound: k < lastV ? '' : wi === words.length - 1 ? (boundType(w, true) || 'S') : boundType(w, false) }));
  });
  if (out.length) out.at(-1).pauseAfter = Math.max(out.at(-1).pauseAfter, 0.35);
  sylRoles(out);
  out.forEach((p, i) => {
    const pv = out[i - 1], nx = out[i + 1];
    p.prevT = pv && !pv.pauseAfter ? pv.t : null;
    p.nextT = nx && !p.pauseAfter ? nx.t : null;
    if (lang === 'de' && pv && !pv.pauseAfter && pv.w !== p.w && isVowel(p.t)) p.prevT = 'ʔ';
    if (lang === 'de' && nx && !p.pauseAfter && nx.w !== p.w && isVowel(nx.t)) p.nextT = 'ʔ';
  });
  return { words, phones: out, wordInfo };
}

/**
 * Teilt das Zielwort Anfang oder Ende mit einem Wort des Sprechers („Extrem-räumen“ /
 * „extrem-sten“), gilt dort seine Aussprache (er sagt [ɛ], das Wörterbuch [eː]) –
 * aber nur, soweit die Wörterbuch-Aussprachen beider Wörter dort übereinstimmen.
 */
function speakerParts(key, toks, src, lang, g2pLex) {
  if (key.length < 6) return toks;
  if (!src._g2pWords) {
    src._g2pWords = [];
    for (const [k, v] of src.lexicon) {
      const real = v.toks ?? v, dict = pronounceSync(k, lang, g2pLex).toks;
      if (k.length >= 5 && dict.length === real.length) src._g2pWords.push({ k, real, dict });
    }
  }
  const out = toks.map(x => ({ ...x }));
  // (gleicher Laut oder Vokal derselben Klasse: dort unterscheiden sich Regeln und Wörterbuch oft)
  const same = (a, b) => canon(a.t) === canon(b.t) || (isVowel(a.t) && isVowel(b.t) && soundClass(a.t) === soundClass(b.t));
  let bestP = null, bestS = null;
  for (const e of src._g2pWords) {
    if (e.k === key) continue;
    let lp = 0; while (lp < key.length && lp < e.k.length && key[lp] === e.k[lp]) lp++;
    let ls = 0; while (ls < key.length && ls < e.k.length && key.at(-1 - ls) === e.k.at(-1 - ls)) ls++;
    if (lp >= 5 && (!bestP || lp > bestP.l)) bestP = { e, l: lp };
    if (ls >= 5 && (!bestS || ls > bestS.l)) bestS = { e, l: ls };
  }
  if (bestP) {
    const { real, dict } = bestP.e;
    for (let j = 0; j < Math.min(out.length, dict.length) - 1 && same(out[j], dict[j]); j++) out[j] = { ...out[j], t: real[j].t };
  }
  if (bestS) {
    const { real, dict } = bestS.e;
    for (let j = 1; j < Math.min(out.length, dict.length) && same(out.at(-j), dict.at(-j)); j++) out[out.length - j] = { ...out.at(-j), t: real.at(-j).t };
  }
  return out;
}

/** Text in Wörter; reine Satzzeichen („–“, „…“) hängen am Wort davor. */
export function splitWords(text) {
  const out = [];
  for (const t of text.split(/\s+/).filter(Boolean)) {
    if (/[\p{L}\p{N}]/u.test(t) || !out.length) out.push(t);
    else out[out.length - 1] += t;
  }
  if (out.length > 1 && !/[\p{L}\p{N}]/u.test(out[0])) out.splice(0, 2, out[0] + out[1]);
  return out;
}

// ---------- Auswahl ----------
/** Gleicher Vokal, nur die Länge anders (o/oː, a/aː …). */
const lenPair = (a, b) => a !== b && a.replace(/ː/g, '') === b.replace(/ː/g, '') && isVowel(a);
export const wordKey = w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/**
 * Ganze Wörter zuerst: Sagt der Sprecher ein Zielwort selbst (gleiche
 * Schreibung, gleich viele Laute), darf es nur aus diesen Vorkommen kommen –
 * die Auswahl entscheidet dann nur noch, welches Vorkommen am besten passt.
 * Liefert {constrain, instances}; instances[wi] = Quellwort-Indizes oder null.
 */
export function wholeWords(src, tgt, only = null) {
  const constrain = {}, instances = [];
  // Ganze Wörter werden so übernommen, wie sie klingen – auch Laute, die das
  // Modell unsicher erkennt; nur grob fehlverortete Wörter fallen raus.
  const usable = p => p.e - p.s >= 0.01;
  tgt.words.forEach((w, wi) => {
    const idx = tgt.phones.map((p, i) => (p.w === wi ? i : -1)).filter(i => i >= 0);
    const key = wordKey(w);
    const inst = src.words.map((sw, si) => si).filter(si => {
      const sw = src.words[si];
      if (sw.ps < 0 || wordKey(sw.w) !== key || sw.pe - sw.ps + 1 !== idx.length) return false;
      if (only && !only(src.phones[sw.ps])) return false;
      let lp = 0;
      for (let k = sw.ps; k <= sw.pe; k++) { if (!usable(src.phones[k])) return false; lp += src.phones[k].lp; }
      return lp / idx.length > -3;
    });
    instances.push(inst.length ? inst : null);
    if (!inst.length) return;
    const set = new Set(inst);
    idx.forEach((ti, k) => { constrain[ti] = p => set.has(p.w) && p.i - src.words[p.w].ps === k; });
  });
  return { constrain, instances };
}
/**
 * Rolle jedes Lauts in seiner Silbe: srole 'O' (Anfangsrand), 'N' (Vokal), 'C' (Endrand);
 * slast: gehört zur letzten Silbe seines Worts. Für Quelle und Ziel gleich gerechnet.
 */
function sylRoles(phones) {
  const bounds = syllableBounds(phones);
  let start = 0;
  const close = end => {
    let v = -1;
    for (let k = start; k < end; k++) if (isVowel(phones[k].t)) { v = k; break; }
    const last = end >= phones.length || phones[end].w !== phones[start].w;
    for (let k = start; k < end; k++) { phones[k].srole = v < 0 ? 'C' : k < v ? 'O' : k === v ? 'N' : 'C'; phones[k].slast = last; }
  };
  for (let i = 1; i <= phones.length; i++) if (i === phones.length || bounds.has(i)) { close(i); start = i; }
}

/**
 * Silbengrenzen im Ziel (Index i = Grenze vor Laut i): Zwischen zwei Vokalen
 * geht der letzte Konsonant zur nächsten Silbe, bei „ts“, „pf“ und Clustern mit
 * l/r auch der vorletzte (einfache Onset-Maximierung).
 */
export function syllableBounds(phones) {
  const out = new Set();
  let lastV = -1;
  phones.forEach((p, i) => {
    if (i && p.w !== phones[i - 1].w) out.add(i);
    if (!isVowel(p.t)) return;
    if (lastV >= 0 && phones[lastV].w === p.w) {
      const cons = i - lastV - 1;
      let b = i - Math.min(cons, 1);
      if (cons >= 2 && /^[lrɹʁjw]$/.test(phones[i - 1].t) && /^[pbtdkɡfvθʃs]$/.test(phones[i - 2].t)) b = i - 2;
      out.add(b);
    }
    lastV = i;
  });
  return out;
}

// cuts: 'all' (frei), 'mid' (nur in Lautmitten = Diphone), 'edge' (nur an Lautgrenzen),
//       'syll' (nur an Silbengrenzen)
export function select(src, tgt, K = 250, constrain = {}, cuts = 'all', only = null) {
  // Derselbe Quellvokal an zwei Stellen verschiedener Wörter („Ha-se“ und „hat“ aus
  // demselben „hat“) klingt hörbar kopiert – ebenso derselbe Vokal desselben Worts aus
  // einem anderen Vorkommen. Dort, wo das Wort nicht ganz übernommen ist, verteuern
  const pen = new Map();
  let r;
  for (let round = 0; round < 3; round++) {
    r = selectOnce(src, tgt, K, constrain, cuts, only, pen);
    const used = new Map();
    let found = false;
    r.chosen.forEach((c, st) => {
      const i = st >> 1, T = tgt.phones[i];
      if (!isVowel(T.t)) return;
      const key = vowelKey(src, c.p), u = used.get(key);
      if (u == null) { used.set(key, { i, p: c.p }); return; }
      const prev = u.i;
      if (prev === i || tgt.phones[prev].word === T.word) return;
      // Gleiches Stück an beiden Stellen im richtigen Umfeld („extrem-sten“, „Extrem-räumen“): gewollt
      if (inPlace(u.p, tgt.phones[prev]) && inPlace(c.p, T)) return;
      const at = constrain[i] && !constrain[prev] ? prev : i;
      (pen.get(at) ?? pen.set(at, new Set()).get(at)).add(key);
      found = true;
    });
    if (!found) break;
  }
  return r;
}
const inPlace = (p, T) => canon(p.prevT ?? '') === canon(T.prevT ?? '') && canon(p.nextT ?? '') === canon(T.nextT ?? '');
/** Welcher Vokal welchen Worts (ohne Vorkommen): „hat#1“. */
const vowelKey = (src, p) => p.vkey ??= `${wordKey(src.words[p.w].w)}#${p.i - src.words[p.w].ps}`;

function selectOnce(src, tgt, K, constrain, cuts, only, pen) {
  const syl = cuts === 'syll' ? syllableBounds(tgt.phones) : null;
  const BAN = 25;                                   // „verboten“, aber nicht unmöglich
  // Phantome aussortieren: Laute, die das Alignment erzwungen hat, die das Modell aber nicht hört.
  // `only`: zusätzlich nur bestimmte Laute (z. B. die eines Sprechers)
  const ph = src.phones.filter(p => p.e - p.s >= 0.015 && p.lp > -4 && (!only || only(p)));
  const byT = new Map(), byC = new Map();
  for (const p of ph) {
    const k = canon(p.real);
    (byT.get(k) ?? byT.set(k, []).get(k)).push(p);
    (byC.get(p.cls) ?? byC.set(p.cls, []).get(p.cls)).push(p);
  }
  const N = tgt.phones.length;
  // Schritte: 2i = linke Hälfte von Laut i, 2i+1 = rechte Hälfte
  const steps = [];
  const missing = [];
  for (let i = 0; i < N; i++) {
    const T = tgt.phones[i];
    const tk = canon(T.t);
    // Gleicher Laut; dazu immer die verwandten (gleiche Klasse): gleicher Vokal mit anderer
    // Länge („o“ aus „Echo“ für „doof“) kostet wenig, ein anderer Vokal (ɔ für oː) mehr
    const swap = p => (lenPair(p.real, T.t) ? W.lenSwap : isVowel(T.t) ? W.vowelSwap : W.sameClass);
    let cands = (byT.get(tk) ?? []).map(p => ({ p, base: 0 }));
    cands.push(...(byC.get(T.cls) ?? []).filter(p => canon(p.real) !== tk).map(p => ({ p, base: swap(p) })));
    // Vorgabe (z. B. „ganzes Wort aus der Quelle“): alle passenden Laute, auch klassenfremde
    if (constrain[i]) cands = src.phones.filter(p => (!only || only(p)) && constrain[i](p, src.phones)).map(p => ({ p, base: canon(p.real) === tk ? 0 : swap(p) }));
    if (!cands.length) { missing.push(T.t); cands = ph.filter(p => GROUP(p.t) === GROUP(T.t)).map(p => ({ p, base: 5 })); }
    const conf = p => (p.lp < -0.7 ? W.lowConf * (-0.7 - p.lp) : 0) + (p.raw && p.real !== p.raw ? W.realized : 0);
    const STOPS = /^(p|b|t|d|k|ɡ|ts|tʃ)$/;
    const expDur = src.typical(T.t) * (isVowel(T.t) ? (T.stress === 1 ? 1.25 : T.stress === 0 ? 0.85 : 1) : 1) * (T.pauseAfter ? 1.3 : 1);
    const durC = p => W.durDev * 0.5 * Math.abs(Math.log((p.e - p.s) / expDur));
    // Linke Hälfte eines Verschlusslauts ist Stille – ihr linker Nachbar zählt kaum
    // Behauchter Anfang taugt nicht, wo im Ziel kein stimmloser Verschluss davorsteht
    // (fast ganz stimmlos: so gut wie unbrauchbar)
    const leak = p => (p.voiceOn > 0.015 && canon(p.prevT) !== canon(T.prevT)
      ? (p.voiceOn > 0.5 * (p.e - p.s) ? 4 * W.burstLeak : W.burstLeak * Math.min(2, p.voiceOn / 0.02)) : 0);
    // Vokale tragen die Übergänge der Nachbarlaute in sich (nach „v“ klingt „a“ anders als nach „h“)
    // (nur Übergänge zu Lauten; Pause gegen Laut zählt wie bei allen anderen)
    const vk = (a, b) => (isVowel(T.t) && a && b ? W.vowelCtx : 1);
    // Knall des Verschlusses davor im Anfang dieses Lauts, wo im Ziel keiner davorsteht
    const burstC = p => (p.burstIn && canon(p.prevT) !== canon(T.prevT) ? (p.burstIn > 0.5 * (p.e - p.s) ? 4 : 2) * W.burstLeak : 0);
    const lctx = p => (STOPS.test(T.t) ? 0.3 * ctxCost(p.prevT, T.prevT) : vk(p.prevT, T.prevT) * ctxCost(p.prevT, T.prevT)) + leak(p) + burstC(p);
    const stressC = p => {
      if (!isVowel(T.t) || p.prom == null) return 0;
      return T.stress === 1 ? W.prom * Math.max(0, 0.5 - p.prom) : T.stress === 0 ? W.prom * 0.5 * Math.max(0, p.prom - 1) : 0;
    };
    const wordB = p => (p.word === T.word ? -W.wordBonus : 0);
    // Anlaut nur aus Anlauten, Auslaut nur aus Auslauten …; einlautige Wörter passen zu beidem halb
    // Silbenendrand vor einer Endung („treibe-n-s“) klingt wie am Wortende: nur kleiner Aufschlag
    const codaOnly = p => W.codaPos < 1 && T.srole === 'C' && p.srole === 'C' && p.wpos[0] === T.wpos[0];
    const posC = p => p.wpos === T.wpos ? 0 : codaOnly(p) ? W.codaPos * W.wpos
      : (p.wpos === 'IF' || T.wpos === 'IF') && (p.wpos[0] === T.wpos[0] || p.wpos.at(-1) === T.wpos.at(-1)) ? 0.5 * W.wpos : W.wpos;
    // Satzmelodie am Phrasenende: abschließend, fragend, aufzählend
    // Satzmelodie hängt am Vokal der letzten Silbe; Konsonanten tragen sie kaum
    const boundC = p => T.bound && p.bound !== T.bound ? (W.boundVowelOnly && !isVowel(T.t) ? 0 : W.bound) : 0;
    // Lage in der Silbe: Anfangs- und Endkonsonanten klingen verschieden, Wortende ist gelängt
    const roleC = p => (p.srole && T.srole ? (T.srole !== 'N' && p.srole !== T.srole ? W.sylRole : 0)
      + (T.srole !== 'O' && p.slast !== T.slast ? W.sylLast : 0) : 0);
    const reuse = pen.get(i);
    const extra = p => posC(p) + boundC(p) + roleC(p) + (reuse?.has(vowelKey(src, p)) ? W.reuse : 0);
    const L = cands.map(({ p, base }) => ({ p, tc: base + lctx(p) + conf(p) + stressC(p) + wordB(p) + durC(p) + extra(p) }));
    // rechte Hälfte: nur, wenn die Behauchung bis in sie hineinreicht
    // … und bei kurzen Vokalen auch der Knall davor: dann klingt der ganze Vokal nach dem
    // Verschluss („Lipp-g-en“ aus dem „ə“ von „Augen“)
    const leakR = p => (p.voiceOn > p.mid - p.s + 0.01 && canon(p.prevT) !== canon(T.prevT) ? leak(p) : 0)
      + (p.burstIn && isVowel(T.t) && canon(p.prevT) !== canon(T.prevT)
        ? (p.burstIn > 0.5 * (p.e - p.s) ? 4 * W.burstLeak : p.e - p.s < W.shortV ? W.burstLeak : 0) : 0);
    const R = cands.map(({ p, base }) => ({ p, tc: base + vk(p.nextT, T.nextT) * ctxCost(p.nextT, T.nextT) + conf(p) + stressC(p) + wordB(p) + durC(p) + extra(p) + leakR(p) }));
    steps.push(L, R);
  }
  // Beschneiden, aber Fortsetzungen erhalten (sonst gingen ganze Wörter verloren)
  const keep = steps.map(s => [...s].sort((a, b) => a.tc - b.tc).slice(0, K));
  for (let st = 0; st + 2 < steps.length; st += 2) {
    const ids = new Set(keep[st + 2].map(c => c.p.i));
    const want = new Set(keep[st + 1].map(c => c.p.next).filter(n => n >= 0));
    for (const c of steps[st + 2]) if (want.has(c.p.i) && !ids.has(c.p.i)) { keep[st + 2].push(c); keep[st + 3].push(steps[st + 3].find(r => r.p === c.p)); ids.add(c.p.i); }
  }
  for (let st = 0; st < keep.length; st += 2) {   // L und R mit denselben Kandidaten
    const ids = new Set(keep[st].map(c => c.p.i));
    for (const c of keep[st + 1]) if (!ids.has(c.p.i)) { keep[st].push(steps[st].find(l => l.p === c.p)); ids.add(c.p.i); }
    const ids2 = new Set(keep[st + 1].map(c => c.p.i));
    for (const c of keep[st]) if (!ids2.has(c.p.i)) { keep[st + 1].push(steps[st + 1].find(r => r.p === c.p)); }
  }

  const srcPh = src.phones;
  // Leise Schnittstellen (Verschluss, Pause) verdecken Unterschiede
  const mask = E => Math.min(1, Math.max(0.15, (E - (src.loud - W.maskRange)) / 20));
  function join(st, a, b) {                     // Kosten Schritt st-1 (a) → st (b)
    const half = st % 2;                        // 1: L→R innerhalb eines Lauts, 0: Lautgrenze
    if (half === 1) {
      if (a.p === b.p) return 0;
      if (cuts === 'edge' || cuts === 'syll') return BAN;
      const t = tgt.phones[(st - 1) / 2].t;
      const dur = (a.p.mid - a.p.s) + (b.p.e - b.p.mid), min = 0.7 * src.typical(t);
      let c = W.cutMid + mask(Math.max(a.p.Em, b.p.Em)) * featDist(a.p.F.m, b.p.F.m);
      // Profis schneiden gern mitten im „s“ (nicht im „z“): Rauschen verrät keinen Schnitt
      if (/^(s|ʃ|f|x|ç|θ)$/.test(t)) c = W.cutMid * W.fricCut + 0.5 * mask(Math.max(a.p.Em, b.p.Em)) * featDist(a.p.F.m, b.p.F.m);
      if (isVowel(t)) c += W.midVowel; else if (/^[mnŋlrʁɾ]$/.test(t)) c += W.midSonorant;
      c += W.near * Math.min(1, Math.log10(1 + Math.abs(a.p.mid - b.p.mid)) / 2);
      if (dur < min) c += W.dur * (min - dur) / min;
      return c;
    }
    const T = tgt.phones[st / 2 - 1];
    if (!T.pauseAfter && a.p.next === b.p.i) return T.w !== tgt.phones[st / 2].w ? -W.chain : 0;
    if (T.pauseAfter) return 0;                  // Pause: Schnitt fällt in Stille
    if (cuts === 'mid' || (cuts === 'syll' && !syl.has(st / 2))) return BAN;
    // Was in der Quelle auf a folgt, sollte b ähneln, und was b vorausgeht, a.
    const Tn = tgt.phones[st / 2];
    const wordCut = T.w !== Tn.w && a.p.wordFinal && b.p.wordInitial;
    let c = wordCut ? W.cutWord : W.cutEdge;
    const m = mask(Math.max(a.p.Ee, b.p.Es));
    const an = a.p.next >= 0 ? srcPh[a.p.next] : null;
    const bp = b.p.i > 0 && srcPh[b.p.i - 1].next === b.p.i ? srcPh[b.p.i - 1] : null;
    c += m * (an ? featDist(an.F.s, b.p.F.s) : 1.5);
    c += m * (bp ? featDist(bp.F.e, a.p.F.e) : 1.5);
    c += W.near * Math.min(1, Math.log10(1 + Math.abs(a.p.e - b.p.s)) / 2);
    return c;
  }

  // Viterbi
  let prev = keep[0].map(c => ({ cost: c.tc, back: -1 }));
  const backs = [null];
  for (let st = 1; st < keep.length; st++) {
    const cur = keep[st], pc = keep[st - 1];
    const cost = new Float64Array(cur.length), back = new Int32Array(cur.length);
    for (let j = 0; j < cur.length; j++) {
      let best = Infinity, arg = -1;
      for (let i = 0; i < pc.length; i++) {
        const v = prev[i].cost + join(st, pc[i], cur[j]);
        if (v < best) { best = v; arg = i; }
      }
      cost[j] = best + cur[j].tc; back[j] = arg;
    }
    prev = [...cost].map(c => ({ cost: c })); backs.push(back);
  }
  let j = prev.reduce((bi, x, i) => x.cost < prev[bi].cost ? i : bi, 0);
  const total = prev[j].cost;
  const chosen = [], picks = [];
  for (let st = keep.length - 1; st >= 0; st--) { chosen.unshift(keep[st][j]); picks.unshift(j); if (st) j = backs[st][j]; }
  // Kosten je Halblaut (eigene + Übergang davor): zeigt, wie gut ein gebautes Wort passt
  const stepCost = chosen.map((c, st) => c.tc + (st ? join(st, keep[st - 1][picks[st - 1]], c) : 0));
  return { chosen, total, missing, stepCost };
}

// ---------- Plan: Halblaute → zusammenhängende Quellstücke ----------
export function plan(src, tgt, chosen) {
  const segs = [];
  for (let st = 0; st < chosen.length; st++) {
    const { p } = chosen[st];
    const T = tgt.phones[st >> 1];
    const a = st % 2 === 0 ? p.s : p.mid, b = st % 2 === 0 ? p.mid : p.e;
    const last = segs.at(-1);
    // Zusammenhängend in der Quelle: dieselbe Lauthälfte weiter oder der direkte
    // Nachfolger (auch über eine kleine Lücke, die das Alignment gelassen hat)
    const prevP = last && chosen[last.parts.at(-1)].p;
    const contiguous = last && !last.pauseAfter && (st % 2 === 1 ? prevP === p : prevP.next === p.i);
    if (contiguous) { last.end = b; last.parts.push(st); }
    else {
      // Stand in der Quelle ein stimmloser Verschluss davor, ist der Anfang dieses
      // Lauts noch behaucht: erst dort einsetzen, wo die Stimme beginnt.
      const Tp = tgt.phones[(st >> 1) - 1];
      const Tq = st % 2 === 0 ? Tp : T;            // was im Ziel vor dieser Lauthälfte steht
      // ebenso nach dem Knall eines Verschlusses („g“ am Anfang von „ən“ aus „Augen“)
      const onset = p.s + Math.max(p.voiceOn ?? 0, p.burstIn ? p.burstIn + 0.012 : 0);
      const skip = (p.voiceOn > 0 || p.burstIn > 0) && a < onset && (st % 2 === 1 || Tq?.t !== src.phones[p.i - 1]?.t) ? Math.max(0, Math.min(onset - a, b - a - 0.01)) : 0;
      segs.push({ start: a + skip, end: b, parts: [st], pauseAfter: 0, locE: p.locE });
    }
    if (st % 2 === 1 && T.pauseAfter) segs.at(-1).pauseAfter = T.pauseAfter;
    segs.at(-1).lastT = T.t;
  }
  // Endet ein Stück mit einem Vokal, auf den in der Quelle gleich der Vokal des nächsten
  // Worts folgt („ihre | Augen“), steckt im Ende schon dessen Anfang: etwas früher aufhören
  for (const seg of segs) {
    const st = seg.parts.at(-1);
    if (st % 2 === 0 || seg.pauseAfter) continue;
    const p = chosen[st].p, nx = src.phones[p.i + 1];
    if (!nx || p.next !== nx.i || nx.w === p.w || !isVowel(p.t) || !isVowel(nx.t)) continue;
    seg.end = Math.max(seg.start + 0.02, Math.min(seg.end, p.s + 0.7 * (p.e - p.s)));
    seg.vv = true;
  }
  return segs;
}

// ---------- Rendern (48 kHz) ----------
/**
 * TD-PSOLA: Tonhöhe um alpha, Dauer um beta ändern, ohne die Klangfarbe zu
 * verschieben. Analysemarken sitzen eine Grundperiode auseinander auf den
 * Wellenformspitzen; für jede Synthesemarke wird das nächstgelegene Analyse-
 * fenster (2 Perioden, Hann) übernommen und überlappend addiert.
 * f0At(i) liefert die Grundfrequenz am Eingangssample i (0 = stimmlos).
 */
export function psola(x, f0At, alpha, beta, SR = 48000) {
  const marks = [];
  for (let i = 0; i < x.length;) {
    const f = f0At(i), P = f ? Math.round(SR / f) : Math.round(0.008 * SR);
    let j = i;
    if (f) {                                   // auf die Spitze der Periode setzen
      let best = -Infinity;
      for (let k = Math.max(0, i - (P >> 2)); k < Math.min(x.length, i + (P >> 2)); k++) if (x[k] > best) { best = x[k]; j = k; }
    }
    marks.push({ t: j, P, voiced: !!f });
    i = Math.max(i + 1, j + P);
  }
  const outLen = Math.round(x.length * beta), y = new Float32Array(outLen), wsum = new Float32Array(outLen);
  let ts = marks[0]?.t * beta || 0, k = 0;
  while (ts < outLen && marks.length) {
    const ta = ts / beta;
    while (k + 1 < marks.length && Math.abs(marks[k + 1].t - ta) < Math.abs(marks[k].t - ta)) k++;
    const m = marks[k], P = m.P, c = Math.round(ts);
    for (let n = -P; n < P; n++) {
      const xi = m.t + n, yi = c + n;
      if (xi < 0 || xi >= x.length || yi < 0 || yi >= outLen) continue;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * n / P);
      y[yi] += x[xi] * w; wsum[yi] += w;
    }
    const step = (marks[k + 1] ? marks[k + 1].t - m.t : P) || P;   // tatsächlicher Markenabstand
    ts += m.voiced ? step / alpha : step;
  }
  for (let i = 0; i < outLen; i++) if (wsum[i] > 1e-3) y[i] /= Math.max(wsum[i], 0.5);
  return y;
}

/**
 * Prosodie glätten: Jedes Stück wird in der Tonhöhe auf eine gemeinsame,
 * sanft fallende Satzmelodie gezogen (eigene Akzente bleiben zu 35 % erhalten)
 * und auf ein einheitliches Sprechtempo gedehnt/gestaucht.
 */
function prosodyPlan(src, segs) {
  const SR = 48000, med = xs => { const a = [...xs].sort((p, q) => p - q); return a[a.length >> 1]; };
  const nonPause = src.phones.filter(p => !p.pauseAfter && !p.pauseBefore);
  const globalDur = med(nonPause.map(p => p.e - p.s));
  let pos = 0;
  const pts = [];
  for (const seg of segs) {
    const fs = [];
    for (let t = seg.start; t < seg.end; t += 0.01) { const f = f0At(src.a16, Math.round(t * 16000)); if (f) fs.push(Math.log2(f)); }
    seg.lf0 = fs.length >= 3 ? med(fs) : null;
    const mid = (seg.start + seg.end) / 2;
    const near = src.phones.filter(p => Math.abs((p.s + p.e) / 2 - mid) < 1 && !p.pauseAfter && !p.pauseBefore);
    seg.beta = near.length >= 5 ? Math.min(1.25, Math.max(0.8, globalDur / med(near.map(p => p.e - p.s)))) : 1;
    seg.at = pos + (seg.end - seg.start) * seg.beta / 2;
    pos += (seg.end - seg.start) * seg.beta + (seg.pauseAfter ?? 0);
    if (seg.lf0 != null) pts.push({ x: seg.at, y: seg.lf0, w: fs.length });
  }
  // gewichtete Regressionsgerade = Satzmelodie (Deklination)
  const W_ = pts.reduce((a, p) => a + p.w, 0) || 1;
  const mx = pts.reduce((a, p) => a + p.w * p.x, 0) / W_, my = pts.reduce((a, p) => a + p.w * p.y, 0) / W_;
  const sxx = pts.reduce((a, p) => a + p.w * (p.x - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + p.w * (p.x - mx) * (p.y - my), 0);
  const slope = sxx > 1e-6 ? Math.min(0, sxy / sxx) : 0;       // nur fallend oder flach
  for (const seg of segs) {
    if (seg.lf0 == null) { seg.alpha = 1; continue; }
    const line = my + slope * (seg.at - mx);
    const target = line + 0.35 * (seg.lf0 - line);
    seg.alpha = 2 ** Math.max(-4 / 12, Math.min(4 / 12, target - seg.lf0));
  }
}

export function render(src, segs, { xfade = 0.008, search = 0.006, naive = false, prosody = false } = {}) {
  const SR = 48000, A = src.a48;
  A.__a16 = src.a16;
  // Jedes Stück bekommt einen eigenen Puffer (bei Prosodie bearbeitet) mit Rand
  // davor (Suche, Vorlauf) und danach (Überblendung, Ausklang).
  const PRE = Math.round(0.07 * SR), POST = Math.round(0.16 * SR);
  if (prosody && !naive) prosodyPlan(src, segs);
  for (const seg of segs) {
    const s0 = Math.round(seg.start * SR), s1 = Math.round(seg.end * SR);
    if (!prosody || naive || (Math.abs(seg.alpha - 1) < 0.01 && Math.abs(seg.beta - 1) < 0.01)) {
      seg.buf = A; seg.b0 = s0; seg.b1 = s1; seg.f0scale = 1; continue;
    }
    const from = Math.max(0, s0 - PRE), x = A.slice(from, s1 + POST);
    const cache = new Map();
    const fAt = i => {
      const key = Math.round((from + i) / 240);              // 5-ms-Raster
      if (!cache.has(key)) cache.set(key, f0At(src.a16, Math.round(key * 240 / 3)));
      return cache.get(key);
    };
    seg.buf = psola(x, fAt, seg.alpha, seg.beta);
    seg.b0 = Math.round((s0 - from) * seg.beta); seg.b1 = Math.round((s1 - from) * seg.beta);
    seg.f0scale = seg.alpha;
  }
  const X = Math.round(xfade * SR), S = Math.round(search * SR), F = Math.round(0.02 * SR);
  const out = [];
  let tail = null;                     // Fortsetzung des vorigen Stücks (für die Überblendung)
  const byS = new Map(), byE = new Map();
  for (const p of src.phones) { byS.set(p.s, p); byE.set(p.e, p); }
  // Wie lange ist in der Quelle Ruhe nach dem Ende / vor dem Anfang eines Stücks?
  const gapAfter = t => { const p = byE.get(t); return p?.pauseAfter ? (src.phones[p.i + 1]?.s ?? t + 0.5) - t : 0; };
  const gapBefore = t => { const p = byS.get(t); return p?.pauseBefore ? t - (src.phones[p.i - 1]?.e ?? Math.max(0, t - 0.5)) : 0; };

  /** Pause der Länge len: Ausklang des vorigen Stücks → Raumklang → Vorlauf des nächsten. */
  function pause(len, prevEnd, nextStart, s1, lastT = '', nextGain = 1, prevSeg = null, nextSeg = null) {
    const PB = prevSeg?.buf ?? A, NB = nextSeg?.buf ?? A;
    const n = Math.round(len * SR), rt = roomTone(src, len), buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = A[rt + i] ?? 0;
    if (prevEnd != null) {
      const gap = gapAfter(prevEnd);
      // Ausklang: aus der Quelle, wenn dort auch eine Pause folgt, sonst nachgebildet
      // Verschlusslaute klingen nicht nach (Lösung ist schon drin), Dauerlaute schon
      const stop = /^(p|b|t|d|k|ɡ|ts|tʃ|pf)$/.test(lastT);
      // natürlicher Ausklang höchstens 120 ms – danach wird in Pausen oft eingeatmet
      const ring = gap > 0 ? PB.subarray(s1, s1 + Math.round(Math.min(gap - 0.015, len, 0.07) * SR))
        : stop ? PB.subarray(s1, s1 + Math.round(0.012 * SR)) : new Float32Array(0);
      // Dauerlaut ohne Pause in der Quelle: nicht künstlich verlängern (klang wie [f]),
      // sondern die letzten 25 ms sanft ausblenden
      if (gap <= 0 && !stop) {
        const Fo = Math.min(out.length, Math.round(0.025 * SR));
        for (let i = 0; i < Fo; i++) out[out.length - Fo + i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / Fo);
      }
      const tl = Math.min(n, ring.length), fade = Math.min(tl, Math.round((gap > 0 ? 0.06 : stop ? 0.012 : 0.07) * SR));
      for (let i = 0; i < tl; i++) { const w = Math.min(1, (tl - i) / fade); buf[i] = ring[i] * prevGain * w + buf[i] * (1 - w); }
    }
    if (nextStart != null) {
      const pl = Math.min(Math.round(n / 2), Math.round(Math.min(gapBefore(nextStart), 0.05) * SR)), s0 = nextSeg ? nextSeg.b0 : Math.round(nextStart * SR);
      for (let i = 0; i < pl; i++) { const w = Math.min(1, (i + 1) / F); const j = n - pl + i; buf[j] = (NB[s0 - pl + i] ?? 0) * nextGain * w + buf[j] * (1 - w); }
    }
    for (const x of buf) out.push(x);
  }

  // Lautstärke: jedes Stück von seiner lokalen Sprechlautstärke auf die globale bringen
  const segGain = seg => naive || !W.normLoud || seg.locE == null ? 1 : 10 ** (Math.max(-8, Math.min(8, src.globE - seg.locE)) / 20);
  let prevGain = 1;
  if (!naive && segs.length) pause(0.15, null, segs[0].start, 0, '', segGain(segs[0]), null, segs[0]);
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k], B = seg.buf;
    let s0 = seg.b0, s1 = seg.b1;
    seg.o0 = out.length;
    if (tail && !naive) {
      // Einsatzpunkt so verschieben, dass die Wellenform am besten an die Fortsetzung passt
      let best = -Infinity, bd = 0;
      for (let d = -S; d <= S; d++) {
        let num = 0, ea = 1e-9, eb = 1e-9;
        for (let i = 0; i < X; i++) { const x = tail[i], y = B[s0 + d + i] ?? 0; num += x * y; ea += x * x; eb += y * y; }
        const r = num / Math.sqrt(ea * eb);
        if (r > best) { best = r; bd = d; }
      }
      s0 += bd; s1 += bd;
      // Lautstärke angleichen (höchstens ±3 dB)
      const rms = (arr, o, n) => { let e = 1e-12; for (let i = 0; i < n; i++) e += (arr[o + i] ?? 0) ** 2; return Math.sqrt(e / n); };
      // Übergang: am Schnitt an das vorige Stück angleichen (±3 dB), dann binnen 80 ms
      // auf die normalisierte Lautstärke dieses Stücks gleiten
      const G = segGain(seg);
      const g = Math.min(1.41, Math.max(0.71, Math.sqrt(rms(tail, 0, X) / (rms(B, s0, X) * G)))) * G;
      for (let i = 0; i < X; i++) { const w = i / X; out.push(tail[i] * (1 - w) + (B[s0 + i] ?? 0) * g * w); }
      for (let i = s0 + X; i < s1; i++) out.push((B[i] ?? 0) * (g + (G - g) * Math.min(1, (i - s0) / (SR * 0.08))));
      prevGain = G;
    } else {
      const G = segGain(seg), FI = naive ? 0 : Math.round(0.003 * SR);
      for (let i = s0; i < s1; i++) out.push((B[i] ?? 0) * G * (FI ? Math.min(1, (i - s0 + 1) / FI) : 1));
      prevGain = G;
    }
    seg.o1 = out.length;
    // nach einem gekürzten Vokalende („ihre|Augen“) läuft die Fortsetzung nicht weiter,
    // sondern klingt aus, und das nächste Stück setzt weich ein
    tail = Array.from({ length: X }, (_, i) => (B[s1 + i] ?? 0) * prevGain * (seg.vv ? 1 - i / X : 1));
    if (seg.pauseAfter) {
      if (naive) {
        for (let i = 0; i < X; i++) out.push(tail[i] * (1 - i / X));
        const n = Math.round(seg.pauseAfter * SR), rt = roomTone(src, seg.pauseAfter);
        for (let i = 0; i < n; i++) out.push((A[rt + i] ?? 0) * Math.min(1, i / F, (n - i) / F));
      } else pause(seg.pauseAfter, seg.end, segs[k + 1]?.start, s1, seg.lastT, segs[k + 1] ? segGain(segs[k + 1]) : 1, seg, segs[k + 1]);
      tail = null;
    }
  }
  return Float32Array.from(out);
}

/**
 * Ein Laut, der in der Quelle nicht vor einer Pause stand, endet abrupt.
 * Hier klingt er nach: Stimmhaft wird die letzte Grundperiode wiederholt
 * (lückenlos, weil genau eine Periode), stimmlos werden kurze Rauschfenster
 * überlappend aneinandergelegt. Die Hüllkurve fällt dabei ab.
 */
function sustain(A, s1, t, f0scale = 1, a16 = A.__a16) {
  const SR = 48000, len = Math.round(0.09 * SR), out = new Float32Array(len);
  const f0 = (a16 ? f0At(a16, Math.round((t - 0.02) * 16000)) : 0) * f0scale;
  if (f0) {
    const P = Math.round(SR / f0);
    for (let i = 0; i < len; i++) out[i] = A[s1 - P + (i % P)];
  } else {
    const L = Math.round(0.02 * SR), H = L / 2;
    for (let o = 0; o < len; o += H) {
      const from = s1 - L - Math.floor(Math.random() * L);
      for (let i = 0; i < L && o + i < len; i++) out[o + i] += A[from + i] * Math.sin(Math.PI * i / L) ** 2;
    }
  }
  for (let i = 0; i < len; i++) out[i] *= Math.exp(-3.5 * i / len);
  return out;
}

/** Startsample (48 kHz) einer typischen Sprechpause (mittlere Lautstärke), die lang genug ist. */
function roomTone(src, len) {
  if (!src._gaps) {
    const ph = src.phones, E = src.feat.energy;
    src._gaps = [];
    for (let i = 0; i + 1 < ph.length; i++) {
      if (!ph[i].pauseAfter) continue;
      const a = ph[i].e + 0.08, b = ph[i + 1].s - 0.08;   // Abstand zu Ausklang und Einatmen
      if (b - a < 0.1) continue;
      let e = 0, e2 = 0, n = 0;
      for (let f = Math.round(a * 200); f < Math.round(b * 200); f++) { e += E[f]; e2 += E[f] ** 2; n++; }
      const mean = e / n, sd = Math.sqrt(Math.max(0, e2 / n - mean ** 2));
      if (sd < 4) src._gaps.push({ a, b, e: mean });        // nur gleichmäßiger Raumklang
    }
    src._gaps.sort((x, y) => x.e - y.e);
  }
  const long = src._gaps.filter(g => g.b - g.a >= len);
  const g = long.length ? long[Math.floor(long.length * 0.2)] : src._gaps.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x));
  return Math.round(((g.a + g.b) / 2 - len / 2) * 48000);
}

/** 16-bit-PCM-WAV als ArrayBuffer. */
export function encodeWav(data, SR = 48000) {
  const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf);
  const str = (o, x) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), true);
  return buf;
}
