// Was passiert akustisch um ein Wort herum? 5-ms-Raster: Pegel, Höhenanteil, stimmhaft, Laut.
//   node frames.mjs media/tier12 angepasst [nr]
import { readFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '../public/slinky/g2p.js';
import { buildSource } from '../public/slinky/engine.js';
import { alignWords } from '../public/slinky/align.js';
import { f0At } from '../public/slinky/dsp.js';
if (process.env.LM) globalThis.SLINKY_LM = process.env.LM;
const [dir, word, nr = 0] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const a16 = f32(`${dir}/a16.f32`), a48 = f32(`${dir}/a48.f32`);
const al = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: a16, pronounce: w => pronounceSync(w, 'de', lex).toks });
const src = buildSource({ lang: 'de', words: al.words, phones: al.phones, a16, a48 });
const sw = src.words.filter(w => w.w.replace(/[^\p{L}]/gu, '').toLowerCase() === word)[+nr];
const ps = src.phones.slice(Math.max(0, sw.ps - 1), sw.pe + 2);
const t0 = ps[0].s, t1 = Math.min(ps.at(-1).e, ps[0].s + 0.6);
console.log(ps.map(p => `${p.real} ${p.s.toFixed(3)}-${p.e.toFixed(3)} burst ${p.burst ?? '-'} voiceOn ${p.voiceOn} burstIn ${p.burstIn}`).join('\n'));
for (let t = t0; t < t1; t += 0.005) {
  const i0 = Math.round(t * 48000), n = 240;
  let e = 1e-12, hf = 1e-12;
  for (let i = i0; i < i0 + n; i++) { e += a48[i] ** 2; const d = a48[i] - a48[i - 1]; hf += d * d; }
  const db = 10 * Math.log10(e / n), r = 10 * Math.log10(hf / e);
  const v = f0At(a16, Math.round((t + 0.0025) * 16000)) ? 'V' : ' ';
  const p = ps.find(q => t >= q.s && t < q.e);
  console.log(`${t.toFixed(3)} ${p?.real.padEnd(2) ?? '  '} ${v} ${db.toFixed(0).padStart(4)} dB ${'#'.repeat(Math.max(0, Math.round((db + 70) / 2)))}`.padEnd(60) + ` hf ${r.toFixed(0)}`);
}
