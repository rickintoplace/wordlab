// Whisper large-v3-turbo mit Wort-Zeitstempeln, über transformers.js.
// Derselbe Code läuft später im Browser (dort mit WebGPU statt CPU).
//
//   node transcribe.mjs media/dino/a16.f32 de > media/dino/words.json

import { readFileSync } from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = new URL('./models/', import.meta.url).pathname;

const [file, language = 'de'] = process.argv.slice(2);
const buf = readFileSync(file);
const audio = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

const t0 = performance.now();
const MODEL = process.env.WHISPER ?? 'onnx-community/whisper-small_timestamped';
const asr = await pipeline('automatic-speech-recognition', MODEL,
  { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'cpu' });
console.error(`Modell geladen: ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const t1 = performance.now();
const out = await asr(audio, {
  language, task: 'transcribe',
  return_timestamps: 'word',
  chunk_length_s: 30, stride_length_s: 5,
});
console.error(`Transkribiert: ${((performance.now() - t1) / 1000).toFixed(1)} s für ${(audio.length / 16000).toFixed(0)} s Audio`);

const words = out.chunks.map(c => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] }));
process.stdout.write(JSON.stringify({ text: out.text, words }, null, 0));
