// Alignment mit den App-Modulen, als phones.json für Sichtprüfung.
//   node diag.mjs media/terra de
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '../public/slinky/g2p.js';
import { alignWords } from '../public/slinky/align.js';
const [dir, lang] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const words = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const al = alignWords({ words, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: f32(`${dir}/a16.f32`),
  pronounce: w => pronounceSync(w, lang, lex).toks });
writeFileSync(`${dir}/phones.json`, JSON.stringify({ words: al.words, phones: al.phones }));
for (const w of al.words) {
  const ps = al.phones.slice(w.ps, w.pe + 1);
  console.log(w.w.padEnd(20), `whisper ${w.s.toFixed(2)}-${w.e.toFixed(2)}  ctc ${w.as?.toFixed(2)}-${w.ae?.toFixed(2)}`, ps.map(p => `${p.t}${p.raw !== p.t ? '(' + p.raw + ')' : ''}:${p.s.toFixed(2)}`).join(' '));
}
