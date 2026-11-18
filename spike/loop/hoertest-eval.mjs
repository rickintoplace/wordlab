// Urteile der Hörseite auswerten: Welche Variante hat je Vergleich gewonnen, mit welchen Stichworten?
//   node loop/hoertest-eval.mjs <Ordner mit votes/*.json (read_db out_dir)> [Runde]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const [dir, only] = process.argv.slice(2);
const H = new URL('../out/hoertest/', import.meta.url);
const vdir = existsSync(`${dir}/votes`) ? `${dir}/votes` : dir;
const votes = readdirSync(vdir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`${vdir}/${f}`, 'utf8'))).map(v => v.data ?? v).filter(v => v.round && (!only || v.round === only));
const rounds = {};
for (const v of votes) rounds[v.round] ??= JSON.parse(readFileSync(new URL(`${v.round}.json`, H)));
const table = {};
for (const v of votes) {
  const it = rounds[v.round].items.find(x => x.id === v.item);
  if (!it) continue;
  const [x, y] = rounds[v.round].pairs.find(([p, q]) => it.id.startsWith(`${p}-${q}-`));
  const win = v.choice === 'same' ? 'gleich' : v.choice === 'a' ? it.av : it.bv;
  const key = `${v.round} ${x} gegen ${y}`;
  const t = (table[key] ??= { [x]: 0, [y]: 0, gleich: 0, rows: [] });
  t[win]++;
  t.rows.push(`  ${win.padEnd(8)} ${it.text}${v.tags?.length ? `  [${v.tags.join(', ')}]` : ''}${v.note ? `  „${v.note}“` : ''}`);
}
for (const [k, t] of Object.entries(table)) {
  const { rows, ...n } = t;
  console.log(`\n${k}: ${Object.entries(n).map(([a, b]) => `${a} ${b}`).join(' · ')}`);
  console.log(rows.join('\n'));
}
