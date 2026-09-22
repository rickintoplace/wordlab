// Zählt Wortpaare in OpenSubtitles (OPUS, en, 2018) — Vorstufe für
// public/data/bigrams.txt. Liest den entpackten Korpus von stdin:
//   npm run bigrams:count     (lädt den Korpus als Strom, ~3,6 GB gepackt; nach
//                              40 Mio. Zeilen bricht head ab)
// Ergebnis: build/cache/bigrams-raw.tsv  (wort1 \t wort2 \t anzahl), mit
// "<s>" als Zeilenanfang.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DATA = path.join(import.meta.dirname, '..', 'public', 'data');
const OUT = path.join(import.meta.dirname, 'cache', 'bigrams-raw.tsv');

const vocab = new Map([['<s>', 0]]);
const words = ['<s>'];
for (const file of ['words.txt', 'lexicon-extra.txt']) {
  for (const line of fs.readFileSync(path.join(DATA, file), 'utf8').split('\n')) {
    const w = line.slice(0, line.indexOf('\t'));
    if (w && !vocab.has(w)) { vocab.set(w, words.length); words.push(w); }
  }
}
const SHIFT = 2 ** 18;
const counts = new Map();
let lines = 0;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (++lines % 2e6 === 0) process.stderr.write(`${lines / 1e6}M Zeilen, ${(counts.size / 1e6).toFixed(1)}M Paare\n`);
  let prev = 0;
  for (const tok of line.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []) {
    const id = vocab.get(tok);
    if (id === undefined) { prev = -1; continue; }
    if (prev >= 0) {
      const key = prev * SHIFT + id;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    prev = id;
  }
}
const out = fs.createWriteStream(OUT);
for (const [key, n] of counts) {
  if (n < 2) continue;
  out.write(`${words[Math.floor(key / SHIFT)]}\t${words[key % SHIFT]}\t${n}\n`);
}
out.end();
process.stderr.write(`fertig: ${lines} Zeilen, ${counts.size} Paare\n`);
