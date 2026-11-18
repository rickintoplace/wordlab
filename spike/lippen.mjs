// Was hört der Phonemerkenner an der Fuge „ihre | Lippen“ bei verschiedenen Schnitten?
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../public/slinky/engine.js';
import { loadScorer, hear } from './score.mjs';
const dir = 'media/tier12', text = process.argv[2] ?? 'Chameleons können ihre Lippen unabhängig voneinander bewegen';
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang: 'de', words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
const tgt = targetPhones(text, 'de', lex, src);
const { chosen } = select(src, tgt, 250, wholeWords(src, tgt).constrain);
await loadScorer();
const variants = process.env.NOW ? { now: s => s } : {
  now: s => s,
  end50: s => { s[0].end = 400.56; return s; },
  end45: s => { s[0].end = 400.55; return s; },
  noLieben: s => { s.splice(1, 1); s[1].start = 445.02; return s; },
  lFrom445: s => { s.splice(1, 1); s[1].start = 445.05; return s; },
};
for (const [name, f] of Object.entries(variants)) {
  const segs = f(plan(src, tgt, chosen).map(x => ({ ...x })));
  const file = `out/lippen-${name}.wav`;
  writeFileSync(file, Buffer.from(encodeWav(render(src, segs))));
  console.log(name.padEnd(10), (await hear(file)).join(''));
}
