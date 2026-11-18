// Pegel (5 ms) eines gerenderten Satzes rund um die Schnitte: Wo entsteht eine Lücke?
//   LM=close,sil node junction.mjs "angefasst." angepasst 4,5,6,7
import { readFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, render } from '../public/slinky/engine.js';
import { alignWords } from '../public/slinky/align.js';
if (process.env.NO_LM) globalThis.SLINKY_NO_LM = true;
if (process.env.LM) globalThis.SLINKY_LM = process.env.LM;
const dir = 'media/tier12';
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync('../public/data/slinky/lex-de.txt', 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const a16 = f32(`${dir}/a16.f32`);
const al = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: a16, pronounce: w => pronounceSync(w, 'de', lex).toks });
const src = buildSource({ lang: 'de', words: al.words, phones: al.phones, a16, a48: f32(`${dir}/a48.f32`) });
const [text, word, skip] = process.argv.slice(2);
const tgt = targetPhones(text, 'de', lex, src);
const sw = src.words.find(w => w.w.replace(/[^\p{L}]/gu, '').toLowerCase() === word);
const sk = new Set((skip ?? '').split(',').filter(Boolean).map(Number)), c = {};
if (skip != null) tgt.phones.forEach((p, k) => { if (!sk.has(k)) c[k] = q => q.i === sw.ps + k; });
const r = select(src, tgt, 250, c);
const segs = plan(src, tgt, r.chosen);
const out = render(src, segs);
for (const s of segs) console.log(`seg ${s.start.toFixed(3)}-${s.end.toFixed(3)} → out ${(s.o0 / 48000).toFixed(3)}-${(s.o1 / 48000).toFixed(3)}  ${s.parts.map(st => r.chosen[st].p.real + (st % 2 ? 'R' : 'L')).join(' ')}`);
const from = +(process.env.FROM ?? 0), to = +(process.env.TO ?? out.length / 48000);
for (let t = from; t < to; t += 0.005) {
  let e = 1e-12; const i0 = Math.round(t * 48000);
  for (let i = i0; i < i0 + 240; i++) e += (out[i] ?? 0) ** 2;
  const db = 10 * Math.log10(e / 240);
  console.log(t.toFixed(3), db.toFixed(0).padStart(4), '#'.repeat(Math.max(0, Math.round((db + 70) / 2))));
}
