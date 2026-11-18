import { readFileSync } from 'node:fs';
import { parseLexicon, pronounceSync } from '/home/rick/work/spoonerisms/public/slinky/g2p.js';
import { buildSource, targetPhones, select, plan, render, encodeWav } from '/home/rick/work/spoonerisms/public/slinky/engine.js';
import { writeFileSync } from 'node:fs';
import { alignWords } from '/home/rick/work/spoonerisms/public/slinky/align.js';
if (process.env.NO_LM) globalThis.SLINKY_NO_LM = true;
if (process.env.LM) globalThis.SLINKY_LM = process.env.LM;
if (process.env.ONSET_DB) globalThis.SLINKY_ONSET_DB = +process.env.ONSET_DB;
const dir = '/home/rick/work/spoonerisms/spike/media/tier12';
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync('/home/rick/work/spoonerisms/public/data/slinky/lex-de.txt', 'utf8'));
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const a16 = f32(`${dir}/a16.f32`);
const al = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: a16, pronounce: w => pronounceSync(w, 'de', lex).toks });
const src = buildSource({ lang: 'de', words: al.words, phones: al.phones, a16, a48: f32(`${dir}/a48.f32`) });
const [text, word, skip] = process.argv.slice(2);
const tgt = targetPhones(text, 'de', lex, src);
const sw = src.words.find(w => w.w.replace(/[^\p{L}]/gu, '').toLowerCase() === word);
console.log('Quelle', sw.w, src.phones.slice(sw.ps, sw.pe + 1).map(p => `${p.real}(${p.lp.toFixed(1)} ${(1000 * (p.e - p.s)).toFixed(0)}ms vo${p.voiceOn} bi${p.burstIn})`).join(' '));
console.log('Ziel  ', tgt.phones.map(p => p.t).join(' '));
const audio = [];
const show = (name, c) => { const r = select(src, tgt, 250, c); audio.push(render(src, plan(src, tgt, r.chosen)), new Float32Array(36000)); console.log(name, r.total.toFixed(1), r.chosen.map((x, st) => `${tgt.phones[st >> 1].t}${st % 2 ? 'R' : 'L'}:${x.p.real}‹${src.words[x.p.w].w.slice(0, 8)}›${r.stepCost[st].toFixed(1)}`).join(' ')); };
show('frei', {});
for (const sv of skip.split('/')) {
  const sk = new Set(sv.split(',').map(Number)), c = {};
  tgt.phones.forEach((p, k) => { if (!sk.has(k)) c[k] = q => q.i === sw.ps + k; });
  show('nah ' + sv, c);
}
if (process.env.OUT) { const n = audio.reduce((a, x) => a + x.length, 0), o = new Float32Array(n); let k = 0; for (const x of audio) { o.set(x, k); k += x.length; } writeFileSync(process.env.OUT, Buffer.from(encodeWav(o))); }
