// Ideen schneiden und von Whisper anhören lassen (Wortfehlerrate = wie unverständlich).
//   node eval-ideas.mjs media/terra3 lines.txt          (eine Zeile pro Satz)
//   node eval-ideas.mjs media/terra3 --llm [modell]     (neue Ideen holen)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildCost, pickIdeas, generateIdeas, DEFAULT_MODEL, usableLines } from '../public/slinky/ideas.js';
import { encodeWav } from '../public/slinky/engine.js';
import { judge } from './judge.mjs';
const [dir, arg, model = DEFAULT_MODEL] = process.argv.slice(2);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
const realFetch = globalThis.fetch;
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
if (process.env.NOSTEMS) globalThis.SLINKY_NO_STEMS = true;
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const done = t => m => m.type === t || m.type === 'error';
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`),
  ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, done('ready'));

let lines;
if (arg === '--llm') {
  const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
  const t0 = Date.now();
  const r = await generateIdeas({ key, model, words: raw, lang: 'de', fetchFn: realFetch, onStatus: m => console.log(m) });
  console.log(`${model} · ${((Date.now() - t0) / 1000).toFixed(1)} s · $${r.cost} · ${r.lines.length} usable, ${r.dropped.length} dropped`);
  for (const d of r.dropped) console.log(`  dropped: ${d.text}  [${d.missing.join(', ')}]`);
  lines = r.lines;
} else lines = readFileSync(arg, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
if (process.env.STRICT) {
  const { ok, dropped } = usableLines(lines, raw);
  for (const d of dropped) console.log(`  dropped: ${d.text}  [${d.missing.join(', ')}]`);
  lines = ok;
}

const out = new URL('./out/eval/', import.meta.url);
mkdirSync(out, { recursive: true });
const rows = [];
for (const [i, text] of lines.entries()) {
  const r = await send({ type: 'mix', id: i, text }, done('mixed'));
  if (r.type === 'error') { console.log('error', text, r.message); continue; }
  writeFileSync(new URL(`${i}.wav`, out), Buffer.from(encodeWav(r.audio)));
  rows.push({ i, text, audio48: r.audio, cost: buildCost(r.words), pieces: r.pieces.length, nw: r.words.length, q: r.words.map(w => (w.quality === 'whole' ? '·' : w.cost.toFixed(1))).join(' ') });
}
if (process.env.NOJUDGE) { writeFileSync(new URL('rows.json', out), JSON.stringify(rows.map(({ audio48, ...x }) => x))); process.exit(0); }
const judged = await judge(rows, 'de');
const picked = new Set(pickIdeas(judged, 5).map(x => x.i));
for (const x of judged) console.log(`${picked.has(x.i) ? '★' : ' '} ${x.i} wer ${x.wer.toFixed(2)} cost ${x.cost.toFixed(2)} ${x.q} ${x.text}\n        heard: ${x.heard}`);
const avg = a => a.reduce((s, x) => s + x.wer, 0) / Math.max(1, a.length);
console.log(`WER all ${avg(judged).toFixed(2)} · picked ${avg(judged.filter(x => picked.has(x.i))).toFixed(2)}`);
