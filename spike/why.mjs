// Woher kommt jedes Stück eines Satzes? (ohne Richter)
//   node why.mjs media/tier12 "in extremsten Extremräumen"
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../public/slinky/engine.js';
import { alignWords } from '../public/slinky/align.js';
import { pronounceSync } from '../public/slinky/g2p.js';
if (process.env.NO_VV) globalThis.SLINKY_NO_VV = true;
if (process.env.NO_LM) globalThis.SLINKY_NO_LM = true;
if (process.env.LM) globalThis.SLINKY_LM = process.env.LM;
const [dir, text, outWav] = process.argv.slice(2);
const lang = 'de';
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL(`../public/data/slinky/lex-${lang}.txt`, import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const a16 = f32(`${dir}/a16.f32`);
const al = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: a16, pronounce: w => pronounceSync(w, lang, lex).toks });
const src = buildSource({ lang, words: al.words, phones: al.phones, a16, a48: f32(`${dir}/a48.f32`) });
const tgt = targetPhones(text, lang, lex, src);
const { constrain } = wholeWords(src, tgt);
const { chosen, total } = select(src, tgt, 250, constrain);
const segs = plan(src, tgt, chosen);
if (process.env.STEPS) { const r2 = select(src, tgt, 250, constrain); console.log(r2.chosen.map((x, st) => `${tgt.phones[st >> 1].t}${st % 2 ? 'R' : 'L'}:${x.p.real}‹${src.words[x.p.w].w.slice(0, 7)}@${x.p.s.toFixed(2)}›${r2.stepCost[st].toFixed(1)}`).join(' ')); }
console.log('Ziel:', tgt.phones.map(p => p.t).join(' '), '· Kosten', total.toFixed(1));
for (const s of segs) {
  const ps = [...new Set(s.parts.map(st => chosen[st].p))];
  console.log(`  ${ps.map(p => p.real).join('').padEnd(14)} ← ${[...new Set(ps.map(p => src.words[p.w].w))].join(' ')} @${s.start.toFixed(3)}-${s.end.toFixed(3)} [${ps.map(p => `${p.real} ${p.s.toFixed(3)}-${p.e.toFixed(3)}${p.voiceOn ? " vo" + p.voiceOn : ""}${p.burstIn ? " bi" + p.burstIn : ""}`).join(", ")}]`);
}
if (outWav) writeFileSync(outWav, Buffer.from(encodeWav(render(src, segs))));
export { src, tgt };
