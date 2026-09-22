// Erzeugt public/data/bigrams.txt aus build/cache/bigrams-raw.tsv (siehe
// count-bigrams.mjs): welche Wortpaare in gesprochener Sprache tatsächlich
// vorkommen. Misheard braucht das, um "wreck a nice beach" von "reckon eyes
// beach" zu unterscheiden — beides lautlich gleich nah, aber nur eins ist ein
// Satz.
//
//   node build/build-bigrams.mjs [mindestanzahl]
//
// Format (Wort-IDs = Reihenfolge der Wörter in words.txt, 0-basiert):
//   Zeile 1   Anzahl der Zeilen im Korpus (= Vorkommen von <s>) und die Schwelle
//   Zeile 2   Vorkommen je Wort, base36, leerzeichengetrennt
//   Zeile 3   Nachfolger von <s>
//   Zeile 4+  Nachfolger von Wort 0, 1, 2, …
// Ein Nachfolger ist der Abstand zur vorigen ID (base36, klein) und direkt
// dahinter die Anzahl als Zweierlogarithmus in einem Großbuchstaben (A = 1,
// B = 2, C = 4 …). Leere Zeile = kein Nachfolger über der Schwelle.
import fs from 'node:fs';
import path from 'node:path';

const MIN = Number(process.argv[2]) || 10;
const CACHE = path.join(import.meta.dirname, 'cache');
const DATA = path.join(import.meta.dirname, '..', 'public', 'data');

const ids = new Map();
for (const line of fs.readFileSync(path.join(DATA, 'words.txt'), 'utf8').split('\n')) {
  const w = line.slice(0, line.indexOf('\t'));
  if (w && !ids.has(w)) ids.set(w, ids.size);
}
const V = ids.size;
const unigram = new Float64Array(V);
let lines = 0;
const rows = Array.from({ length: V + 1 }, () => []);   // [0] = <s>

for (const line of fs.readFileSync(path.join(CACHE, 'bigrams-raw.tsv'), 'utf8').split('\n')) {
  if (!line) continue;
  const [a, b, n] = line.split('\t');
  const count = Number(n);
  const nb = ids.get(b);
  if (a === '<s>') lines += count;
  // Einzelvorkommen fehlen in der Rohdatei; für die Gesamtzahlen reicht das.
  if (nb !== undefined) unigram[nb] += count;
  const na = a === '<s>' ? -1 : ids.get(a);
  if (na === undefined || nb === undefined || count < MIN) continue;
  rows[na + 1].push([nb, count]);
}

const out = [`${lines} ${MIN}`, [...unigram].map(n => Math.round(n).toString(36)).join(' ')];
let pairs = 0;
for (const row of rows) {
  row.sort((x, y) => x[0] - y[0]);
  let prev = 0, s = '';
  for (const [id, count] of row) {
    s += (id - prev).toString(36) + String.fromCharCode(65 + Math.min(25, Math.round(Math.log2(count))));
    prev = id;
  }
  pairs += row.length;
  out.push(s);
}
const file = path.join(DATA, 'bigrams.txt');
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(`${pairs} Paare ab ${MIN} Vorkommen, ${V} Wörter, ${lines} Zeilen — ` +
  `${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
