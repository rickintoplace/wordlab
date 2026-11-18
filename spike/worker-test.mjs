// worker.js in Node ausführen (self/fetch nachgebildet).
//   node worker-test.mjs media/terra "Satz" <wortIndex> <silbenIndex> <suche>
import { readFileSync } from 'node:fs';
const dir = process.argv[2];
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const done = t => m => m.type === t || m.type === 'error';
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const ready = await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`),
  ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, done('ready'));
console.log(ready.type, ready.message ?? '');
const [text, wi = 1, si = 0, q = 'ga'] = process.argv.slice(3);
const t = await send({ type: 'mix', id: 1, text }, done('mixed'));
console.log(t.message ?? '', t.words?.map(w => `${w.w}[${w.quality} ${w.syls.map(y => y.text).join('|')}]`).join(' '));
const v = await send({ type: 'variants', id: 2, text, force: t.force, wi: Number(wi) }, done('variants'));
console.log('Wort:', v.message ?? '', v.options?.map(o => `${o.label} (${o.quality})${o.current ? ' *' : ''} → ${o.words[wi].w}`));
const sv = await send({ type: 'sylVariants', id: 3, text, force: t.force, wi: Number(wi), si: Number(si) }, done('variants'));
console.log('Silbe:', sv.message ?? '', sv.options?.map(o => `${o.label}${o.current ? ' *' : ''} [${o.words[wi].syls.map(y => y.from).join('|')}]`));
