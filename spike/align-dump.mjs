// Alignment einer Quelle als phones.json speichern (für per-ab.mjs).  node align-dump.mjs media/tier12
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '../public/slinky/g2p.js';
import { alignWords } from '../public/slinky/align.js';
const dir = process.argv[2], lang = 'de';
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const al = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: f32(`${dir}/a16.f32`), pronounce: w => pronounceSync(w, lang, lex).toks });
writeFileSync(`${dir}/phones.json`, JSON.stringify({ words: al.words, phones: al.phones }));
console.log(al.words.length, 'Wörter', al.phones.length, 'Laute');
