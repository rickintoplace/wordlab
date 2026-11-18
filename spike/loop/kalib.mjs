// Welches Maß stimmt mit dem Ohr überein? Misst alle Kandidaten am Kalibrierungs-Set
// (out/kalibrierung/key.json) und vergleicht mit den Noten in out/kalibrierung/noten.json
// ({"1": 4, "2": 3, …}, Schulnoten) per Rangkorrelation.
//   node loop/kalib.mjs media/tier12        (im Ordner spike)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { joinMetrics, rate, spent } from './quality.mjs';
import { judge, cost } from './judge.mjs';

const [dir] = process.argv.slice(2);
const K = new URL('../out/kalibrierung/', import.meta.url);
const key = JSON.parse(readFileSync(new URL('key.json', K)));
const MODELS = (process.env.MODELS ?? 'google/gemini-3.5-flash-lite,google/gemini-3.8-flash').split(',');
const SEEDS = +(process.env.SEEDS ?? 2);
const read48 = f => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };

// Worker wie in run.mjs, nur für die Stückgrenzen der geschnittenen Sätze
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.__realFetch = globalThis.fetch;
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
await send({ type: 'build', key: 'x', lang: 'de', words: JSON.parse(readFileSync(`${dir}/words.json`)).words, post: f32(`${dir}/post.bin`), ...meta, voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');

const rows = [];
for (const k of key) {
  const audio = read48(new URL(`${String(k.n).padStart(2, '0')}.wav`, K).pathname);
  let pieces = [{ at: 0, len: audio.length / 48000 }], words = null;
  if (k.kind === 'loop') {
    const r = await send({ type: 'mix', id: k.n, text: k.text }, m => m.type === 'mixed' || m.type === 'error');
    pieces = r.pieces; words = r.words;
  }
  const m = joinMetrics(audio, pieces);
  const row = { n: k.n, text: k.text, kind: k.kind, ...Object.fromEntries(Object.entries(m).filter(([n]) => n !== 'joins')) };
  if (words) {
    row.piecesPerWord = words.reduce((a, w) => a + w.pieces, 0) / words.length;
    row.soundsShare = words.filter(w => w.quality === 'sounds').length / words.length;
  } else { row.piecesPerWord = 1; row.soundsShare = 0; }
  const heard = await judge(audio, k.text, 3);
  row.heardWords = heard.words;
  for (const model of MODELS) {
    const g = [];
    for (let s = 1; s <= SEEDS; s++) g.push(await rate(audio, model, s));
    row[`grade:${model.split('/')[1]}`] = g.reduce((a, x) => a + x.grade, 0) / g.length;
    row[`why:${model.split('/')[1]}`] = g.map(x => x.problems);
  }
  rows.push(row);
  console.log(String(k.n).padStart(2), k.text.slice(0, 34).padEnd(34), MODELS.map(m => row[`grade:${m.split('/')[1]}`].toFixed(1)).join(' '), `Stücke/s ${row.joinsPerSec.toFixed(1)} Ton ${row.pitchMean.toFixed(1)} Pegel ${row.levelMean.toFixed(1)} Spek ${row.specMean.toFixed(2)}`);
}
writeFileSync(new URL('measures.json', K), JSON.stringify(rows, null, 1));
console.log(`Kosten: Noten $${spent.usd.toFixed(4)}`);

// Rangkorrelation mit den Noten aus dem Hörtest
const notes = new URL('noten.json', K);
if (existsSync(notes)) {
  const N = JSON.parse(readFileSync(notes));
  const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const spear = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length, ma = ra.reduce((x, y) => x + y) / n, mb = rb.reduce((x, y) => x + y) / n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (ra[i] - ma) * (rb[i] - mb); sa += (ra[i] - ma) ** 2; sb += (rb[i] - mb) ** 2; } return s / Math.sqrt(sa * sb + 1e-12); };
  const have = rows.filter(r => N[r.n] != null), g = have.map(r => +N[r.n]);
  const keys = Object.keys(rows[0]).filter(k => typeof rows[0][k] === 'number' && k !== 'n');
  console.log(`\nRangkorrelation mit deinen Noten (n=${have.length}; + = höherer Wert ↔ schlechtere Note):`);
  for (const k of keys.map(k => [k, spear(have.map(r => r[k]), g)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) console.log(`  ${k[0].padEnd(28)} ${k[1].toFixed(2)}`);
}
console.log(`Kosten zusammen $${(spent.usd + cost.spent).toFixed(4)}`);
