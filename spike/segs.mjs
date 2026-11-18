// Stücke eines Satzes mit genauen Quellzeiten und den Lauten drumherum
import { readFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, wholeWords } from '../public/slinky/engine.js';
const [dir, text] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang: 'de', words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
const tgt = targetPhones(text, 'de', lex, src);
const { chosen } = select(src, tgt, 250, wholeWords(src, tgt).constrain);
for (const s of plan(src, tgt, chosen)) {
  const ps = src.phones.filter(p => p.e > s.start + 0.001 && p.s < s.end - 0.001);
  const before = src.phones.filter(p => p.e <= s.start + 0.001).slice(-2), after = src.phones.filter(p => p.s >= s.end - 0.001).slice(0, 2);
  console.log(`${s.start.toFixed(3)}–${s.end.toFixed(3)}  [${before.map(p => p.t).join('')}] ${ps.map(p => `${p.t}(${p.s.toFixed(3)}-${p.e.toFixed(3)})`).join(' ')} [${after.map(p => p.t).join('')}]  ${[...new Set(ps.map(p => src.words[p.w].w))].join(' ')}`);
}
