// Welche Konsonanten biegt Misheard, um eine Phrase neu zu schneiden — gemessen,
// nicht aus der Kostentabelle abgelesen. Nimmt zufällige Wortpaare, die in den
// Untertiteln wirklich vorkommen, verhört jedes wie die Seite (Voreinstellung)
// und zählt, wie oft an einer Stelle mit Laut X eine der fünf sichtbaren
// Lesarten Laut Y hört. Nur echte Neuschnitte zählen: "don't breach" -> "don't
// preach" ist ein verhörtes Wort, kein Oronym. Getrennt nach Umgebung, denn
// darum geht es: dieselbe Verwechslung ist am Wortende billig und am
// Wortanfang teuer.
//
//   node tools/confusion-map.mjs [anzahl=12000] > figure.json
//
// Braucht build/cache/bigrams-raw.tsv (npm run bigrams:count).
import fs from 'node:fs';
import { buildIndex } from '../public/engine.js';
import { buildPhraseIndex, readPhrase, findOronyms, pronounce, readBigrams } from '../public/oronyms.js';
import { cost } from '../public/confusion.js';
import { toIPA } from '../public/phonemes.js';

const N = Number(process.argv[2]) || 12000;
const MIN_SEEN = 40;    // seltener gesehene Laute bekommen kein Feld — der Anteil wäre Zufall
const read = f => fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8');
const index = buildIndex(read('words.txt'), read('vulgar.txt'));
const lex = buildPhraseIndex(index);
lex.bigrams = readBigrams(read('bigrams.txt'), index);
const lookup = (w, inPhrase) => pronounce(index, w, inPhrase);

// Erst alle stimmlosen, dann alle stimmhaften Geräuschlaute, in gleicher
// Reihenfolge. Abwechselnd sortiert ergäbe das ein Schachbrett, weil das
// Modell die Stimmhaftigkeit ungern ändert; so werden es Blöcke, und die
// Stimmzwillinge (p/b, t/d …) liegen auf einer eigenen Nebendiagonale.
const ORDER = ['p', 't', 'k', 'f', 'θ', 's', 'ʃ', 'b', 'd', 'ɡ', 'v', 'ð', 'z', 'ʒ',
  'h', 'm', 'n', 'ŋ', 'l', 'ɹ', 'w', 'j'];
const VISIBLE = 5;          // so viele Lesarten zeigt die Seite ohne "more"
const slot = new Map(ORDER.map((p, i) => [p, i]));
const code = new Map();   // IPA -> Kodierzeichen, für den Grundpreis
for (const e of index.entries) for (const ch of e.code) code.set(toIPA(ch), ch);

// Deterministischer Zufall, damit die Grafik reproduzierbar ist.
let seed = 20260922;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const pool = [];
for (const line of fs.readFileSync(new URL('../build/cache/bigrams-raw.tsv', import.meta.url), 'utf8').split('\n')) {
  const [a, b, n] = line.split('\t');
  if (!n || a === '<s>' || Number(n) < 20) continue;
  const ra = index.byWord.get(a)?.[0]?.rank, rb = index.byWord.get(b)?.[0]?.rank;
  if (ra === undefined || rb === undefined || ra > 20000 || rb > 20000) continue;
  pool.push(`${a} ${b}`);
}

const LAYERS = [
  { id: 'all', label: 'Anywhere', test: () => true },
  { id: 'start', label: 'First sound of a word', test: c => c.start },
  { id: 'end', label: 'Last sound of a word', test: c => c.end },
];
const size = ORDER.length;
const grid = () => Array.from({ length: size }, () => new Array(size).fill(0));
const seen = LAYERS.map(() => new Array(size).fill(0));
const hits = LAYERS.map(grid);
const examples = LAYERS.map(() => new Map());

