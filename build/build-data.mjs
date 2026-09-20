// Erzeugt public/data/words.txt aus CMUdict + Häufigkeitsliste + Hunspell.
//
// Zeilenformat:  <wort>\t<kodierte Phoneme>\t<variantennummer>
// Zeilen sind nach Häufigkeit absteigend sortiert; der Zeilenindex ist damit
// gleichzeitig der Häufigkeitsrang, den die Oberfläche als Regler benutzt.

import fs from 'node:fs';
import path from 'node:path';
import nspell from 'nspell';
import dictionary from 'dictionary-en';
import { ensureSources } from './sources.mjs';
import { encode, onsetLength, countSyllables } from '../public/phonemes.js';
import { BLOCKED } from './blocked.mjs';
import { NOT_VULGAR } from './not-vulgar.mjs';
import { TWO_LETTER } from './short-words.mjs';

const MIN_FREQ = 10;       // absolute Vorkommen im OpenSubtitles-Korpus
const MAX_SYLLABLES = 5;
const DATA = path.join(import.meta.dirname, '..', 'public', 'data');
const OUT = path.join(DATA, 'words.txt');
const OUT_VULGAR = path.join(DATA, 'vulgar.txt');
const OUT_EXTRA = path.join(DATA, 'lexicon-extra.txt');

console.log('Quellen:');
const cache = await ensureSources();

console.log('Lese cmudict …');
/** wort -> [kodierte Aussprache, …] in Reihenfolge des Wörterbuchs */
const prons = new Map();
for (const line of fs.readFileSync(path.join(cache, 'cmudict.dict'), 'utf8').split('\n')) {
  if (!line || line.startsWith(';;;')) continue;
  const parts = line.split(' #')[0].trim().split(/\s+/);
  const raw = parts.shift();
  if (!parts.length) continue;
  const word = raw.replace(/\(\d+\)$/, '');
  // Buchstaben, höchstens ein Apostroph in der Mitte: "can't", "o'clock",
  // "dog's". Ohne die gehen ganz alltägliche Eingaben nicht.
  if (!/^[a-z]+(?:'[a-z]+)?$/.test(word)) continue;
  const code = encode(parts);
  if (!code) continue;
  const list = prons.get(word) ?? prons.set(word, []).get(word);
  if (!list.includes(code)) list.push(code);
}

console.log('Lese Häufigkeiten …');
const freq = new Map();
for (const line of fs.readFileSync(path.join(cache, 'en_full.txt'), 'utf8').split('\n')) {
  const sp = line.indexOf(' ');
  if (sp < 1) continue;
  const w = line.slice(0, sp);
  if (!freq.has(w)) freq.set(w, Number(line.slice(sp + 1)) || 0);
}

console.log('Lade Hunspell-Wörterbuch …');
const spell = nspell(dictionary);

// Abkürzungen ("st" -> street, "mr" -> mister) haben keinen Vokalbuchstaben,
// klingen aber mehrsilbig. Sie sind im Aussprachelexikon reichlich vertreten.
const hasVowelLetter = w => /[aeiouy]/.test(w);

// Die Häufigkeitsliste kennt keine Apostrophe ("dont", "cant"), das
// Aussprachelexikon schon. Für die Häufigkeit zählt die nackte Form.
const plain = w => w.replace(/'/g, '');

const stats = { total: 0, noFreq: 0, tooRare: 0, properNoun: 0, abbrev: 0, tooLong: 0, blocked: 0, apostrophe: 0 };

// Alles, was aus der Ausgabe fliegt, bleibt trotzdem für die *Eingabe* nützlich:
// wer "Nicholas" oder "spaghetti" tippt, will es zerlegt bekommen. Diese Liste
// wird erst nachgeladen, wenn ein Wort im Hauptlexikon fehlt.
const extra = [];
const rows = [];
for (const [word, codes] of prons) {
  stats.total++;
  const f = freq.get(word) ?? freq.get(plain(word)) ?? 0;
  if (f === 0) { stats.noFreq++; continue; }
  if (f < MIN_FREQ) { stats.tooRare++; continue; }
  if (BLOCKED.has(word)) { stats.blocked++; continue; }
  const bare = plain(word);
  // Apostrophformen sind für die Eingabe unverzichtbar ("i can't see"), in der
  // Ausgabe aber schädlich: sie verdoppeln lautgleiche Kandidaten ("cant" /
  // "can't") und drängen bessere Lesarten aus der Liste. Sie landen deshalb nur
  // im Eingabelexikon.
  if (bare !== word) { stats.apostrophe++; continue; }
  if (!hasVowelLetter(bare)) { stats.abbrev++; continue; }
  // Einzelne Buchstaben sind Buchstabennamen, keine Wörter — außer diesen zweien.
  if (bare.length === 1 && bare !== 'a' && bare !== 'i') { stats.abbrev++; continue; }
  if (bare.length === 2 && !TWO_LETTER.has(bare)) { stats.abbrev++; continue; }
  // Eigennamen-Filter: Hunspell kennt "Mary"/"London" nur großgeschrieben.
  // Wörter, die auch klein korrekt sind ("smith", "rose", "bill"), bleiben.
  if (!spell.correct(word)) { stats.properNoun++; continue; }
  const usable = codes.filter(c => countSyllables(c) <= MAX_SYLLABLES && onsetLength(c) < c.length);
  if (!usable.length) { stats.tooLong++; continue; }
  usable.forEach((code, i) => rows.push({ word, code, variant: i, f }));
}

// Zweiter Durchgang: alles Übrige für die Eingabeseite einsammeln.
const inOutput = new Set(rows.map(r => r.word));
for (const [word, codes] of prons) {
  if (inOutput.has(word) || BLOCKED.has(word)) continue;
  for (const code of codes) extra.push(`${word}\t${code}`);
}

rows.sort((a, b) => b.f - a.f || a.word.localeCompare(b.word) || a.variant - b.variant);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, rows.map(r => `${r.word}\t${r.code}\t${r.variant}`).join('\n') + '\n');

// Derbe Wörter: die kuratierte Profanitätsliste, geschnitten mit dem Ergebnis.
const profanity = new Set(fs.readFileSync(path.join(cache, 'profanity.txt'), 'utf8')
  .split('\n').map(w => w.trim().toLowerCase()).filter(Boolean));
const vulgar = [...new Set(rows.map(r => r.word))]
  .filter(w => profanity.has(w) && !NOT_VULGAR.has(w));
fs.writeFileSync(OUT_VULGAR, vulgar.join('\n') + '\n');

fs.writeFileSync(OUT_EXTRA, extra.join('\n') + '\n');

const uniqueWords = new Set(rows.map(r => r.word)).size;
console.log('\nAussortiert:', stats);
console.log(`Ergebnis: ${uniqueWords} Wörter, ${rows.length} Aussprachen`);
console.log(`${vulgar.length} davon als derb markiert ` +
  `(${profanity.size} in der Liste, ${BLOCKED.size} Wörter vorher hart gesperrt)`);
console.log(`${OUT} — ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
console.log(`${OUT_VULGAR} — ${(fs.statSync(OUT_VULGAR).size / 1024).toFixed(1)} KB`);
console.log(`${OUT_EXTRA} — ${extra.length} Einträge nur für die Eingabe, ` +
  `${(fs.statSync(OUT_EXTRA).size / 1024).toFixed(0)} KB`);
