// Prüft die Browser-Module (public/slinky) in Node gegen die Spike-Daten.
//   node port-test.mjs media/vlog-voc en
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '../public/slinky/g2p.js';
import { alignWords } from '../public/slinky/align.js';
import { buildSource, targetPhones, select, plan, render, encodeWav } from '../public/slinky/engine.js';
import { loadScorer, hear, targetTokens, per } from './score.mjs';

const [dir, lang] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const words = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const a16 = f32(`${dir}/a16.f32`), a48 = f32(`${dir}/a48.f32`);

let t = performance.now();
const al = alignWords({ words, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: a16,
  pronounce: w => pronounceSync(w, lang, lex).toks });
const old = JSON.parse(readFileSync(`${dir}/phones.json`)).phones;
const mean = ps => (ps.reduce((a, p) => a + p.lp, 0) / ps.length).toFixed(3);
console.log(`Alignment: ${((performance.now() - t) / 1000).toFixed(1)} s, ${al.phones.length} Laute, mittlere log p ${mean(al.phones)} (Spike mit espeak: ${old.length} Laute, ${mean(old)})`);

t = performance.now();
const src = buildSource({ lang, words: al.words, phones: al.phones, a16, a48, feat: al.feat });
console.log(`Quelle: ${((performance.now() - t) / 1000).toFixed(1)} s, Akzent: ${[...src.accent].map(([a, b]) => a + '→' + b).join(' ')}`);
await loadScorer();
const tests = JSON.parse(readFileSync(`${dir}/tests.json`));
for (const { text } of tests) {
  const tgt = targetPhones(text, lang, lex, src);
  const { chosen } = select(src, tgt);
  const segs = plan(src, tgt, chosen);
  const f = `/tmp/claude-1000/-home-rick-work-spoonerisms/7f7b31be-a256-44ac-870d-cf333e4745bb/scratchpad/port.wav`;
  writeFileSync(f, Buffer.from(encodeWav(render(src, segs))));
  const heard = await hear(f);
  console.log(`${text.padEnd(55)} ${segs.length} Stücke  PER ${(100 * per(targetTokens(text, lang), heard)).toFixed(0)} %  ${tgt.wordInfo.map(x => x.source[0]).join('')}  ${heard.join('')}`);
}
