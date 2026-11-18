// Ein Wort in einer Stelle des Originals ersetzen (wie im Editor: Wort anklicken, neu tippen)
//   node rewrite-word.mjs media/tier12 "Chameleons können ihre Augen" 0 Kamele   (OUT=datei.wav)
import { readFileSync, writeFileSync } from 'node:fs';
import { encodeWav } from '../public/slinky/engine.js';
const [dir, phraseText, wiS, replacement] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
if (process.env.NO_HOME) globalThis.SLINKY_NO_HOME = true;
if (process.env.DBG) globalThis.SLINKY_DEBUG_HOME = true;
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const ready = await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`), ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');
const key = w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const want = phraseText.split(/\s+/).map(key);
const ws = ready.words;
const at = ws.findIndex((_, i) => want.every((k, j) => key(ws[i + j]?.w ?? '') === k));
const si = want.map((_, j) => at + j);
const ph = await send({ type: 'phrase', id: 1, si, speaker: null }, m => m.id === 1);
const r = await send({ type: 'rewrite', id: 2, text: ph.text, speaker: null, force: ph.force, wi: +wiS, replacement }, m => m.id === 2);
if (r.type === 'error') { console.log(r.message); process.exit(1); }
console.log('Stücke:', r.pieces.slice(0, 5).map(p => p.start.toFixed(3) + '-' + p.end.toFixed(3)).join(' '));
console.log(r.text, '→', r.words.map(w => `${w.w}[${w.quality}: ${[...new Set(w.from)].join('+')}]`).join(' '));
if (process.env.OUT) writeFileSync(process.env.OUT, Buffer.from(encodeWav(new Float32Array([...ph.audio, ...new Float32Array(24000), ...r.audio]))));
