// Automatische Bewertung mit echter Vorlage: Sätze, die in der Quelle wirklich gesprochen wurden,
// werden aus dem Rest der Quelle nachgebaut (der Satz selbst und 0,3 s drumherum sind gesperrt).
// Verglichen wird der Nachbau mit der echten Aufnahme:
//   phon  – Abstand der Laut-Wahrscheinlichkeiten (wav2vec2) entlang der besten Zeitzuordnung (DTW)
//           → falsche Vokale, verschluckte Konsonanten, „Fase“ statt „Hase“
//   melo  – Tonhöhenabstand in Halbtönen entlang derselben Zuordnung (Satzmelodie)
//   tempo – |ln(Dauer Nachbau / Dauer echt)|
// Kostenlos, lokal, gleiche Zahlen bei gleicher Eingabe.
//   VARIANTS='{"base":{},"x":{"w":{…}}}' node loop/heldout.mjs media/tier12 [Anzahl Sätze]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { AutoModelForCTC, AutoFeatureExtractor, env } from '@huggingface/transformers';
import { parseLexicon, pronounceSync } from '../../public/slinky/g2p.js';
import { W, buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../../public/slinky/engine.js';
import { alignWords } from '../../public/slinky/align.js';

const [dir, nArg = '30'] = process.argv.slice(2);
const lang = 'de';
const variants = JSON.parse(process.env.VARIANTS ?? '{"base":{}}');
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const a16 = f32(`${dir}/a16.f32`), a48 = f32(`${dir}/a48.f32`);
const al = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: a16, pronounce: w => pronounceSync(w, lang, lex).toks });
const src = buildSource({ lang, words: al.words, phones: al.phones, a16, a48 });

// Testsätze: ganze Sätze mit 1,5–4,5 s aus den Phonem-Zeiten (nicht Whisper: dessen Anfänge sind zu spät)
const sents = [];
let cur = [];
for (const [wi, w] of al.words.entries()) {
  cur.push(wi);
  if (/[.!?]$/.test(w.w)) {
    const ph = src.phones.filter(p => cur.includes(p.w));
    if (ph.length) {
      const t0 = ph[0].s, t1 = ph.at(-1).e, text = cur.map(i => al.words[i].w).join(' ');
      if (t1 - t0 > 1.5 && t1 - t0 < 4.5 && cur.length >= 3 && !/\d/.test(text)) sents.push({ t0, t1, text, words: [...cur] });
    }
    cur = [];
  }
}
const N = Math.min(+nArg, sents.length), step = sents.length / N;
const test = Array.from({ length: N }, (_, k) => sents[Math.floor(k * step)]);

// Phonemmodell
env.cacheDir = new URL('../models/', import.meta.url).pathname;
const MODEL = 'qnighy/wav2vec2-xlsr-53-espeak-cv-ft-ONNX';
const model = await AutoModelForCTC.from_pretrained(MODEL, { dtype: 'q4', device: 'cpu' });
const fe = await AutoFeatureExtractor.from_pretrained(MODEL);
/** Laut-Verteilung je 20-ms-Frame. */
async function post(x16) {
  const { input_values } = await fe(x16);
  const { logits } = await model({ input_values });
  const [, T, V] = logits.dims, L = logits.data, out = [];
  for (let f = 0; f < T; f++) {
    // mit Leerzeichen-Klasse: trennt die Varianten am ehesten so wie das Ohr (Kalibrierung Nov. 2026)
    let m = -Infinity; for (let v = 0; v < V; v++) m = Math.max(m, L[f * V + v]);
    const p = new Float32Array(V); let s = 0;
    for (let v = 0; v < V; v++) { p[v] = Math.exp(L[f * V + v] - m); s += p[v]; }
    for (let v = 0; v < V; v++) p[v] /= s;
    out.push(p);
  }
  return out;
}
const SR16 = 16000;
const down = x48 => { const n = Math.floor(x48.length / 3), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = (x48[3 * i] + x48[3 * i + 1] + x48[3 * i + 2]) / 3; return x; };
/** Grundfrequenz je 20 ms (Autokorrelation, 0 = stimmlos). */
function f0s(x) {
  const hop = 320, n = 640, lo = Math.round(SR16 / 400), hi = Math.round(SR16 / 70), out = [];
  for (let a = 0; a + n + hi < x.length; a += hop) {
    let e0 = 0; for (let i = 0; i < n; i++) e0 += x[a + i] * x[a + i];
    if (e0 < 1e-4 * n) { out.push(0); continue; }
    let best = 0, lag = 0;
    for (let L = lo; L <= hi; L++) { let s = 0, e1 = 0; for (let i = 0; i < n; i++) { s += x[a + i] * x[a + i + L]; e1 += x[a + i + L] * x[a + i + L]; } const r = s / Math.sqrt(e0 * e1 + 1e-12); if (r > best) { best = r; lag = L; } }
    out.push(best > 0.65 ? SR16 / lag : 0);
  }
  return out;
}
/** DTW über Bhattacharyya-Abstand; liefert mittleren Abstand und den Pfad. */
function dtw(A, B) {
  const n = A.length, m = B.length, V = A[0].length;
  const d = (i, j) => { let s = 0; for (let v = 0; v < V; v++) s += Math.sqrt(A[i][v] * B[j][v]); return -Math.log(Math.max(1e-6, s)); };
  const D = new Float64Array((n + 1) * (m + 1)).fill(Infinity), K = new Int32Array((n + 1) * (m + 1));
  D[0] = 0;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const c = d(i - 1, j - 1), I = i * (m + 1) + j;
    const opts = [[D[(i - 1) * (m + 1) + j - 1], K[(i - 1) * (m + 1) + j - 1]], [D[(i - 1) * (m + 1) + j], K[(i - 1) * (m + 1) + j]], [D[i * (m + 1) + j - 1], K[i * (m + 1) + j - 1]]];
    let b = 0; for (let k = 1; k < 3; k++) if (opts[k][0] < opts[b][0]) b = k;
    D[I] = opts[b][0] + c; K[I] = opts[b][1] + 1;
  }
  // Pfad zurück
  const path = []; let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const a = D[(i - 1) * (m + 1) + j - 1], b = D[(i - 1) * (m + 1) + j], c = D[i * (m + 1) + j - 1];
    if (a <= b && a <= c) { i--; j--; } else if (b <= c) i--; else j--;
  }
  return { dist: D[n * (m + 1) + m] / K[n * (m + 1) + m], path: path.reverse(), d };
}

