// Kosten je Halblaut: freie Wahl vs. erzwungene Quelle für einen Ziellaut.
//   node force-cmp.mjs media/tier12 "Der Hase hat eine Nase." 4 haben
//   (Ziellaut 4 muss aus einem Vorkommen von „haben“ kommen; jedes Vorkommen wird probiert)
import { readFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, wholeWords, wordKey } from '../public/slinky/engine.js';
import { alignWords } from '../public/slinky/align.js';
import { pronounceSync } from '../public/slinky/g2p.js';
const [dir, text, ti, word] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
if (process.env.NO_LM) globalThis.SLINKY_NO_LM = true;
const { words, phones } = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: f32(`${dir}/a16.f32`), pronounce: w => pronounceSync(w, 'de', lex).toks });
const src = buildSource({ lang: 'de', words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
const tgt = targetPhones(text, 'de', lex, src);
const { constrain } = wholeWords(src, tgt);
const T = tgt.phones[+ti];
const show = (name, r) => {
  const i = +ti;
  const rows = [];
  for (let st = Math.max(0, 2 * i - 2); st < Math.min(r.chosen.length, 2 * i + 4); st++) {
    const p = r.chosen[st].p;
    rows.push(`${tgt.phones[st >> 1].t}${st % 2 ? 'R' : 'L'}=${p.real}‹${src.words[p.w].w}›${r.stepCost[st].toFixed(1)}`);
  }
  console.log(`${name.padEnd(28)} total ${r.total.toFixed(1)}  ${rows.join('  ')}`);
};
show('frei', select(src, tgt, 250, constrain));
const cands = src.phones.filter(p => wordKey(src.words[p.w].w) === wordKey(word) && p.cls === T.cls);
for (const c of cands.slice(0, 6)) show(`${word}@${c.s.toFixed(2)} ${c.real}`, select(src, tgt, 250, { ...constrain, [ti]: p => p.i === c.i }));
