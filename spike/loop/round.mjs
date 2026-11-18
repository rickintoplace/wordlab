// Eine Hörtest-Runde vorbereiten: Testsätze mit mehreren Einstellungen schneiden und für jeden
// Vergleich die Sätze sammeln, deren Ton sich wirklich unterscheidet (als MP3 für die Hörseite).
//   ROUND=r1 TITLE="…" VARIANTS='{"base":{},"x":{"w":{…}}}' PAIRS='base:x' node loop/round.mjs media/tier12
// Ausgabe: out/hoertest/<ROUND>/*.mp3 und out/hoertest/<ROUND>.json (wird in die Seite eingebettet).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { W, encodeWav } from '../../public/slinky/engine.js';

const [dir, file = new URL('./sentences.txt', import.meta.url).pathname] = process.argv.slice(2);
const ROUND = process.env.ROUND ?? 'r1', TITLE = process.env.TITLE ?? ROUND;
const variants = JSON.parse(process.env.VARIANTS ?? '{"base":{}}');
const pairs = (process.env.PAIRS ?? '').split(',').filter(Boolean).map(p => p.split(':'));
const texts = readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
await send({ type: 'build', key: 'x', lang: 'de', words: JSON.parse(readFileSync(`${dir}/words.json`)).words, post: f32(`${dir}/post.bin`), ...meta, voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');

const out = new URL(`../out/hoertest/${ROUND}/`, import.meta.url);
mkdirSync(out, { recursive: true });
const base = { ...W }, res = {};
for (const [name, v] of Object.entries(variants)) {
  Object.assign(W, base, v.w ?? {});
  res[name] = [];
  for (const [i, text] of texts.entries()) {
    const r = await send({ type: 'mix', id: i, text }, m => m.type === 'mixed' || m.type === 'error');
    if (r.type === 'error') { res[name].push(null); continue; }
    const wav = Buffer.from(encodeWav(r.audio));
    const h = createHash('sha1').update(wav).digest('hex').slice(0, 10);
    const mp3 = `${h}.mp3`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'wav', '-i', '-', '-ac', '1', '-b:a', '96k', new URL(mp3, out).pathname], { input: wav });
    res[name].push({ h, file: `${ROUND}/${mp3}`, words: r.words.map(w => `${w.w}:${w.from.join('+')}:${w.pieces}`) });
  }
  console.log(`${name}: geschnitten`);
}
Object.assign(W, base);

// Paare: nur Sätze mit unterschiedlichem Ton; Seiten zufällig (fester Seed je Runde)
let seed = [...ROUND].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const items = [];
for (const [x, y] of pairs) for (const [i, text] of texts.entries()) {
  const X = res[x][i], Y = res[y][i];
  if (!X || !Y || X.h === Y.h) continue;
  const focus = X.words.map((w, k) => (w !== Y.words[k] ? k : -1)).filter(k => k >= 0);
  const swap = rnd() < 0.5;
  items.push({ id: `${x}-${y}-${i}`, text, focus, a: swap ? Y.file : X.file, b: swap ? X.file : Y.file, av: swap ? y : x, bv: swap ? x : y });
}
for (let k = items.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [items[k], items[j]] = [items[j], items[k]]; }
writeFileSync(new URL(`../out/hoertest/${ROUND}.json`, import.meta.url), JSON.stringify({ id: ROUND, title: TITLE, variants, pairs, items }, null, 1));
console.log(`${items.length} Paare`, Object.fromEntries(pairs.map(([x, y]) => [`${x}:${y}`, items.filter(t => t.id.startsWith(`${x}-${y}-`)).length])));
