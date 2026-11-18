// Sätze über den Worker schneiden (wie im Browser) und zeigen, woraus jedes Wort gebaut ist.
//   node cut-test.mjs media/tier12 "Satz" ["Satz" …]   (OUT=datei.wav: alle hintereinander)
import { readFileSync, writeFileSync } from 'node:fs';
import { encodeWav } from '../public/slinky/engine.js';
const [dir, ...texts] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
if (process.env.STEMS) globalThis.SLINKY_DEBUG = true;
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const done = t => m => m.type === t || m.type === 'error';
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`),
  ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, done('ready'));
const all = [];
for (const [i, text] of texts.entries()) {
  const r = await send({ type: 'mix', id: i, text }, done('mixed'));
  if (r.type === 'error') { console.log('error', r.message); continue; }
  console.log(text, '→', r.words.map(w => `${w.w}[${w.quality}${w.quality === 'whole' ? '' : ' ' + w.cost?.toFixed(1)}: ${[...new Set(w.from)].join('+')}]`).join(' '));
  if (process.env.STEMS) console.log('   ', globalThis.__slinky.stemReport(text).join(' / '));
  all.push(r.audio, new Float32Array(24000));
}
if (process.env.OUT) { const n = all.reduce((a, x) => a + x.length, 0), o = new Float32Array(n); let k = 0; for (const x of all) { o.set(x, k); k += x.length; } writeFileSync(process.env.OUT, Buffer.from(encodeWav(o))); }
