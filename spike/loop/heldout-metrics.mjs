// Weitere Abstandsmaße auf den gespeicherten Nachbauten von heldout.mjs (ohne neu zu schneiden):
// Logits (Kosinus), Laut-Verteilung mit Leerzeichen, Mel-Spektrum. Welches trennt die Varianten so,
// wie das Ohr entschieden hat?   node loop/heldout-metrics.mjs media/tier12
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AutoModelForCTC, AutoFeatureExtractor, env } from '@huggingface/transformers';

const [dir] = process.argv.slice(2);
const H = new URL('../out/heldout/', import.meta.url);
const last = JSON.parse(readFileSync(new URL('last.json', H)));
const names = Object.keys(last.results);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const read16 = f => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };
env.cacheDir = new URL('../models/', import.meta.url).pathname;
const MODEL = 'qnighy/wav2vec2-xlsr-53-espeak-cv-ft-ONNX';
const model = await AutoModelForCTC.from_pretrained(MODEL, { dtype: 'q4', device: 'cpu' });
const fe = await AutoFeatureExtractor.from_pretrained(MODEL);
async function logits(x) { const { input_values } = await fe(x); const { logits: l } = await model({ input_values }); const [, T, V] = l.dims; return Array.from({ length: T }, (_, f) => l.data.slice(f * V, (f + 1) * V)); }
// Log-Mel (24 Bänder) je 20 ms, simple DFT
function mel(x) {
  const n = 512, hop = 320, out = [], B = 24, fmax = 8000;
  const mel = f => 2595 * Math.log10(1 + f / 700), imel = m => 700 * (10 ** (m / 2595) - 1);
  const edges = Array.from({ length: B + 2 }, (_, i) => imel(mel(60) + (mel(fmax) - mel(60)) * i / (B + 1)));
  const cos = new Float32Array(n * 257), sin = new Float32Array(n * 257);
  for (let k = 0; k < 257; k++) for (let i = 0; i < n; i++) { cos[k * n + i] = Math.cos(2 * Math.PI * k * i / n); sin[k * n + i] = Math.sin(2 * Math.PI * k * i / n); }
  for (let a = 0; a + n < x.length; a += hop) {
    const pw = new Float32Array(257);
    for (let k = 0; k < 257; k++) { let re = 0, im = 0; for (let i = 0; i < n; i++) { const w = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); re += w * cos[k * n + i]; im += w * sin[k * n + i]; } pw[k] = re * re + im * im; }
    const v = new Float32Array(B);
    for (let b = 0; b < B; b++) { let s = 1e-8; for (let k = 0; k < 257; k++) { const f = k * 8000 / 256; const w = f < edges[b] || f > edges[b + 2] ? 0 : f < edges[b + 1] ? (f - edges[b]) / (edges[b + 1] - edges[b]) : (edges[b + 2] - f) / (edges[b + 2] - edges[b + 1]); s += w * pw[k]; } v[b] = Math.log(s); }
    const mu = v.reduce((p, q) => p + q, 0) / B; for (let b = 0; b < B; b++) v[b] -= mu;  // Pegel weg
    out.push(v);
  }
  return out;
}
function dtw(A, B, d) {
  const n = A.length, m = B.length, D = new Float64Array((n + 1) * (m + 1)).fill(Infinity), K = new Int32Array((n + 1) * (m + 1));
  D[0] = 0;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const I = i * (m + 1) + j, a = (i - 1) * (m + 1) + j - 1, b = (i - 1) * (m + 1) + j, c = i * (m + 1) + j - 1;
    const best = D[a] <= D[b] && D[a] <= D[c] ? a : D[b] <= D[c] ? b : c;
    D[I] = D[best] + d(A[i - 1], B[j - 1]); K[I] = K[best] + 1;
  }
  return D[n * (m + 1) + m] / K[n * (m + 1) + m];
}
const cosd = (a, b) => { let s = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return 1 - s / Math.sqrt(x * y + 1e-12); };
const eucl = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };
const smx = l => { let m = -Infinity; for (const v of l) m = Math.max(m, v); let s = 0; const p = l.map(v => { const e = Math.exp(v - m); s += e; return e; }); return p.map(v => v / s); };
const bha = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]); return -Math.log(Math.max(1e-6, s)); };

// Vorlagen
const a16 = f32(`${dir}/a16.f32`);
const { test } = last;
// Zeiten der Vorlagen wie in heldout.mjs: dort nicht gespeichert → aus dem Nachbau „r0“ nicht ableitbar; heldout.mjs schreibt sie mit
const times = JSON.parse(readFileSync(new URL('times.json', H)));
const refs = [];
for (const [k] of test.entries()) {
  const [t0, t1] = times[k];
  const x = a16.subarray(Math.max(0, Math.round((t0 - 0.05) * 16000)), Math.round((t1 + 0.05) * 16000));
  const L = await logits(x);
  refs.push({ L, P: L.map(smx), M: mel(x) });
}
const res = {};
for (const n of names) {
  res[n] = [];
  for (const [k] of test.entries()) {
    const x = read16(new URL(`${n}/${k}.wav`, H).pathname), L = await logits(x), R = refs[k];
    res[n].push({ logit: dtw(L, R.L, cosd), blank: dtw(L.map(smx), R.P, bha), mel: dtw(mel(x), R.M, eucl) });
  }
  const m = key => res[n].reduce((a, r) => a + r[key], 0) / res[n].length;
  console.log(`== ${n.padEnd(10)} Logits ${m('logit').toFixed(4)} · Verteilung ${m('blank').toFixed(4)} · Mel ${m('mel').toFixed(3)}`);
}
