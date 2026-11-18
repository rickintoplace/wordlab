// Transkript genau wie stages.js im Browser (manuelle 30-s-Fenster, 25-s-Schritt).
//   node app-transcribe.mjs media/terra/a16.f32 de > media/terra/words.json
import { readFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';
const [file, lang = 'de'] = process.argv.slice(2);
const b = readFileSync(file), a16 = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-small_timestamped', { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
const SR = 16000, WIN = 30 * SR, STEP = 25 * SR, N = a16.length, out = [];
for (let s = 0; s < N; s += STEP) {
  const chunk = a16.subarray(s, Math.min(N, s + WIN));
  const r = await asr(chunk, { language: lang === 'de' ? 'german' : 'english', task: 'transcribe', return_timestamps: 'word' });
  const off = s / SR, lo = s === 0 ? -1 : off + 2.5, hi = s + WIN >= N ? Infinity : off + 27.5;
  for (const c of r.chunks ?? []) {
    const ws = off + (c.timestamp[0] ?? 0), we = off + (c.timestamp[1] ?? c.timestamp[0] ?? 0);
    if (ws >= lo && ws < hi && c.text.trim()) out.push({ w: c.text.trim(), s: ws, e: Math.max(we, ws + 0.05) });
  }
  console.error(s / SR);
  if (s + WIN >= N) break;
}
console.log(JSON.stringify({ words: out }));
