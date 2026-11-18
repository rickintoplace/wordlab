// Erzwungenes CTC-Alignment: Whisper-Wörter → espeak-Phoneme → Zeitspannen
// im Phonem-Posteriorgramm, danach Grenzen per Spektralwechsel nachgeschärft.
//
//   node align.mjs media/dino   (liest words.json, post.bin, a16.f32; schreibt phones.json)

import { readFileSync, writeFileSync } from 'node:fs';
import { espeak, tokenize, phoneVocab, soundClass, isVowel } from './g2p.mjs';
import { mfcc } from './dsp.mjs';

const dir = process.argv[2];
const lang = process.argv[3] ?? 'de';
const suffix = process.argv[4] ?? '';
const words = JSON.parse(readFileSync(`${dir}/words${suffix}.json`)).words;
const meta = JSON.parse(readFileSync(`${dir}/post${suffix}.json`));
const pb = readFileSync(`${dir}/post${suffix}.bin`);
const P = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4);
const ab = readFileSync(`${dir}/a16${suffix}.f32`);
const audio = new Float32Array(ab.buffer, ab.byteOffset, ab.byteLength / 4);
const { V, vocab } = meta, FPS = 50, BLANK = 0;

const t0 = performance.now();
const feat = mfcc(audio, 16000, 80);        // 5-ms-Raster
const FR = 200;                             // Merkmalsframes pro Sekunde
console.error(`MFCC: ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// --- Phoneme pro Wort --------------------------------------------------------
const pv = phoneVocab(vocab);
const ipa = espeak(words.map(w => w.w), lang);
const classIdx = new Map();                  // Lautklasse → Vokabular-Indizes
vocab.forEach((t, i) => { if (!pv.has(t)) return; const c = soundClass(t); (classIdx.get(c) ?? classIdx.set(c, []).get(c)).push(i); });

const wtoks = words.map((w, wi) => {
  const toks = tokenize(ipa[wi], pv);
  return toks.map((x, k) => ({
    t: x.t, cls: soundClass(x.t), stress: x.stress, w: wi,
    // Schwa vor n/l/m am Wortende fällt oft weg („regnen“ → [ʁeːɡŋ̍])
    optional: x.t === 'ə' && k + 1 < toks.length && /^[nlm]$/.test(toks[k + 1].t) && k + 2 >= toks.length - 1,
  }));
});

// --- Gruppen ---------------------------------------------------------------------
const groups = [];
let cur = [];
words.forEach((w, i) => {
  const prev = words[i - 1];
  if (cur.length && (w.s - prev.e > 0.4 || /[.!?]$/.test(prev.w) || cur.length >= 30)) { groups.push(cur); cur = []; }
  cur.push(i);
});
if (cur.length) groups.push(cur);

// --- CTC-Viterbi -----------------------------------------------------------
function emitFor(cls, f) {
  const idx = classIdx.get(cls);
  if (!idx) return -30;
  let m = -Infinity;
  for (const v of idx) m = Math.max(m, P[f * V + v]);
  return m;
}

function align(tokens, f0, f1) {
  const L = tokens.length, S = 2 * L + 1, T = f1 - f0;
  if (T < L) return null;
  const NEG = -1e18;
  let dp = new Float64Array(S).fill(NEG), nx = new Float64Array(S);
  const bp = new Int32Array(T * S);
  const em = (s, f) => s % 2 === 0 ? P[f * V + BLANK] : emitFor(tokens[(s - 1) / 2].cls, f);
  dp[0] = em(0, f0); dp[1] = em(1, f0);
  if (tokens[0].optional && S > 3) dp[3] = em(3, f0);
  for (let t = 1; t < T; t++) {
    const f = f0 + t;
    nx.fill(NEG);
    for (let s = 0; s < S; s++) {
      let best = dp[s], arg = s;
      if (s >= 1 && dp[s - 1] > best) { best = dp[s - 1]; arg = s - 1; }
      if (s % 2 === 1 && s >= 3 && tokens[(s - 1) / 2].cls !== tokens[(s - 3) / 2].cls && dp[s - 2] > best) { best = dp[s - 2]; arg = s - 2; }
      // optionalen Laut j überspringen
      if (s % 2 === 0 && s >= 2) {                     // Blank nach Token j = s/2-1
        const j = s / 2 - 1;
        if (tokens[j].optional) {
          if (s >= 2 && dp[s - 2] > best) { best = dp[s - 2]; arg = s - 2; }
          if (s >= 3 && dp[s - 3] > best) { best = dp[s - 3]; arg = s - 3; }
        }
      } else if (s >= 5) {                             // Token j+1 direkt nach Token j-1
        const jn = (s - 1) / 2, j = jn - 1;
        if (tokens[j].optional) {
          if (tokens[j - 1].cls !== tokens[jn].cls && dp[s - 4] > best) { best = dp[s - 4]; arg = s - 4; }
          if (dp[s - 3] > best) { best = dp[s - 3]; arg = s - 3; }
        }
      }
      nx[s] = best + em(s, f);
      bp[t * S + s] = arg;
    }
    [dp, nx] = [nx, dp];
  }
  let s = dp[S - 1] >= dp[S - 2] ? S - 1 : S - 2;
  const path = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) { path[t] = s; s = bp[t * S + s]; }
  return path;
}

// --- Grenzen nachschärfen -------------------------------------------------------
const E = feat.energy;
const sortedE = Float32Array.from(E).sort();
const floor = sortedE[Math.floor(E.length * 0.05)], loud = sortedE[Math.floor(E.length * 0.95)];
const SIL = Math.max(floor + 6, loud - 22);   // Pause: 22 dB unter lauter Sprache

function flux(fr) {                          // Spektralwechsel um Frame fr (±3 Frames = 15 ms)
  const n = feat.nC, M = feat.mfcc;
  if (fr < 3 || fr + 3 >= feat.frames) return 0;
  let d = 0;
  for (let c = 0; c < n; c++) {
    let a = 0, b = 0;
    for (let k = 1; k <= 3; k++) { a += M[(fr - k) * n + c]; b += M[(fr + k - 1) * n + c]; }
    d += ((a - b) / 3) ** 2;
  }
  return Math.sqrt(d) + 0.15 * Math.abs(E[fr + 2] - E[fr - 3]);
}

/** Stille (≥ 60 ms) zwischen zwei Merkmalsframes? → [Ende davor, Anfang danach] */
function silenceBetween(a, b) {
  let run = 0, first = -1, last = -1;
  for (let fr = a; fr <= b; fr++) {
    if (E[fr] < SIL) { if (!run) first = fr; run++; }
    else { if (run >= 12) last = fr; else if (last < 0) { run = 0; } if (last >= 0) break; }
  }
  if (last < 0 && run >= 12) last = b;
  return last >= 0 ? [first, last] : null;
}

function edgeOut(fr, dir, maxFr) {           // bis wohin reicht der Laut vor/nach einer Pause?
  const lim = fr + dir * maxFr;
  while (fr !== lim && fr > 0 && fr < feat.frames - 1 && E[fr] >= SIL) fr += dir;
  return fr;
}

// Präfixsummen für die Homogenitätskosten eines Abschnitts (MFCC + Energie)
const D = feat.nC + 1;
const PS = new Float64Array((feat.frames + 1) * D), PS2 = new Float64Array(feat.frames + 1);
for (let f = 0; f < feat.frames; f++) {
  let q = 0;
  for (let d = 0; d < D; d++) {
    const x = d < feat.nC ? feat.mfcc[f * feat.nC + d] : E[f] * 0.3;
    PS[(f + 1) * D + d] = PS[f * D + d] + x; q += x * x;
  }
  PS2[f + 1] = PS2[f] + q;
}
function segCost(a, b) {                      // Frames [a, b): Summe der quadrierten Abweichungen
  const n = b - a; if (n <= 0) return 1e9;
  let m2 = 0;
  for (let d = 0; d < D; d++) { const s = PS[b * D + d] - PS[a * D + d]; m2 += s * s; }
  return PS2[b] - PS2[a] - m2 / n;
}

/**
 * Optimale Grenzen zwischen Lauten: Jede Grenze liegt zwischen den CTC-Spitzen
 * ihrer Nachbarn (±2 Frames Spielraum), jeder Laut ≥ 15 ms, und die Abschnitte
 * sollen in sich möglichst gleichförmig klingen.
 * Rückgabe: K+1 Grenzen in Merkmalsframes, erste = start, letzte = end.
 */
function segmentDP(cs, start, end) {
  const K = cs.length, MIN = 3;
  if (K === 1) return [start, Math.max(end, start + MIN)];
  // Kandidaten pro Grenze k (1..K-1); Grenze 0 = start
  const cand = [[start]];
  for (let k = 0; k < K - 1; k++) {
    const xs = [];
    for (let b = cs[k] - 2; b <= cs[k + 1] + 2; b++) xs.push(b);
    cand.push(xs);
  }
  const cost = [new Float64Array([0])], back = [new Int32Array([0])];
  for (let k = 1; k < K; k++) {
    const xs = cand[k], ps = cand[k - 1], pc = cost[k - 1];
    const c = new Float64Array(xs.length).fill(Infinity), bk = new Int32Array(xs.length).fill(-1);
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < ps.length; j++) {
      if (!isFinite(pc[j]) || xs[i] - ps[j] < MIN) continue;
      const v = pc[j] + segCost(ps[j], xs[i]);
      if (v < c[i]) { c[i] = v; bk[i] = j; }
    }
    cost.push(c); back.push(bk);
  }
  const last = cand[K - 1], lc = cost[K - 1];
  let bi = -1, bv = Infinity;
  for (let i = 0; i < last.length; i++) {
    if (!isFinite(lc[i])) continue;
    const v = lc[i] + segCost(last[i], Math.max(end, last[i] + MIN));
    if (v < bv) { bv = v; bi = i; }
  }
  if (bi < 0) {                                // zu eng: gleichmäßig aufteilen
    const span = Math.max(end - start, K * MIN);
    return Array.from({ length: K + 1 }, (_, i) => start + Math.round(span * i / K));
  }
  const path = [Math.max(end, last[bi] + MIN)];
  for (let k = K - 1; k >= 0; k--) { path.unshift(cand[k][bi]); bi = back[k][bi]; }
  return path;
}

// --- Hauptschleife ---------------------------------------------------------------
const phones = [];
const outWords = words.map(w => ({ ...w, ps: -1, pe: -1 }));
let lastEnd = 0;
for (let gi = 0; gi < groups.length; gi++) {
  const g = groups[gi];
  const tokens = g.flatMap(i => wtoks[i]);
  if (!tokens.length) continue;
  const next = groups[gi + 1];
  const tA = Math.max(lastEnd, words[g[0]].s - 0.5);
  const tB = next ? Math.min(words[next[0]].s, words[g.at(-1)].e + 0.6) : words[g.at(-1)].e + 0.6;
  const f0 = Math.max(0, Math.floor(tA * FPS)), f1 = Math.min(meta.frames, Math.ceil(tB * FPS));
  const path = align(tokens, f0, f1);
  if (!path) { console.error(`Gruppe ${gi} zu kurz`); continue; }

  // Frames pro Token
  const spans = tokens.map(() => ({ a: -1, b: -1, lp: 0, n: 0, heard: new Map(), raw: new Map() }));
  path.forEach((s, t) => {
    if (s % 2 === 0) return;
    const j = (s - 1) / 2, sp = spans[j], f = f0 + t;
    if (sp.a < 0) sp.a = f; sp.b = f;
    sp.lp += emitFor(tokens[j].cls, f); sp.n++;
    let bv = 0;
    for (const v of classIdx.get(tokens[j].cls) ?? []) if (!bv || P[f * V + v] > P[f * V + bv]) bv = v;
    sp.heard.set(vocab[bv], (sp.heard.get(vocab[bv]) ?? 0) + 1);
    // was das Modell ohne Vorgabe hier am ehesten hört
    let rv = -1;
    for (let v = 1; v < V; v++) if (pv.has(vocab[v]) && (rv < 0 || P[f * V + v] > P[f * V + rv])) rv = v;
    sp.raw.set(vocab[rv], (sp.raw.get(vocab[rv]) ?? 0) + 1);
  });

  const present = tokens.map((tk, j) => ({ ...tk, ...spans[j] })).filter(x => x.a >= 0);
  // Spitzenmitten im 5-ms-Raster
  const c = present.map(x => Math.round(((x.a + x.b) / 2 + 0.5) / FPS * FR));
  // Pausen zwischen zwei Spitzen trennen die Gruppe in Abschnitte
  const cuts = [];                                     // [k, Ende Laut k, Anfang Laut k+1]
  for (let k = 0; k + 1 < present.length; k++) {
    const sil = silenceBetween(c[k], c[k + 1]);
    // Verschlüsse (z. B. „Brut|pflege“) sind auch still; als Pause zählt nur
    // Stille ≥ 150 ms oder ≥ 80 ms an einer Wortgrenze.
    const len = sil ? sil[1] - sil[0] : 0;
    if (sil && (len >= 30 || (len >= 16 && present[k].w !== present[k + 1].w))) cuts.push([k, ...sil]);
  }
  // Ränder an Pausen: Anfang höchstens 60 ms vor der ersten Spitze (sonst rutscht
  // Hintergrund mit hinein), Ende höchstens 250 ms nach der letzten.
  for (const cut of cuts) { cut[1] = Math.min(cut[1], c[cut[0]] + 50); cut[2] = Math.max(cut[2], c[cut[0] + 1] - 12); }
  let k0 = 0, startFr = edgeOut(c[0], -1, 12);
  for (const [k, endFr, nextFr] of [...cuts, [present.length - 1, edgeOut(c.at(-1), +1, 50), -1]]) {
    const bounds = segmentDP(c.slice(k0, k + 1), startFr, endFr);
    for (let i = k0; i <= k; i++) {
      const x = present[i];
      const s = bounds[i - k0];
      // kein Laut dauert länger als 400 ms; was darüber hinausgeht, ist Pause oder Fehler
      const e = Math.min(bounds[i - k0 + 1], s + 80);
      const heard = [...x.heard.entries()].sort((p, q) => q[1] - p[1])[0][0];
      const raw = [...x.raw.entries()].sort((p, q) => q[1] - p[1])[0][0];
      phones.push({ t: x.t, heard, raw, cls: x.cls, w: x.w, stress: x.stress, s: +(s / FR).toFixed(3), e: +(e / FR).toFixed(3), lp: +(x.lp / x.n).toFixed(2), pauseAfter: i === k });
      lastEnd = Math.max(lastEnd, e / FR);
    }
    k0 = k + 1; startFr = nextFr;
  }
  process.stderr.write(`\r${gi + 1}/${groups.length}`);
}

// Verschlusslaute: Die Lösung (Burst) gehört zum Laut. Das Alignment schlägt
// sie gern dem Nachbarn zu; dann fehlt beim Ausschneiden das hörbare [t].
const STOP = /^(p|b|t|d|k|ɡ|ts|tʃ)$/;
let moved = 0;
phones.forEach((p, i) => {
  if (!STOP.test(p.t)) return;
  const a = Math.round((p.s - 0.03) * FR), b = Math.round((p.e + 0.05) * FR);
  let best = 0, arg = -1;
  for (let fr = Math.max(8, a); fr <= Math.min(b, feat.frames - 1); fr++) {
    let lo = Infinity;
    for (let k = 2; k <= 8; k++) lo = Math.min(lo, E[fr - k]);
    const rise = E[fr] - lo;
    if (rise > best) { best = rise; arg = fr; }
  }
  if (best < 12) return;                        // ungelöst / kein klarer Burst
  const burst = arg / FR;
  p.burst = +burst.toFixed(3);
  const nx = phones[i + 1], pv = phones[i - 1];
  if (burst > p.e - 0.012) {                    // Burst liegt hinter dem Laut → Laut verlängern
    const ne = +(burst + 0.025).toFixed(3);
    if (nx && !p.pauseAfter && nx.e - 0.015 > ne) { nx.s = Math.max(nx.s, ne); }
    if (!nx || p.pauseAfter || nx.s >= ne) { p.e = ne; moved++; }
  } else if (burst < p.s + 0.008 && pv && !pv.pauseAfter && burst - 0.03 > pv.s + 0.015) {
    p.s = +(burst - 0.03).toFixed(3); pv.e = Math.min(pv.e, p.s); moved++;
  }
});
console.error(`Bursts verschoben: ${moved}`);

// Wortgrenzen aus den Phonemen
phones.forEach((p, i) => {
  const w = outWords[p.w];
  if (w.ps < 0) w.ps = i;
  w.pe = i;
});
for (const w of outWords) if (w.ps >= 0) { w.as = phones[w.ps].s; w.ae = phones[w.pe].e; }

writeFileSync(`${dir}/phones${suffix}.json`, JSON.stringify({ lang, words: outWords, phones, sil: SIL }));
console.error(`\n${phones.length} Laute, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
