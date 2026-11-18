// Feedback-Schleife: Testsätze mit mehreren Einstellungen schneiden, blind anhören lassen, vergleichen.
//   VARIANTS='{"base":{},"len2":{"w":{"lenSwap":2}}}' node loop/run.mjs media/tier12 [loop/sentences.txt]
// Variante: { w: {Gewichte}, lm: 'close,sil,onset' | 'none', onsetDb: 4 }
// Ausgabe: Mittelwerte (Anteil genau gehörter Wörter), Sätze mit Unterschieden, WAVs in out/loop/<name>/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { W, encodeWav } from '../../public/slinky/engine.js';
import { judge, cost } from './judge.mjs';

const [dir, file = new URL('./sentences.txt', import.meta.url).pathname] = process.argv.slice(2);
const variants = JSON.parse(process.env.VARIANTS ?? '{"base":{}}');
const N = +(process.env.N ?? 3), PAR = +(process.env.PAR ?? 4);
const texts = readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.__realFetch = globalThis.fetch;
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
let builtFor = null;
async function build(v) {
  const sig = `${v.lm ?? ''}|${v.onsetDb ?? ''}`;
  if (sig === builtFor) return;
  globalThis.SLINKY_NO_LM = v.lm === 'none';
  globalThis.SLINKY_LM = v.lm && v.lm !== 'none' ? v.lm : undefined;
  globalThis.SLINKY_ONSET_DB = v.onsetDb;
  await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`), ...meta, voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');
  builtFor = sig;
}

const base = { ...W };
const results = {};
for (const [name, v] of Object.entries(variants)) {
  await build(v);
  Object.assign(W, base, v.w ?? {});
  const out = new URL(`../out/loop/${name}/`, import.meta.url);
  mkdirSync(out, { recursive: true });
  const clips = [];
  for (const [i, text] of texts.entries()) {
    const r = await send({ type: 'mix', id: i, text }, m => m.type === 'mixed' || m.type === 'error');
    if (r.type === 'error') { clips.push(null); continue; }
    writeFileSync(new URL(`${i}.wav`, out), Buffer.from(encodeWav(r.audio)));
    clips.push(r.audio);
  }
  const rows = new Array(texts.length);
  let next = 0;
  await Promise.all(Array.from({ length: PAR }, async () => {
    while (next < texts.length) {
      const i = next++;
      rows[i] = clips[i] ? await judge(clips[i], texts[i], N) : { words: 0, chars: 0, heard: ['(Fehler)'] };
    }
  }));
  results[name] = rows;
  const mean = k => rows.reduce((a, x) => a + x[k], 0) / rows.length;
  console.log(`== ${name}: Wörter ${(100 * mean('words')).toFixed(1)} % · Zeichen ${(100 * mean('chars')).toFixed(1)} % · bisher $${cost.spent.toFixed(4)}`);
}
Object.assign(W, base);

// Sätze, bei denen sich die Varianten unterscheiden
const names = Object.keys(results);
if (names.length > 1) for (const [i, text] of texts.entries()) {
  const ws = names.map(n => results[n][i].words);
  if (Math.max(...ws) - Math.min(...ws) < 0.2) continue;
  console.log(`\n${i} ${text}`);
  for (const n of names) console.log(`   ${n.padEnd(10)} ${results[n][i].words.toFixed(2)}  ${results[n][i].heard.map(h => `„${h}“`).join(' ')}`);
}
writeFileSync(new URL('../out/loop/last.json', import.meta.url), JSON.stringify({ texts, results }, null, 1));
console.log(`\nKosten zusammen $${cost.spent.toFixed(4)}`);
