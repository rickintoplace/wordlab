// Phonem-Wahrscheinlichkeiten pro 20-ms-Frame aus wav2vec2-xlsr-53-espeak-cv-ft.
// Das Modell ist auf Common Voice (mehrsprachig, auch Deutsch) mit
// espeak-Lautschrift trainiert — daher passt espeak-ng als G2P dazu.
//
//   node posteriors.mjs media/dino/a16.f32 media/dino/post.bin
//
// Ausgabe: Float32 log-softmax, frames × vocab, plus post.json mit Metadaten.

import { readFileSync, writeFileSync } from 'node:fs';
import { AutoModelForCTC, AutoFeatureExtractor, env } from '@huggingface/transformers';

env.cacheDir = new URL('./models/', import.meta.url).pathname;
const MODEL = 'qnighy/wav2vec2-xlsr-53-espeak-cv-ft-ONNX';
const SR = 16000, HOP = 320;             // 20 ms pro Frame
const CHUNK = 20 * SR, PAD = 1 * SR;     // 20 s Stücke mit je 1 s Rand

const [file, outFile] = process.argv.slice(2);
const buf = readFileSync(file);
const audio = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

const t0 = performance.now();
const model = await AutoModelForCTC.from_pretrained(MODEL, { dtype: process.env.DTYPE ?? 'q4', device: 'cpu' });
const fe = await AutoFeatureExtractor.from_pretrained(MODEL);
const vocabMap = await (await fetch(`https://huggingface.co/${MODEL}/raw/main/vocab.json`)).json();
console.error(`geladen in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const nFrames = Math.floor(audio.length / HOP);
let V = 0, out = null;
const t1 = performance.now();

for (let start = 0; start < audio.length; start += CHUNK) {
  const a = Math.max(0, start - PAD), b = Math.min(audio.length, start + CHUNK + PAD);
  const { input_values } = await fe(audio.subarray(a, b));
  const { logits } = await model({ input_values });
  const [, T, Vc] = logits.dims;
  if (!out) { V = Vc; out = new Float32Array(nFrames * V).fill(-1e9); }
  const L = logits.data;
  // Frame f des Stücks liegt bei Sample a + f*HOP; nur den Kern [start, start+CHUNK) übernehmen.
  for (let f = 0; f < T; f++) {
    const g = Math.round((a + f * HOP) / HOP);
    if (g * HOP < start || g * HOP >= start + CHUNK || g >= nFrames) continue;
    let max = -Infinity;
    for (let v = 0; v < V; v++) max = Math.max(max, L[f * V + v]);
    let sum = 0;
    for (let v = 0; v < V; v++) sum += Math.exp(L[f * V + v] - max);
    const lse = max + Math.log(sum);
    for (let v = 0; v < V; v++) out[g * V + v] = L[f * V + v] - lse;
  }
  process.stderr.write(`\r${(Math.min(b, audio.length) / SR).toFixed(0)} / ${(audio.length / SR).toFixed(0)} s`);
}
console.error(`\nfertig in ${((performance.now() - t1) / 1000).toFixed(1)} s`);

writeFileSync(outFile, Buffer.from(out.buffer));
const vocab = Object.entries(vocabMap).sort((x, y) => x[1] - y[1]).map(x => x[0]);
writeFileSync(outFile.replace(/\.bin$/, '.json'), JSON.stringify({ frames: nFrames, V, hop: HOP, sr: SR, vocab }));
