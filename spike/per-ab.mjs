// A/B der Gewichte mit dem Erkenner als Richter: node per-ab.mjs media/terra3 de
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { W, buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../public/slinky/engine.js';
import { loadScorer, hear, targetTokens, per } from './score.mjs';
const [dir, lang] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang, words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
await loadScorer();
const texts = ['Weihrauch', 'Die Forscher haben einen Babydrachen gefunden.', 'Klover ist ein kleiner Dinosaurier mit großen Geheimnissen.',
  'Das Museum hat einen sensationellen Knochen.', 'Wir suchen den Schatz im Wald.', 'Mein Computer frisst Pizza.'];
const variants = { neu: { near: 0, only: p => (src.words[p.w].spk ?? 0) === 0 } };
const f = '/tmp/claude-1000/-home-rick-work-spoonerisms/7f7b31be-a256-44ac-870d-cf333e4745bb/scratchpad/ab.wav';
const base = { ...W }, tot = {};
for (const text of texts) {
  const row = [];
  for (const [name, w] of Object.entries(variants)) {
    Object.assign(W, base, { near: w.near ?? base.near });
    const tgt = targetPhones(text, lang, lex, src);
    const { chosen } = select(src, tgt, 250, wholeWords(src, tgt, w.only).constrain, w.cuts ?? 'all', w.only ?? null);
    const segs = plan(src, tgt, chosen);
    writeFileSync(f, Buffer.from(encodeWav(render(src, segs))));
    const p = per(targetTokens(text, lang), await hear(f));
    tot[name] = (tot[name] ?? 0) + p;
    row.push(`${name} ${segs.length} St. ${(100 * p).toFixed(0)} %`);
  }
  console.log(text.padEnd(58), row.join(' | '));
}
console.log('Mittel:', Object.entries(tot).map(([k, v]) => `${k} ${(100 * v / texts.length).toFixed(1)} %`).join(' · '));
