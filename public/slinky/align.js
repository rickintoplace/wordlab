// Erzwungenes CTC-Alignment: Wörter (mit groben Zeiten) → Laute aus dem Lexikon
// → Zeitspannen im Phonem-Posteriorgramm; danach Grenzen per Klangwechsel
// nachgeschärft, Verschlusslösungen an ihre Laute gehängt.
//
// Reine Rechnung ohne Ein-/Ausgabe – läuft im Browser-Worker und in Node.

import { soundClass, phoneVocab } from './phones.js';
import { mfcc } from './dsp.js';

const FPS = 50, FR = 200, BLANK = 0;            // Posteriorgramm 20 ms, Merkmale 5 ms

// Wie weit (in 5-ms-Frames) ein Laut über seine CTC-Spitze hinaus reichen darf
const REACH_VOWEL = /^(a|e|i|o|u|y|ø|œ|ɛ|ɪ|ɔ|ʊ|ɑ|æ|ʌ|ɒ)/;
function maxReach(t) {
  if (t === 'ə' || t === 'ɜ' || t === 'ɚ' || t === 'ɐ') return 22;
  if (REACH_VOWEL.test(t)) return 44;
  if (t === 'h' || t === 'ɾ') return 18;
  return 28;
}

/**
 * @param {object} o
 * @param {{w:string,s:number,e:number}[]} o.words   Transkript mit groben Wortzeiten
 * @param {Float32Array} o.post   log-softmax, frames × V
 * @param {number} o.V
 * @param {string[]} o.vocab      Vokabular des Phonemmodells
 * @param {Float32Array} o.audio16  Mono, 16 kHz (am besten die getrennte Stimme)
 * @param {(word:string)=>{t:string,stress:number}[]} o.pronounce
 * @param {(done:number,total:number)=>void} [o.progress]
 * @returns {{words:object[], phones:object[], sil:number, feat:object}}
 */
