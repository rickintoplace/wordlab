// Kosten je Halblaut: freie Wahl vs. erzwungen am Stück aus einem Quellwort.
//   node why2.mjs media/tier12 treibens treiben 6
import { readFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '../public/slinky/g2p.js';
import { buildSource, targetPhones, select } from '../public/slinky/engine.js';
import { alignWords } from '../public/slinky/align.js';
const [dir, text, srcWord, nForce] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
const { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
const src = buildSource({ lang: 'de', words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
const tgt = targetPhones(text, 'de', lex, src);
const si = src.words.findIndex(w => w.w.toLowerCase().replace(/[^\p{L}]/gu, '') === srcWord);
const sw = src.words[si];
const show = (name, r) => {
  console.log(name, 'total', r.total.toFixed(2));
  r.chosen.forEach((c, st) => { const p = c.p; console.log(`  ${st % 2 ? 'R' : 'L'} ${tgt.phones[st >> 1].t.padEnd(3)} ← ${p.real.padEnd(3)} ${src.words[p.w].w.padEnd(14)} wpos ${p.wpos}/${tgt.phones[st >> 1].wpos} role ${p.srole}${p.slast ? 'L' : ''}/${tgt.phones[st >> 1].srole}${tgt.phones[st >> 1].slast ? 'L' : ''} bound '${p.bound}'/'${tgt.phones[st >> 1].bound}' next ${p.nextT}/${tgt.phones[st >> 1].nextT} cost ${r.stepCost[st].toFixed(2)}`); });
};
show('frei', select(src, tgt, 250, {}));
const con = {};
for (let k = 0; k < Number(nForce); k++) con[k] = p => p.i === sw.ps + k;
show('erzwungen', select(src, tgt, 250, con));