// Vorlagen einmal berechnen
const refs = [];
for (const s of test) {
  const x = a16.subarray(Math.max(0, Math.round((s.t0 - 0.05) * SR16)), Math.round((s.t1 + 0.05) * SR16));
  refs.push({ P: await post(x), F: f0s(x), dur: s.t1 - s.t0 });
}

const base = { ...W }, results = {};
const out = new URL('../out/heldout/', import.meta.url);
for (const [name, v] of Object.entries(variants)) {
  Object.assign(W, base, v.w ?? {});
  mkdirSync(new URL(`${name}/`, out), { recursive: true });
  const rows = [];
  for (const [k, s] of test.entries()) {
    // v.blocks: nur jede n-te Minute der Quelle (wie viel bringt mehr Material?)
    const only = p => (src.words[p.w].spk ?? 0) === 0 && !(p.s < s.t1 + 0.3 && p.e > s.t0 - 0.3) && (!v.blocks || Math.floor(p.s / 60) % v.blocks === 0);
    const tgt = targetPhones(s.text, lang, lex, src);
    const { constrain } = wholeWords(src, tgt, only);
    const { chosen } = select(src, tgt, 250, constrain, 'all', only);
    const audio = render(src, plan(src, tgt, chosen), v.render ?? {});
    writeFileSync(new URL(`${name}/${k}.wav`, out), Buffer.from(encodeWav(audio)));
    // Stille am Rand weg (der Nachbau hat keine 50 ms Rand wie die Vorlage – DTW gleicht das aus)
    const x = down(audio), P = await post(x), F = f0s(x), R = refs[k];
    const { dist, path } = dtw(P, R.P);
    let ms = 0, mn = 0;
    for (const [i, j] of path) if (F[i] && R.F[j]) { ms += (12 * Math.log2(F[i] / R.F[j])) ** 2; mn++; }
    // Tonhöhe ohne Lage (anderer Satz, andere Grundlage): Mittel abziehen
    let mu = 0; for (const [i, j] of path) if (F[i] && R.F[j]) mu += 12 * Math.log2(F[i] / R.F[j]); mu /= Math.max(1, mn);
    let mv = 0; for (const [i, j] of path) if (F[i] && R.F[j]) mv += (12 * Math.log2(F[i] / R.F[j]) - mu) ** 2;
    rows.push({ text: s.text, phon: dist, melo: Math.sqrt(mv / Math.max(1, mn)), tempo: Math.abs(Math.log((audio.length / 48000) / R.dur)) });
  }
  results[name] = rows;
  const mean = key => rows.reduce((a, r) => a + r[key], 0) / rows.length;
  console.log(`== ${name.padEnd(10)} Laute ${mean('phon').toFixed(3)} · Melodie ${mean('melo').toFixed(2)} Ht · Tempo ${mean('tempo').toFixed(3)}`);
}
Object.assign(W, base);
const names = Object.keys(results);
if (names.length > 1) {
  const b = names[0];
  for (const n of names.slice(1)) {
    const d = results[n].map((r, i) => r.phon - results[b][i].phon);
    const better = d.filter(x => x < -0.002).length, worse = d.filter(x => x > 0.002).length;
    const mu = d.reduce((x, y) => x + y, 0) / d.length, sd = Math.sqrt(d.reduce((x, y) => x + (y - mu) ** 2, 0) / Math.max(1, d.length - 1));
    console.log(`   ${n.padEnd(10)} gegen ${b}: Laute besser in ${better}, schlechter in ${worse} von ${test.length} · Mittel ${(1000 * mu).toFixed(1)}‰ (t ${(mu / (sd / Math.sqrt(d.length) + 1e-12)).toFixed(1)})`);
  }
}
writeFileSync(new URL('last.json', out), JSON.stringify({ test: test.map(s => s.text), results }, null, 1));
writeFileSync(new URL('times.json', out), JSON.stringify(test.map(s => [s.t0, s.t1])));