const t0 = performance.now();
for (let s = 0; s < N; s++) {
  const text = pool[Math.floor(rnd() * pool.length)];
  const phrase = readPhrase(text, lookup);
  if (phrase.words.length !== 2) continue;
  const sounds = phrase.words.flatMap(w => [...w.loose].map(ch => toIPA(ch)));
  const starts = new Set(), ends = new Set();
  let at = 0;
  for (const w of phrase.words) { starts.add(at); ends.add((at += w.loose.length) - 1); }
  const context = k => ({ start: starts.has(k), end: ends.has(k) });
  // Am Wort, nicht an der Stelle: ein geteilter Konsonant verschiebt die
  // Position ("same technology" -> "saint technology"), das Wort bleibt.
  const typedWords = new Set(phrase.words.map(w => w.word));

  for (let k = 0; k < sounds.length; k++) {
    const x = slot.get(sounds[k]);
    if (x === undefined) continue;
    LAYERS.forEach((layer, l) => { if (layer.test(context(k))) seen[l][x]++; });
  }

  // Pro Stelle zählt ein Ersatz nur einmal, auch wenn ihn mehrere Lesarten bringen.
  const offered = new Map();
  const readings = findOronyms(phrase, lex, { tolerance: 2 }).slice(0, VISIBLE);
  readings.forEach((r, rank) => {
    if (!r.resegmented) return;
    // Übernimmt die Lesart ein Wort der Eingabe, taugt sie nicht als Beispiel.
    const carried = r.words.some(w => typedWords.has(w.word));
    const heardChain = r.words.flatMap(w => w.sounds);
    let offset = 0;
    for (const w of r.words) {
      if (w.sounds.length === w.to - w.from) {             // nur Ersetzungen, keine Lücken
        w.sounds.forEach((heard, j) => {
          const k = w.from + j;
          const x = slot.get(sounds[k]), y = slot.get(heard);
          if (x === undefined || y === undefined || x === y) return;
          const key = `${k},${y}`;
          const quality = (carried ? 100 : 0) + rank;
          if (!offered.has(key) || offered.get(key).quality > quality) {
            offered.set(key, { k, x, y, quality, carried, heard: r.text, heardSounds: heardChain, heardAt: offset + j });
          }
        });
      }
      offset += w.sounds.length;
    }
  });
  for (const { k, x, y, quality, carried, heard, heardSounds, heardAt } of offered.values()) {
    LAYERS.forEach((layer, l) => {
      if (!layer.test(context(k))) return;
      hits[l][x][y]++;
      const key = `${ORDER[x]}>${ORDER[y]}`;
      const list = examples[l].get(key) ?? examples[l].set(key, []).get(key);
      // Die besten Beispiele: alles neu gehört, weit oben in der Liste,
      // verschiedene Eingaben.
      if (carried || list.some(e => e.typed === text)) return;
      list.push({ typed: text, heard, sounds, at: k, heardSounds, heardAt, quality });
      list.sort((p, q) => p.quality - q.quality);
      list.length = Math.min(list.length, 3);
    });
  }
}

const round = v => Math.round(v * 10) / 10;
const figure = {
  phrases: N,
  seconds: Math.round((performance.now() - t0) / 1000),
  rows: ORDER,
  columns: ORDER,
  layers: LAYERS.map((layer, l) => ({
    id: layer.id,
    label: layer.label,
    values: ORDER.map((_, x) => ORDER.map((_, y) =>
      x === y || seen[l][x] < MIN_SEEN ? null : round((100 * hits[l][x][y]) / seen[l][x]))),
    seen: seen[l],
    examples: Object.fromEntries([...examples[l]].map(([key, list]) =>
      [key, list.map(({ quality, ...rest }) => rest)])),
  })),
  prices: ORDER.map(a => ORDER.map(b => a === b ? null : Math.round(cost(code.get(a), code.get(b)) * 100) / 100)),
};
process.stdout.write(JSON.stringify(figure) + '\n');
process.stderr.write(`${N} Phrasen in ${figure.seconds} s\n`);
