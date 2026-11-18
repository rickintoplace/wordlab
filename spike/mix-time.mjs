import { readFileSync } from 'node:fs';
const [dir, ...texts] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
if (process.env.NOSTEMS) globalThis.SLINKY_NO_STEMS = true;
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const done = t => m => m.type === t || m.type === 'error';
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`),
  ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, done('ready'));
for (const text of texts) {
  const t0 = performance.now();
  const r = await send({ type: 'mix', id: 1, text }, done('mixed'));
  console.log(`${(performance.now() - t0).toFixed(0).padStart(5)} ms  ${r.words.map(w => `${w.w}[${w.from.join('+')}]`).join(' ')}`);
}
