// Erzeugt public/data/phrases.txt: Spoonerismen, deren beide Zeilen so
// tatsächlich gesagt werden — "magic tricks" / "tragic mix", "light rain" /
// "right lane". Quelle sind die Wortpaare aus count-bigrams.mjs.
//
//   node build/build-phrases.mjs [mindestbewertung]
//
// Zeilenformat: wortA  wortC  wortB  wortD  bewertung, beste zuerst. Die
// Bewertung misst die schwächere der beiden Zeilen: wie oft sie vorkommt und
// — wie in oronyms.js — wie viel wahrscheinlicher das zweite Wort nach dem
// ersten ist als irgendwo sonst.
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex } from '../public/engine.js';

const MIN_SCORE = Number(process.argv[2] ?? 4);
const SMOOTHING = 100;
const FUNCTION_RANKS = 150;   // so weit oben in der Häufigkeitsliste stehen fast nur Funktionswörter
// Interjektionen zählen nicht als Inhalt, egal wie selten ("ah my" / "ma i").
const FILLERS = new Set('ah aw eh er ha hey hi huh hm mm oh ooh ow uh um whoa wow yeah yo'.split(' '));
const CACHE = path.join(import.meta.dirname, 'cache');
const DATA = path.join(import.meta.dirname, '..', 'public', 'data');
const read = f => fs.readFileSync(path.join(DATA, f), 'utf8');
const index = buildIndex(read('words.txt'), read('vulgar.txt'));

/** Zählungen einer Sorte: Paar -> Anzahl, dazu Zeilen-, Spalten- und Gesamtsummen. */
function table() {
  return { pairs: new Map(), rows: new Map(), cols: new Map(), total: 0 };
}
function add(t, a, c, n) {
  t.pairs.set(`${a} ${c}`, n);
  t.rows.set(a, (t.rows.get(a) ?? 0) + n);
  t.cols.set(c, (t.cols.get(c) ?? 0) + n);
  t.total += n;
}
function association(t, a, c) {
  const n = t.pairs.get(`${a} ${c}`) ?? 0;
  const p = ((t.cols.get(c) ?? 0) + 1) / t.total;
  return Math.log((n + SMOOTHING * p) / ((t.rows.get(a) ?? 0) + SMOOTHING)) - Math.log(p);
}

const t = table();
for (const line of fs.readFileSync(path.join(CACHE, 'bigrams-raw.tsv'), 'utf8').split('\n')) {
  const [a, c, n] = line.split('\t');
  if (n && a !== '<s>') add(t, a, c, Number(n));
}

const usable = e => e && e.variant === 0 && !e.word.includes("'");
const primary = w => index.byWord.get(w)?.find(e => e.variant === 0);
/** Die häufigste Schreibweise für Anlaut + Reim — wie engine.js sie zeigt. */
const spell = (rime, onset) => index.byRime.get(rime)?.get(onset)?.find(usable);
// Wie sameStem in engine.js: "cooking looked" / "looking cooked" ist kein Witz.
const sameStem = (x, y) => {
  let i = 0;
  while (i < Math.min(x.length, y.length) && x[i] === y[i]) i++;
  return i >= 4;
};

const out = new Map();
for (const key of t.pairs.keys()) {
  const [a, c] = key.split(' ');
  const A = primary(a), C = primary(c);
  if (!usable(A) || !usable(C) || A.onset === C.onset) continue;
  const B = spell(A.rime, C.onset), D = spell(C.rime, A.onset);
  if (!B || !D) continue;
  if (new Set([A.word, B.word, C.word, D.word]).size < 4) continue;
  if ([A, B].some(x => [C, D].some(y => sameStem(x.word, y.word)))) continue;
  if (!t.pairs.has(`${B.word} ${D.word}`)) continue;
  // Ein Inhaltswort je Zeile ("might be" / "bite me"); aus lauter
  // Funktionswörtern ("me why" / "we my") wird kein Witz.
  const content = e => e.rank >= FUNCTION_RANKS && !FILLERS.has(e.word);
  if (!(content(A) || content(C)) || !(content(B) || content(D))) continue;
  // Wie oft die seltenere Zeile vorkommt (log2) plus die schwächere
  // Zusammengehörigkeit: "might be" / "bite me" schlägt "raw egg" / "ah reg".
  const score = Math.log2(Math.min(t.pairs.get(key), t.pairs.get(`${B.word} ${D.word}`)))
    + Math.min(association(t, A.word, C.word), association(t, B.word, D.word));
  if (score < MIN_SCORE) continue;
  // Beide Richtungen sind derselbe Fund.
  const id = [`${A.word} ${C.word}`, `${B.word} ${D.word}`].sort().join(' / ');
  if (!out.has(id)) out.set(id, [A.word, C.word, B.word, D.word, score.toFixed(2)]);
}

const rows = [...out.values()].sort((x, y) => y[4] - x[4]);
fs.writeFileSync(path.join(DATA, 'phrases.txt'), rows.map(r => r.join('\t')).join('\n') + '\n');
console.log(`${rows.length} Spoonerismen aus echten Wortpaaren, Bewertung ab ${MIN_SCORE}`);
