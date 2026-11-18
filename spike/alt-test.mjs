// Alternativen eines Worts wie im Feld:  node alt-test.mjs media/tier12 "Satz" wortIndex
import { readFileSync } from 'node:fs';
const [dir, text, wi = 0] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const done = t => m => m.type === t || m.type === 'error';
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`),
  ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, done('ready'));
const t = await send({ type: 'mix', id: 1, text }, done('mixed'));
console.log(t.words.map(w => `${w.w}[${w.quality} ${w.cost}]`).join(' '));
const t0 = Date.now();
const v = await send({ type: 'variants', id: 2, text, force: t.force, wi: Number(wi) }, done('variants'));
console.log(`${Date.now() - t0} ms`);
for (const o of v.options) console.log(`  ${o.current ? '●' : '○'} ${o.best ? '[best] ' : ''}${o.label}  · fit ${o.fit?.toFixed(1)} · ${o.quality} ${o.words[wi].cost}`);
