// Konsolen-Sandkasten: node tools/try.mjs [anzahl] [--seed wort] [--rank N]
import fs from 'node:fs';
import { buildIndex, generate } from '../public/engine.js';

const args = process.argv.slice(2);
const n = Number(args[0]) || 10;
const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const t0 = Date.now();
const index = buildIndex(
  fs.readFileSync(new URL('../public/data/words.txt', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../public/data/vulgar.txt', import.meta.url), 'utf8'));
console.log(`Index: ${index.entries.length} Einträge, ${index.byRime.size} Reime, ` +
  `${index.byOnset.size} Anlaute — ${Date.now() - t0} ms\n`);

const opts = {};
if (get('--seed')) opts.seedWord = get('--seed');
if (get('--rank')) opts.maxRank = Number(get('--rank'));
if (get('--syl')) { const [a, b] = get('--syl').split('-'); opts.pairs = [{ minSyllables: +a, maxSyllables: +b }, { minSyllables: +a, maxSyllables: +b }]; }
if (get('--vulgar')) opts.vulgarity = Number(get('--vulgar'));

const t1 = Date.now();
let fails = 0;
for (let i = 0; i < n; i++) {
  const r = generate(index, opts);
  if (r.error) { fails++; console.log('  ✗', r.error); continue; }
  const [[A, C], [B, D]] = r.pairs;
  const homo = [A, B, C, D].flatMap(x => x.homophones.length ? [`${x.word}=${x.homophones.join('/')}`] : []);
  const mark = x => x.vulgar ? '*' : '';
  console.log(`  ${(mark(A) + A.word + ' ' + mark(C) + C.word).padEnd(26)} →  ` +
    `${(mark(B) + B.word + ' ' + mark(D) + D.word).padEnd(26)}` +
    `  ${homo.length ? '[' + homo.join(', ') + ']' : ''}`);
}
console.log(`\n${n} Versuche in ${Date.now() - t1} ms (${fails} ohne Treffer)`);
