// Stimme und Musik trennen (HT-Demucs FT, Vokal-Spezialist, als ONNX).
// Das Modell nimmt rohe Stereo-Wellenform bei 44,1 kHz und gibt vier Stems
// zurück; verlässlich ist nur „vocals“. Musik = Mischung − Stimme.
//
//   node separate.mjs media/vlog
//   → vocals48.f32, vocals16.f32 (mono) und music48.f32 (mono)

import { execFileSync } from 'node:child_process';
import { writeFileSync, readdirSync } from 'node:fs';
import ort from 'onnxruntime-node';

const dir = process.argv[2];
const video = readdirSync(dir).find(f => f.endsWith('.mp4'));
const SR = 44100, SEG = Math.round(7.8 * SR), OVERLAP = SEG >> 2, STRIDE = SEG - OVERLAP;

const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', `${dir}/${video}`, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const inter = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const N = inter.length / 2;

const sess = await ort.InferenceSession.create(new URL('./models/sep/htdemucs_ft_vocals.onnx', import.meta.url).pathname,
  { intraOpNumThreads: 4, graphOptimizationLevel: 'disabled', enableCpuMemArena: false, enableMemPattern: false });

const win = new Float32Array(SEG).fill(1);
for (let i = 0; i < OVERLAP; i++) { win[i] = i / OVERLAP; win[SEG - 1 - i] = i / OVERLAP; }
const vM = new Float32Array(N), wsum = new Float32Array(N);
const chunks = Math.ceil(N / STRIDE);
const t0 = performance.now();
for (let c = 0; c < chunks; c++) {
  const start = c * STRIDE, end = Math.min(start + SEG, N), len = end - start;
  const x = new Float32Array(2 * SEG);
  for (let i = 0; i < len; i++) { x[i] = inter[2 * (start + i)]; x[SEG + i] = inter[2 * (start + i) + 1]; }
  const { stems } = await sess.run({ mix: new ort.Tensor('float32', x, [1, 2, SEG]) });
  const s = stems.data, V = 3;                           // [1, 4, 2, SEG], Index 3 = vocals
  for (let i = 0; i < len; i++) {
    const w = win[i];
    vM[start + i] += (s[(V * 2 + 0) * SEG + i] + s[(V * 2 + 1) * SEG + i]) / 2 * w;
    wsum[start + i] += w;
  }
  process.stderr.write(`\r${c + 1}/${chunks}  ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
const sec = (performance.now() - t0) / 1000;
console.error(`\n${sec.toFixed(0)} s für ${(N / SR).toFixed(0)} s Audio (${(N / SR / sec).toFixed(2)}× Echtzeit)`);

const voc = vM, mus = wsum;                              // Puffer wiederverwenden
for (let i = 0; i < N; i++) {
  voc[i] /= Math.max(wsum[i], 1e-8);
  mus[i] = (inter[2 * i] + inter[2 * i + 1]) / 2 - voc[i];
}
const resample = (data, rate, file) => {
  const tmp = `${dir}/_tmp44.f32`;
  writeFileSync(tmp, Buffer.from(data.buffer));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', tmp, '-ar', String(rate), '-f', 'f32le', `${dir}/${file}`]);
};
resample(voc, 48000, 'vocals48.f32');
resample(voc, 16000, 'vocals16.f32');
resample(mus, 48000, 'music48.f32');
console.error('→ vocals48.f32, vocals16.f32, music48.f32');
