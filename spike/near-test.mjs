// Beinahe-Wörter eines Videos ansehen: node near-test.mjs media/tier12 [Zielwort …]
import { readFileSync } from 'node:fs';
import { funnyWords } from '../public/slinky/funny.js';
import { vocabulary, nearText } from '../public/slinky/ideas.js';
const [dir, ...extra] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const words = raw.map(w => ({ ...w, spk: w.spk ?? 0 }));
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`), ...meta, voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');
const t0 = Date.now();
const r = await send({ type: 'near', id: 1, words: vocabulary(words), targets: [...funnyWords('de'), ...extra] }, m => m.type === 'near' || m.type === 'error');
console.log(`${r.near?.length} Treffer in ${Date.now() - t0} ms\n`);
console.log(nearText(r.near, words));
