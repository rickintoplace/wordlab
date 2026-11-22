// Wortzuordnung prüfen: Wörter ohne Laute (in der Zeitleiste nicht anklickbar), Zahlen, Abstand zu Whisper.
//   node loop/aligncheck.mjs media/tier12 [Wort …]
import { readFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '../../public/slinky/g2p.js';
import { alignWords } from '../../public/slinky/align.js';

const [dir, ...show] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const al = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: f32(`${dir}/a16.f32`), pronounce: w => pronounceSync(w, 'de', lex).toks });
const byW = new Map();
for (const p of al.phones) (byW.get(p.w) ?? byW.set(p.w, []).get(p.w)).push(p);
const none = raw.map((w, i) => i).filter(i => raw[i].e > raw[i].s && !byW.get(i)?.length);
console.log(`${raw.length} Wörter · ohne Laute: ${none.length}${none.length ? ' – ' + none.slice(0, 20).map(i => `„${raw[i].w}“ @${raw[i].s.toFixed(1)}`).join(', ') : ''}`);
const want = new Set(show.map(s => s.toLowerCase()));
raw.forEach((w, i) => {
  if (!/\d/.test(w.w) && !want.has(w.w.toLowerCase().replace(/[^\p{L}\p{N}.]/gu, ''))) return;
  for (const k of [i - 1, i, i + 1]) if (raw[k]) console.log(`  ${k} ${raw[k].w.padEnd(14)} Whisper ${raw[k].s.toFixed(2)}–${raw[k].e.toFixed(2)}  ${(byW.get(k) ?? []).map(p => `${p.t}[${p.s.toFixed(2)}-${p.e.toFixed(2)}]`).join(' ')}`);
});
