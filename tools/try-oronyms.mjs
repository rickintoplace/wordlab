// Konsolen-Sandkasten: node tools/try-oronyms.mjs "ice cream" [--tol 2] [--rank 20000]
import fs from 'node:fs';
import { buildIndex } from '../public/engine.js';
import { buildPhraseIndex, readPhrase, findOronyms, pronounce, readBigrams } from '../public/oronyms.js';

const read = f => fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8');
const index = buildIndex(read('words.txt'), read('vulgar.txt'));
const lex = buildPhraseIndex(index);
lex.bigrams = readBigrams(read('bigrams.txt'), index);

// Eingabeseitiges Zusatzlexikon (Namen, seltene Wörter) — nur zum Lesen.
const extra = new Map();
for (const line of read('lexicon-extra.txt').split('\n')) {
  const tab = line.indexOf('\t');
  if (tab < 1) continue;
  const w = line.slice(0, tab);
  if (!extra.has(w)) extra.set(w, line.slice(tab + 1));
}
const lookup = (w, inPhrase) => pronounce(index, w, inPhrase) ?? extra.get(w);

const args = process.argv.slice(2);
const flag = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const phrases = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const opts = {};
if (flag('--tol')) opts.tolerance = +flag('--tol');
if (flag('--rank')) opts.maxRank = +flag('--rank');
if (flag('--vulgar')) opts.vulgarity = +flag('--vulgar');
if (flag('--limit')) opts.limit = +flag('--limit');

for (const text of phrases) {
  const phrase = readPhrase(text, lookup);
  if (phrase.unknown.length) console.log(`  (unbekannt: ${phrase.unknown.join(', ')})`);
  const t0 = performance.now();
  const hits = findOronyms(phrase, lex, opts);
  const ms = performance.now() - t0;
  console.log(`\n"${text}"  ${phrase.words.map(w => w.word).join(' ')}  — ${ms.toFixed(1)} ms`);
  for (const h of hits) {
    console.log(`   ${h.resegmented ? '✂' : '≈'} ${h.text.padEnd(34)} ` +
      `${h.cost ? 'Kosten ' + h.cost.toFixed(1) : ''}${h.rude ? ' [derb]' : ''}`);
  }
}
