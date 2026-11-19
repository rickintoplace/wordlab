// Schlechte Schnitte an Wortgrenzen (nach dem Vorbild von Yarn/Quebec, ohne menschliche Marken):
// Jedes Wort der Quelle wird so ausgeschnitten, wie Slinky-Cut ein ganzes Wort schneidet, und das
// Phonemmodell hört es sich allein an. Am Rand zählt:
//   Rest vorn/hinten – ein fremder Laut vor dem ersten bzw. nach dem letzten Ziellaut (Nachbarwort)
//   angeschnitten     – der erste bzw. letzte Ziellaut fehlt
// Vergleich zweier Einstellungen auf denselben Wörtern (gleiche Zahlen bei gleicher Eingabe).
//   VARIANTS='{"jetzt":{},"ohneLM":{"lm":"none"}}' node loop/badcut.mjs media/tier12 [Anzahl]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { W, encodeWav } from '../../public/slinky/engine.js';
import { loadScorer, hear, targetTokens } from '../score.mjs';
import { soundClass } from '../g2p.mjs';

const [dir, nArg = '300'] = process.argv.slice(2);
const variants = JSON.parse(process.env.VARIANTS ?? '{"jetzt":{}}');
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
async function build(v) {
  globalThis.SLINKY_NO_LM = v.lm === 'none';
  globalThis.SLINKY_LM = v.lm && v.lm !== 'none' ? v.lm : undefined;
  globalThis.SLINKY_ONSET_DB = v.onsetDb;
  globalThis.SLINKY_EDGE_OUT = v.edge;
  globalThis.SLINKY_NO_STEAL = !!v.noSteal;
  globalThis.SLINKY_FADE_END = v.fade;
  await send({ type: 'build', key: `x${Math.random()}`, lang: 'de', words: raw, post: f32(`${dir}/post.bin`), ...meta, voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');
}
await loadScorer();

// Wörter: mindestens 3 Laute, ohne Ziffern, gleichmäßig über die Quelle
const ok = raw.map((w, i) => i).filter(i => raw[i].e > raw[i].s && !/\d/.test(raw[i].w) && raw[i].w.replace(/[^\p{L}]/gu, '').length >= 3 && (raw[i].spk ?? 0) === 0);
const N = Math.min(+nArg, ok.length), pick = Array.from({ length: N }, (_, k) => ok[Math.floor(k * ok.length / N)]);

/** Rand-Fehler: Ziel- gegen gehörte Lautklassen ausrichten (Levenshtein), dann die Ränder ansehen. */
function edges(ref, hyp) {
  const a = ref.map(soundClass), b = hyp.map(soundClass), n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i && j && D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { ops.push(a[i - 1] === b[j - 1] ? 'M' : 'S'); i--; j--; }
    else if (i && D[i][j] === D[i - 1][j] + 1) { ops.push('D'); i--; }
    else { ops.push('I'); j--; }
  }
  ops.reverse();
  const s = ops.join('');
  return { leadIns: /^I+/.test(s), leadDel: /^D/.test(s), tailIns: /I+$/.test(s), tailDel: /D$/.test(s), per: D[n][m] / Math.max(1, n), ops: s };
}

const SP = new URL('../out/badcut/', import.meta.url);
mkdirSync(SP, { recursive: true });
const results = {};
for (const [name, v] of Object.entries(variants)) {
  await build(v);
  const base = { ...W };
  Object.assign(W, v.w ?? {});
  const rows = [];
  for (const i of pick) {
    const r = await send({ type: 'phrase', id: i, si: [i] }, m => m.type === 'phrase' || m.type === 'error');
    if (r.type === 'error') continue;
    const f = new URL(`${name}-${i}.wav`, SP).pathname;
    // 0,2 s Stille an beiden Seiten, damit das Modell den Rand als Rand hört
    const pad = new Float32Array(9600), a = new Float32Array(r.audio.length + 2 * pad.length);
    a.set(r.audio, pad.length);
    writeFileSync(f, Buffer.from(encodeWav(a)));
    const h = await hear(f), ref = targetTokens(raw[i].w);
    rows.push({ i, w: raw[i].w, ...edges(ref, h), heard: h.join('') });
  }
  Object.assign(W, base);
  results[name] = rows;
  const pct = k => (100 * rows.filter(x => x[k]).length / rows.length).toFixed(1);
  console.log(`== ${name.padEnd(10)} ${rows.length} Wörter · Rest vorn ${pct('leadIns')} % · vorn angeschnitten ${pct('leadDel')} % · Rest hinten ${pct('tailIns')} % · hinten angeschnitten ${pct('tailDel')} % · Lautfehler ${(100 * rows.reduce((x, y) => x + y.per, 0) / rows.length).toFixed(1)} %`);
}
const names = Object.keys(results);
if (names.length > 1) {
  const [a, b] = names;
  const A = new Map(results[a].map(x => [x.i, x])), bad = x => x.leadIns + x.leadDel + x.tailIns + x.tailDel;
  let better = 0, worse = 0;
  const ex = [];
  for (const y of results[b]) { const x = A.get(y.i); if (!x) continue; const d = bad(y) - bad(x); if (d < 0) better++; if (d > 0) { worse++; if (ex.length < 12) ex.push(`  „${y.w}“ ${a}: ${x.heard} → ${b}: ${y.heard}`); } }
  console.log(`${b} gegen ${a}: weniger Randfehler bei ${better}, mehr bei ${worse} Wörtern`);
  console.log(ex.join('\n'));
}
writeFileSync(new URL('last.json', SP), JSON.stringify(results, null, 1));
