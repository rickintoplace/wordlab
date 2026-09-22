// Misst, auf welchem Platz bekannte Oronyme landen — damit das Tuning der
// Bewertung nicht aus dem Bauch heraus passiert.
//   node tools/tune-oronyms.mjs [--tol 2] [--limit 12] [--set lmWeight=0.5,cutBonus=3]
import fs from 'node:fs';
import { buildIndex } from '../public/engine.js';
import { buildPhraseIndex, readPhrase, findOronyms, pronounce, readBigrams } from '../public/oronyms.js';

const read = f => fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8');
const index = buildIndex(read('words.txt'), read('vulgar.txt'));
const lex = buildPhraseIndex(index);
lex.bigrams = readBigrams(read('bigrams.txt'), index);
const extra = new Map();
for (const line of read('lexicon-extra.txt').split('\n')) {
  const tab = line.indexOf('\t');
  if (tab > 0 && !extra.has(line.slice(0, tab))) extra.set(line.slice(0, tab), line.slice(tab + 1));
}
const lookup = (w, inPhrase) => pronounce(index, w, inPhrase) ?? extra.get(w);

// Belege aus der Literatur und aus dem, was beim Ausprobieren überzeugt hat.
const TARGETS = [
  // Vom Nutzer genannt
  ['the good can decay many ways', 'the good candy came anyways'],
  ['the stuffy nose can lead to problems', 'the stuff he knows can lead to problems'],
  ['four candles', 'fork handles'],
  ['isle of man', 'i love men'],
  ['hill areas', 'hilarious'],
  ['ice cream', 'i scream'],
  ['i spank myself', 'ice bank mice elf'],

  // Klassiker aus der Literatur zu Oronymen und Mondegreens
  ['euthanasia', 'youth in asia'],
  ['illegal', 'ill eagle'],
  ['lettuce', 'let us'],
  ['why choose', 'white shoes'],
  ['example', 'egg sample'],
  ['nitrate', 'night rate'],
  ['iced ink', 'i stink'],
  ['used ink', 'you stink'],
  ['mint spy', 'mince pie'],
  ['attacks', 'a tax'],
  ['decadent', 'deck a dent'],
  ['the sky', 'this guy'],
  ['a nice man', 'an ice man'],
  ['an aim', 'a name'],
  ['myself', 'mice elf'],
  ['misheard', 'miss heard'],
  ['misheard', 'miss hurt'],
  ['heard', 'hurt'],
  ['depend', 'deep end'],
  ['some others', 'so mothers'],
  ['a tribute', 'attribute'],
  ['great ape', 'gray tape'],
  ['mishear it', 'miss see rid'],

  // Zweite Runde (September 2026): Klassiker, die jeder als Erstes ausprobiert.
  // Dafür kamen die schwachen Formen, die Doppelkonsonanten, der ungelöste
  // Verschluss vor Nasalen und die Wortpaare dazu.
  ['recognize speech', 'wreck a nice beach'],
  ['kiss the sky', 'kiss this guy'],
  ['stuffy nose', 'stuff he knows'],
  ['gray day', 'grade a'],
  ['known ocean', 'no motion'],
  ['that stuff', "that's tough"],
  ['mistake', 'miss steak'],
  ['real eyes', 'realize'],
  ['an ice cold shower', 'a nice cold shower'],
  ['some others', 'some mothers'],
  ['europe', "you're up"],
  ['island', 'i land'],
];


// Was auf keinen Fall vorn stehen darf.
const ANTI = [
  ['the sky', 'thus chi'],
];

const args = process.argv.slice(2);
const flag = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const tolerance = Number(flag('--tol') ?? 2);
const limit = Number(flag('--limit') ?? 12);
const overrides = Object.fromEntries((flag('--set') ?? '').split(',').filter(Boolean)
  .map(pair => { const [k, v] = pair.split('='); return [k, Number(v)]; }));

let total = 0, missing = 0;
console.log(`Toleranz ${tolerance}, Liste ${limit}` +
  (Object.keys(overrides).length ? `, ${JSON.stringify(overrides)}` : ''));
for (const [text, want] of TARGETS) {
  const phrase = readPhrase(text, lookup);
  const hits = findOronyms(phrase, lex, { tolerance, limit: 60, ...overrides });
  const at = hits.findIndex(h => h.text === want);
  const shown = at >= 0 && at < limit;
  if (at < 0) { missing++; total += 40; }
  else { total += at; if (!shown) missing += 0.5; }
  console.log(`  ${shown ? '✓' : at >= 0 ? '·' : '✗'} ${(text + ' → ' + want).padEnd(38)} ` +
    (at < 0 ? 'nicht gefunden' : `Platz ${at + 1}`));
}
let sins = 0;
console.log('\nWas nicht vorn stehen soll:');
for (const [text, avoid] of ANTI) {
  const hits = findOronyms(readPhrase(text, lookup), lex, { tolerance, limit: 60, ...overrides });
  const at = hits.findIndex(h => h.text === avoid);
  const bad = at >= 0 && at < 3;
  if (bad) { sins++; total += 25; }
  console.log(`  ${bad ? '✗' : '✓'} ${(text + ' → ' + avoid).padEnd(38)} ` +
    (at < 0 ? 'nicht dabei' : `Platz ${at + 1}`));
}

console.log(`\nSumme der Plätze: ${total}  (je kleiner, desto besser) · ` +
  `${missing ? missing + ' außerhalb der Liste' : 'alle sichtbar'}` +
  `${sins ? ', ' + sins + ' unerwünscht weit vorn' : ''}`);
