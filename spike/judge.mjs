// Verständlichkeit messen: Whisper hört geschnittene Sätze, Wortfehlerrate gegen den Zieltext.
//   import { judge } from './judge.mjs';  const r = await judge([{ text, audio48 }], 'de');
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = new URL('./models/', import.meta.url).pathname;
let asr = null;

/** 48 kHz → 16 kHz mit Tiefpass (gefenstertes sinc, 63 Taps). */
export function to16k(x) {
  const T = 63, h = new Float32Array(T), fc = 7600 / 48000;
  let sum = 0;
  for (let i = 0; i < T; i++) {
    const n = i - (T - 1) / 2;
    h[i] = (n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)) * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / (T - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (T - 1)));
    sum += h[i];
  }
  const out = new Float32Array(Math.floor(x.length / 3));
  for (let k = 0; k < out.length; k++) {
    let v = 0;
    for (let i = 0; i < T; i++) { const j = 3 * k + i - (T - 1) / 2; if (j >= 0 && j < x.length) v += x[j] * h[i]; }
    out[k] = v / sum;
  }
  return out;
}

const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Wortfehlerrate (Levenshtein über Wörter). */
export function wer(ref, hyp) {
  const a = norm(ref), b = norm(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / Math.max(1, a.length);
}

export async function judge(items, language = 'de') {
  asr ??= await pipeline('automatic-speech-recognition', 'onnx-community/whisper-small_timestamped',
    { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'cpu' });
  const out = [];
  for (const it of items) {
    const pad = new Float32Array(8000);   // halbe Sekunde Stille davor und danach
    const a = to16k(it.audio48), x = new Float32Array(a.length + 16000);
    x.set(pad, 0); x.set(a, 8000);
    const r = await asr(x, { language, task: 'transcribe' });
    out.push({ ...it, heard: r.text.trim(), wer: wer(it.text, r.text) });
  }
  return out;
}
