// Verständlichkeit (PER) einiger Sätze: mit/ohne Ganzwort-Vorgabe.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../public/slinky/engine.js';
import { loadScorer, hear, targetTokens, per } from './score.mjs';
const [dir, lang, ...texts] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang, words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
await loadScorer();
const f = '/tmp/claude-1000/-home-rick-work-spoonerisms/7f7b31be-a256-44ac-870d-cf333e4745bb/scratchpad/per.wav';
for (const text of texts) {
  const row = [];
  for (const whole of [false, true]) {
    const tgt = targetPhones(text, lang, lex, src);
    const { chosen } = select(src, tgt, 250, whole ? wholeWords(src, tgt).constrain : {});
    const segs = plan(src, tgt, chosen);
    writeFileSync(f, Buffer.from(encodeWav(render(src, segs))));
    row.push(`${segs.length} St. PER ${(100 * per(targetTokens(text, lang), await hear(f))).toFixed(0)} %`);
  }
  console.log(text.padEnd(60), row.join('  |  '));
}
