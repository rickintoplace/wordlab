// Englisch: Akzent automatisch wählen. Das Alignment läuft mit amerikanischer
// und britischer Aussprache; die Variante, die das Phonemmodell besser
// bestätigt (mittlere Log-Wahrscheinlichkeit), gewinnt.
//   node accent.mjs media/vlog
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync } from 'node:fs';
const dir = process.argv[2];
const res = {};
for (const v of ['en-us', 'en-gb']) {
  execFileSync('node', [new URL('./align.mjs', import.meta.url).pathname, dir, v], { stdio: 'ignore' });
  const P = JSON.parse(readFileSync(`${dir}/phones.json`)).phones;
  res[v] = P.reduce((a, p) => a + p.lp, 0) / P.length;
  renameSync(`${dir}/phones.json`, `${dir}/phones.${v}.json`);
  console.log(`${v}: mittlere log p ${res[v].toFixed(3)}, ${P.filter(p => p.raw && p.raw !== p.t).length} Laute anders gehört`);
}
const best = res['en-gb'] > res['en-us'] ? 'en-gb' : 'en-us';
renameSync(`${dir}/phones.${best}.json`, `${dir}/phones.json`);
console.log(`→ ${best}`);
