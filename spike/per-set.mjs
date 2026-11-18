// Phonem-Fehlerrate eines Satzsets mit der aktuellen Engine (Richter: Phonemerkenner).
//   node per-set.mjs media/tier12 [ausgabe.wav-Präfix]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../public/slinky/engine.js';
import { loadScorer, hear, targetTokens, per } from './score.mjs';
const [dir, prefix, textFile] = process.argv.slice(2);
const lang = 'de';
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang, words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
await loadScorer();
const texts = [
  'selbst in extremsten Extremräumen.',
  'Die Löwen jagen Pinguine im Wasser.',
  'Der Spitzenpinguin frisst Sardellen.',
  'Raubfische lieben kühlen Schatten.',
  'Wasserlöwen haben immer Hunger.',
  'Mein Computer frisst Pizza.',
  'Die Jägerin trinkt alleine.',
  'Großkatzen sind schnelle Fischfresser.',
];
if (textFile) texts.splice(0, texts.length, ...readFileSync(textFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean));
const f = new URL('./out/per-set.wav', import.meta.url).pathname;
let tot = 0;
for (const [i, text] of texts.entries()) {
  const tgt = targetPhones(text, lang, lex, src);
  const { chosen } = select(src, tgt, 250, wholeWords(src, tgt).constrain);
  const segs = plan(src, tgt, chosen);
  const audio = render(src, segs);
  writeFileSync(f, Buffer.from(encodeWav(audio)));
  if (prefix) writeFileSync(`${prefix}-${i}.wav`, Buffer.from(encodeWav(audio)));
  const p = per(targetTokens(text, lang), await hear(f));
  tot += p;
  console.log(`${(100 * p).toFixed(0).padStart(3)} %  ${String(segs.length).padStart(2)} St.  ${text}`);
}
console.log(`Mittel ${(100 * tot / texts.length).toFixed(1)} %`);