export function alignWords({ words, post: P, V, vocab, audio16, pronounce, progress }) {
  const frames = Math.floor(P.length / V);
  const feat = mfcc(audio16, 16000, 80);
  const E = feat.energy;

  // --- Laute pro Wort ---------------------------------------------------------
  const pv = phoneVocab(vocab);
  const classIdx = new Map();
  vocab.forEach((t, i) => { if (!pv.has(t)) return; const c = soundClass(t); (classIdx.get(c) ?? classIdx.set(c, []).get(c)).push(i); });
  const wtoks = words.map((w, wi) => {
    const toks = pronounce(w.w);
    return toks.map((x, k) => ({
      t: x.t, cls: soundClass(x.t), stress: x.stress, w: wi,
      // Schwa vor n/l/m am Wortende fällt oft weg („regnen“ → [ʁeːɡŋ̍])
      optional: x.t === 'ə' && k + 1 < toks.length && /^[nlm]$/.test(toks[k + 1].t) && k + 2 >= toks.length - 1,
    }));
  });

  // --- Gruppen (Sätze/Atemgruppen) --------------------------------------------
  const groups = [];
  let cur = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (w.s - prev.e > 0.4 || /[.!?]$/.test(prev.w) || cur.length >= 30)) { groups.push(cur); cur = []; }
    cur.push(i);
  });
  if (cur.length) groups.push(cur);

  // --- CTC-Viterbi ------------------------------------------------------------
  const emitFor = (cls, f) => {
    const idx = classIdx.get(cls);
    if (!idx) return -30;
    let m = -Infinity;
    for (const v of idx) m = Math.max(m, P[f * V + v]);
    return m;
  };

  function viterbi(tokens, f0, f1) {
    const L = tokens.length, S = 2 * L + 1, T = f1 - f0;
    if (T < L) return null;
    const NEG = -1e18;
    let dp = new Float64Array(S).fill(NEG), nx = new Float64Array(S);
    const bp = new Int32Array(T * S);
    const em = (s, f) => (s % 2 === 0 ? P[f * V + BLANK] : emitFor(tokens[(s - 1) / 2].cls, f));
    dp[0] = em(0, f0); dp[1] = em(1, f0);
    if (tokens[0].optional && S > 3) dp[3] = em(3, f0);
    for (let t = 1; t < T; t++) {
      const f = f0 + t;
      nx.fill(NEG);
      for (let s = 0; s < S; s++) {
        let best = dp[s], arg = s;
        if (s >= 1 && dp[s - 1] > best) { best = dp[s - 1]; arg = s - 1; }
        if (s % 2 === 1 && s >= 3 && tokens[(s - 1) / 2].cls !== tokens[(s - 3) / 2].cls && dp[s - 2] > best) { best = dp[s - 2]; arg = s - 2; }
        if (s % 2 === 0 && s >= 2) {                     // optionalen Laut j überspringen
          const j = s / 2 - 1;
          if (tokens[j].optional) {
            if (dp[s - 2] > best) { best = dp[s - 2]; arg = s - 2; }
            if (s >= 3 && dp[s - 3] > best) { best = dp[s - 3]; arg = s - 3; }
          }
        } else if (s >= 5) {
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

  // --- Grenzen ----------------------------------------------------------------
  const sortedE = Float32Array.from(E).sort();
  const floor = sortedE[Math.floor(E.length * 0.05)], loud = sortedE[Math.floor(E.length * 0.95)];
  const SIL = Math.max(floor + 6, loud - 22);       // Pause: 22 dB unter lauter Sprache

  const silenceBetween = (a, b) => {
    let run = 0, first = -1, last = -1;
    for (let fr = a; fr <= b; fr++) {
      if (E[fr] < SIL) { if (!run) first = fr; run++; }
      else { if (run >= 12) last = fr; else if (last < 0) run = 0; if (last >= 0) break; }
    }
    if (last < 0 && run >= 12) last = b;
    return last >= 0 ? [first, last] : null;
  };
  const edgeOut = (fr, dir, maxFr) => {
    const lim = fr + dir * maxFr;
    while (fr !== lim && fr > 0 && fr < feat.frames - 1 && E[fr] >= SIL) fr += dir;
    return fr;
  };

  // Präfixsummen für die Gleichförmigkeit eines Abschnitts (MFCC + Energie)
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
  const segCost = (a, b) => {
    const n = b - a; if (n <= 0) return 1e9;
    let m2 = 0;
    for (let d = 0; d < D; d++) { const s = PS[b * D + d] - PS[a * D + d]; m2 += s * s; }
    return PS2[b] - PS2[a] - m2 / n;
  };

  /** Optimale Grenzen zwischen CTC-Spitzen: jeder Laut ≥ 15 ms, Abschnitte möglichst gleichförmig. */
  function segmentDP(cs, start, end) {
    const K = cs.length, MIN = 3;
    if (K === 1) return [start, Math.max(end, start + MIN)];
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
    if (bi < 0) {
      const span = Math.max(end - start, K * MIN);
      return Array.from({ length: K + 1 }, (_, i) => start + Math.round(span * i / K));
    }
    const path = [Math.max(end, last[bi] + MIN)];
    for (let k = K - 1; k >= 0; k--) { path.unshift(cand[k][bi]); bi = back[k][bi]; }
    return path;
  }

  // --- Hauptschleife ------------------------------------------------------------
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
    const f0 = Math.max(0, Math.floor(tA * FPS)), f1 = Math.min(frames, Math.ceil(tB * FPS));
    const path = viterbi(tokens, f0, f1);
    if (!path) continue;

    const spans = tokens.map(() => ({ a: -1, b: -1, lp: 0, n: 0, raw: new Map() }));
    path.forEach((s, t) => {
      if (s % 2 === 0) return;
      const j = (s - 1) / 2, sp = spans[j], f = f0 + t;
      if (sp.a < 0) sp.a = f; sp.b = f;
      sp.lp += emitFor(tokens[j].cls, f); sp.n++;
      let rv = -1;                                       // was das Modell ohne Vorgabe hört
      for (let v = 1; v < V; v++) if (pv.has(vocab[v]) && (rv < 0 || P[f * V + v] > P[f * V + rv])) rv = v;
      sp.raw.set(vocab[rv], (sp.raw.get(vocab[rv]) ?? 0) + 1);
    });

    const present = tokens.map((tk, j) => ({ ...tk, ...spans[j] })).filter(x => x.a >= 0);
    if (!present.length) continue;
    const c = present.map(x => Math.round(((x.a + x.b) / 2 + 0.5) / FPS * FR));
    const cuts = [];
    for (let k = 0; k + 1 < present.length; k++) {
      const sil = silenceBetween(c[k], c[k + 1]);
      // Verschlüsse sind auch still: Pause erst ab 150 ms, an Wortgrenzen ab 80 ms
      const len = sil ? sil[1] - sil[0] : 0;
      if (sil && (len >= 30 || (len >= 16 && present[k].w !== present[k + 1].w))) cuts.push([k, ...sil]);
    }
    for (const cut of cuts) { cut[1] = Math.min(cut[1], c[cut[0]] + 50); cut[2] = Math.max(cut[2], c[cut[0] + 1] - 12); }
    let k0 = 0, startFr = edgeOut(c[0], -1, 12);
    for (const [k, endFr, nextFr] of [...cuts, [present.length - 1, edgeOut(c.at(-1), +1, 50), -1]]) {
      const bounds = segmentDP(c.slice(k0, k + 1), startFr, endFr);
      for (let i = k0; i <= k; i++) {
        const x = present[i];
        // Ein Laut bleibt in der Nähe seiner CTC-Spitze: Was weit davon weg liegt
        // (Geräusch, Atem, Reste der Musik), gehört keinem Laut und wird zur Lücke.
        const ext = maxReach(x.t);
        const s = Math.max(bounds[i - k0], Math.round(x.a * 4 + 2.5) - ext);
        let e = Math.min(bounds[i - k0 + 1], s + 80, Math.round(x.b * 4 + 6.5) + ext);   // kein Laut länger als 400 ms
        if (e < s + 3) e = s + 3;
        const raw = [...x.raw.entries()].sort((p, q) => q[1] - p[1])[0][0];
        phones.push({ t: x.t, raw, cls: x.cls, w: x.w, stress: x.stress, s: +(s / FR).toFixed(3), e: +(e / FR).toFixed(3), lp: +(x.lp / x.n).toFixed(2), pauseAfter: i === k });
        lastEnd = Math.max(lastEnd, e / FR);
      }
      k0 = k + 1; startFr = nextFr;
    }
    progress?.(gi + 1, groups.length);
  }

  // Verschlusslösung (Burst) an ihren Laut hängen
  const STOP = /^(p|b|t|d|k|ɡ|ts|tʃ)$/;
  phones.forEach((p, i) => {
    if (!STOP.test(p.t)) return;
    const a = Math.round((p.s - 0.03) * FR), b = Math.round((p.e + 0.05) * FR);
    let best = 0, arg = -1;
    for (let fr = Math.max(8, a); fr <= Math.min(b, feat.frames - 1); fr++) {
      let lo = Infinity;
      for (let k = 2; k <= 8; k++) lo = Math.min(lo, E[fr - k]);
      if (E[fr] - lo > best) { best = E[fr] - lo; arg = fr; }
    }
    if (best < 12) return;
    const burst = arg / FR, nx = phones[i + 1], pv2 = phones[i - 1];
    p.burst = +burst.toFixed(3);
    if (burst > p.e - 0.012) {
      const ne = +(burst + 0.025).toFixed(3);
      if (nx && !p.pauseAfter && nx.e - 0.015 > ne) nx.s = Math.max(nx.s, ne);
      if (!nx || p.pauseAfter || nx.s >= ne) p.e = ne;
    } else if (burst < p.s + 0.008 && pv2 && !pv2.pauseAfter && burst - 0.03 > pv2.s + 0.015) {
      p.s = +(burst - 0.03).toFixed(3); pv2.e = Math.min(pv2.e, p.s);
    }
  });

  // Vokal an Vokal über eine Wortgrenze („ihre | Augen“): Das Modell setzt die Grenze oft
  // zu spät, dann klingt das „au“ im „ihre“ mit. Deutsch setzt dort einen Knacklaut (kurzer
  // Einbruch der Lautstärke); sonst nimmt man die Stelle des stärksten Klangwechsels.
  const VOW = /^(a|e|i|o|u|y|ø|œ|ɛ|ɪ|ɔ|ʊ|ɑ|æ|ʌ|ɒ|ə|ɐ|ɜ)/;
  for (let i = 0; i + 1 < phones.length && !globalThis.SLINKY_NO_VV; i++) {
    const p = phones[i], nx = phones[i + 1];
    if (p.pauseAfter || p.w === nx.w || !VOW.test(p.t) || !VOW.test(nx.t)) continue;
    const a = Math.round((p.s + 0.3 * (p.e - p.s)) * FR), b = Math.round((nx.e - 0.3 * (nx.e - nx.s)) * FR);
    if (b - a < 6) continue;
    let arg = -1, lo = Infinity;
    for (let f = a + 2; f <= b - 2; f++) if (E[f] < lo) { lo = E[f]; arg = f; }
    const edge = Math.min(Math.max(...E.slice(a, a + 3)), Math.max(...E.slice(b - 2, b + 1)));
    if (edge - lo < 4) {
      // kein Knacklaut: größter Sprung der Klangfarbe (MFCC, über 2 Frames)
      let best = -1; arg = -1;
      for (let f = a + 2; f <= b - 2; f++) {
        let d = 0;
        for (let c = 1; c < feat.nC; c++) d += (feat.mfcc[(f + 2) * feat.nC + c] - feat.mfcc[(f - 2) * feat.nC + c]) ** 2;
        if (d > best) { best = d; arg = f; }
      }
    }
    if (arg < 0) continue;
    const t = +(arg / FR).toFixed(3);
    if (t - p.s < 0.02 || nx.e - t < 0.02) continue;
    p.e = t; nx.s = t;
  }

  phones.forEach((p, i) => { const w = outWords[p.w]; if (w.ps < 0) w.ps = i; w.pe = i; });
  for (const w of outWords) if (w.ps >= 0) { w.as = phones[w.ps].s; w.ae = phones[w.pe].e; }
  return { words: outWords, phones, sil: SIL, feat };
}
