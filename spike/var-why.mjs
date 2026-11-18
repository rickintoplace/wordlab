// Herkunft der Stücke unter mehreren Gewichtsvarianten (ohne Richter).
//   VARIANTS='{"A":{},"B":{"stopCtx":2}}' node var-why.mjs media/tier12 "Der Hase hat eine Nase."
import { readFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { W, buildSource, targetPhones, select, plan, wholeWords } from '../public/slinky/engine.js';
const [dir, ...texts] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang: 'de', words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
const variants = JSON.parse(process.env.VARIANTS ?? '{"A":{}}');
const base = { ...W };
for (const text of texts) for (const [name, w] of Object.entries(variants)) {
  Object.assign(W, base, w);
  const tgt = targetPhones(text, 'de', lex, src);
  const { chosen, total } = select(src, tgt, 250, wholeWords(src, tgt).constrain);
  const segs = plan(src, tgt, chosen);
  console.log(`${name} ${total.toFixed(1).padStart(6)}  ` + segs.map(s => {
    const ps = [...new Set(s.parts.map(st => chosen[st].p))];
    return `${ps.map(p => p.real).join('')}‹${[...new Set(ps.map(p => src.words[p.w].w))].join(' ')}›`;
  }).join(' '));
}
