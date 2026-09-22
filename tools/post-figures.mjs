// Daten für die interaktiven Grafiken in den beiden Blogposts, direkt aus der
// Engine — damit dort nichts steht, was die Seite selbst nicht so ausgibt.
//
//   node tools/post-figures.mjs > figures.json
import fs from 'node:fs';
import { buildIndex, fromLine } from '../public/engine.js';
import { buildPhraseIndex, readPhrase, findOronyms, pronounce, readBigrams } from '../public/oronyms.js';
import { toIPA } from '../public/phonemes.js';

const read = f => fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8');
const index = buildIndex(read('words.txt'), read('vulgar.txt'));
const lex = buildPhraseIndex(index);
lex.bigrams = readBigrams(read('bigrams.txt'), index);
const lookup = (w, inPhrase) => pronounce(index, w, inPhrase);

/** Eine Phrase mit ausgewählten Lesarten, so wie das Band auf der Seite sie zeigt. */
function ribbon(text, wanted) {
  const phrase = readPhrase(text, lookup);
  const sounds = phrase.words.flatMap(w => [...w.loose].map(ch => toIPA(ch)));
  let at = 0;
  const typed = phrase.words.map(w => ({ word: w.word, from: at, to: (at += w.loose.length) }));
  const hits = findOronyms(phrase, lex, { tolerance: 2, limit: 60 });
  const readings = wanted.map(want => {
    const place = hits.findIndex(h => h.text === want);
    if (place < 0) throw new Error(`${text}: "${want}" nicht unter den Lesarten`);
    return { r: hits[place], place: place + 1 };
  }).map(({ r, place }) => ({
    text: r.text,
    place,
    words: r.words.map(w => ({ word: w.word, from: w.from, to: w.to, sounds: w.sounds })),
  }));
  return { typed, sounds, readings };
}

/** Ein Spoonerismus mit Anlaut und Reim je Wort, in Lautschrift und Schreibung. */
function swap(first, second) {
  const out = fromLine(index, first, second);
  if (out.error) throw new Error(`${first} ${second}: ${out.error}`);
  return out.pairs.map(row => row.map(x => ({ word: x.word, onset: x.onsetIpa, rime: x.rimeIpa })));
}

const figures = {
  ribbons: [
    ['recognize speech', ['wreck a nice beach', 'reckon eyes beach']],
    ['kiss the sky', ['kiss this guy']],
    ['four candles', ['fork handles']],
    ['used ink', ['you stink']],
    ['mistake', ['miss steak']],
    ['heard', ['hurt']],
  ].map(([text, wanted]) => ribbon(text, wanted)),
  swaps: [['light', 'rain'], ['magic', 'tricks'], ['go', 'nuts'], ['no', 'tales'], ['letting', 'go']
  ].map(([a, b]) => swap(a, b)),
};
process.stdout.write(JSON.stringify(figures, null, 1) + '\n');
