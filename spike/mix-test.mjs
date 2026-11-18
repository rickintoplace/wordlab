// Einen Satz mit den App-Modulen schneiden: WAV + Stückliste.
//   node mix-test.mjs media/terra de "Satz" out.wav
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../public/slinky/engine.js';
const [dir, lang, text, out] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang, words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
const tgt = targetPhones(text, lang, lex, src);
const { chosen } = select(src, tgt, 250);
const segs = plan(src, tgt, chosen);
const audio = render(src, segs);
writeFileSync(out, Buffer.from(encodeWav(audio)));
for (const s of segs) {
  const ps = [...new Set(s.parts.map(st => chosen[st].p))];
  console.log(`${s.start.toFixed(2)}-${s.end.toFixed(2)}  out ${s.at?.toFixed?.(2) ?? ''}  ${ps.map(p => p.t).join('')}  ← ${[...new Set(ps.map(p => src.words[p.w].w))].join(' ')}`);
}
