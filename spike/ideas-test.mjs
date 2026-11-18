// KI-Ideen ohne Browser testen: Prompt aus public/slinky/ideas.js, Schnitt im worker.js.
//   node ideas-test.mjs media/terra3 [modell] [thema]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ideaMessages, parseLines, cutScore, pickIdeas, askOpenRouter, DEFAULT_MODEL } from '../public/slinky/ideas.js';
import { encodeWav } from '../public/slinky/engine.js';
const [dir, model = DEFAULT_MODEL, topic = ''] = process.argv.slice(2);
const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
const realFetch = globalThis.fetch;
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const done = t => m => m.type === t || m.type === 'error';
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`),
  ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, done('ready'));
const t0 = Date.now();
const { content, usage, model: used } = await askOpenRouter({ key, model, messages: ideaMessages({ words: raw, lang: 'de', topic, count: 12 }), effort: process.env.EFFORT || null, fetchFn: realFetch });
console.log(`${used} · ${((Date.now() - t0) / 1000).toFixed(1)} s · ${usage?.prompt_tokens} in / ${usage?.completion_tokens} out · $${usage?.cost}`);
const out = new URL('./out/ideas/', import.meta.url);
mkdirSync(out, { recursive: true });
const tag = model.replace(/\W+/g, '_');
const rows = [];
for (const [i, text] of parseLines(content, 12).entries()) {
  const r = await send({ type: 'mix', id: i, text }, done('mixed'));
  if (r.type === 'error') { console.log('error', text, r.message, r.stack); continue; }
  writeFileSync(new URL(`${tag}-${i}.wav`, out), Buffer.from(encodeWav(r.audio)));
  rows.push({ i, score: cutScore(r.words), text, q: r.words.map(w => w.quality[0]).join('') });
}
const picked = pickIdeas(rows, 5);
for (const x of rows) console.log(`${picked.includes(x) ? '★' : ' '} ${x.score.toFixed(2)}  ${x.q.padEnd(10)} ${x.i}: ${x.text}`);
writeFileSync(new URL(`${tag}-picked.json`, out), JSON.stringify(picked.map(x => x.i)));
