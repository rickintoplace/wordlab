// Automatische Verständlichkeit: Das Phonemmodell hört sich jede Ausgabe an,
// und wir vergleichen, was es hört, mit den Ziel-Lauten (Fehlerrate auf
// Lautklassen). Ersetzt keine Ohren, aber erlaubt Tuning ohne Hörtest pro Schritt.
//
//   node score.mjs out/dino            (liest report.json + WAVs)

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AutoModelForCTC, AutoFeatureExtractor, env } from '@huggingface/transformers';
import { espeak, tokenize, phoneVocab, soundClass } from './g2p.mjs';

env.cacheDir = new URL('./models/', import.meta.url).pathname;
const MODEL = 'qnighy/wav2vec2-xlsr-53-espeak-cv-ft-ONNX';

let model, fe, vocab, pv;
export async function loadScorer() {
  model = await AutoModelForCTC.from_pretrained(MODEL, { dtype: 'q4', device: 'cpu' });
  fe = await AutoFeatureExtractor.from_pretrained(MODEL);
  vocab = JSON.parse(readFileSync(new URL('./media/dino/post.json', import.meta.url))).vocab;
  pv = phoneVocab(vocab);
}

function decode16k(wav) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

export async function hear(wav) {
  const { input_values } = await fe(decode16k(wav));
  const { logits } = await model({ input_values });
  const [, T, V] = logits.dims, L = logits.data;
  const out = [];
  let prev = -1;
  for (let f = 0; f < T; f++) {
    let b = 0;
    for (let v = 1; v < V; v++) if (L[f * V + v] > L[f * V + b]) b = v;
    if (b !== prev && b !== 0 && pv.has(vocab[b])) out.push(vocab[b]);
    prev = b;
  }
  return out;
}

export function targetTokens(text, lang = 'de') {
  const words = text.split(/\s+/).filter(Boolean);
  return espeak(words, lang).flatMap(ipa => tokenize(ipa, pv).map(x => x.t));
}

/** Levenshtein auf Lautklassen; Schwa darf kostenlos fehlen. */
export function per(ref, hyp) {
  const a = ref.map(soundClass), b = hyp.map(soundClass);
  const D = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) D[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    D[i][j] = Math.min(
      D[i - 1][j] + (a[i - 1] === 'SCHWA' ? 0.3 : 1),
      D[i][j - 1] + 1,
      D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return D[a.length][b.length] / a.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  const report = JSON.parse(readFileSync(`${dir}/report.json`));
  await loadScorer();
  const rows = [];
  for (const t of report) {
    const ref = targetTokens(t.text);
    for (const v of t.versions) {
      const hyp = await hear(`${dir}/${v.file}`);
      const e = per(ref, hyp);
      rows.push({ file: v.file, per: +e.toFixed(3), heard: hyp.join(' ') });
      console.log(`${v.file.padEnd(16)} PER ${(100 * e).toFixed(0).padStart(3)} %   ${hyp.join('')}`);
    }
  }
  writeFileSync(`${dir}/scores.json`, JSON.stringify(rows, null, 1));
}
