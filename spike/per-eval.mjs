// Phonem-Fehlerrate der Sätze aus eval-ideas.mjs (NOJUDGE=1), rein akustisch – ohne Sprachmodell, das miträt.
import { readFileSync } from 'node:fs';
import { loadScorer, hear, targetTokens, per } from './score.mjs';
const rows = JSON.parse(readFileSync(new URL('./out/eval/rows.json', import.meta.url)));
await loadScorer();
let sum = 0;
for (const r of rows) {
  const h = await hear(new URL(`./out/eval/${r.i}.wav`, import.meta.url).pathname);
  const p = per(targetTokens(r.text, 'de'), h); sum += p;
  console.log(`${(100 * p).toFixed(0).padStart(3)}%  ${r.q.padEnd(10)} ${r.text}\n       ${h.join('')}`);
}
console.log(`PER mean ${(100 * sum / rows.length).toFixed(0)}%`);
