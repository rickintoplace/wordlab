// Prüft die Invarianten des Generators über viele Durchläufe:
//   node tools/check.mjs [anzahl]
import fs from 'node:fs';
import { buildIndex, generate, generatePhrase, readPhrases } from '../public/engine.js';
import { onsetLength } from '../public/phonemes.js';

const N = Number(process.argv[2]) || 2000;
const index = buildIndex(
  fs.readFileSync(new URL('../public/data/words.txt', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../public/data/vulgar.txt', import.meta.url), 'utf8'));

/** Hat `w` genau diese Aussprache im Wörterbuch? */
const known = (w, code) => (index.byWord.get(w) ?? []).some(e => e.code === code);
const phrases = readPhrases(fs.readFileSync(new URL('../public/data/phrases.txt', import.meta.url), 'utf8'));
const fromPhrases = opts => generatePhrase(index, phrases, opts);

const cases = [
  { name: 'Standard', opts: {} },
  { name: 'streng (Top 3000, 1 Silbe)', opts: { maxRank: 3000, pairs: [{ maxSyllables: 1 }, { maxSyllables: 1 }] } },
  { name: 'weit offen (alle Wörter)', opts: { maxRank: 1e9, allowVariants: true, vulgarity: 1, pairs: [{ maxLetters: 20, maxSyllables: 5 }, { maxLetters: 20, maxSyllables: 5 }] } },
  { name: 'ohne Vokalanlaut', opts: { allowVowelOnset: false } },
  { name: 'derb: keine', opts: { vulgarity: 0 } },
  { name: 'derb: ohne Filter', opts: { vulgarity: 1 } },
  { name: 'derb: mindestens eins', opts: { vulgarity: 2 } },
  { name: 'derb: je Paar eins', opts: { vulgarity: 3 } },
  { name: 'Phrasen', gen: fromPhrases, opts: {} },
  { name: 'Phrasen, Top 3000', gen: fromPhrases, opts: { maxRank: 3000 } },
  { name: 'Phrasen, derb: mindestens eins', gen: fromPhrases, opts: { vulgarity: 2, maxRank: 1e9 } },
];

let bad = 0;
for (const { name, opts, gen = o => generate(index, o) } of cases) {
  let fails = 0;
  const uniq = new Set();
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const r = gen(opts);
    if (r.error) { fails++; continue; }
    const [[A, C], [B, D]] = r.pairs;
    uniq.add([A, B, C, D].map(x => x.word).sort().join(' '));
    for (const x of [A, B, C, D]) {
      if (!index.byWord.has(x.word)) { console.error('✗ kein echtes Wort:', x.word); bad++; }
      if (x.word.includes("'")) { console.error('✗ Apostrophform:', x.word); bad++; }
    }
    // Der Tausch muss aufgehen: A/B teilen den Reim, C/D auch,
    // und A/D bzw. B/C teilen den Anlaut.
    const bad0 = bad;
    if (A.rime !== B.rime || C.rime !== D.rime) console.error('✗ Reim passt nicht:', A.word, B.word, '|', C.word, D.word, ++bad);
    else if (A.onset !== D.onset || B.onset !== C.onset) console.error('✗ Anlaut passt nicht:', [A, B, C, D].map(x => x.word).join(' '), ++bad);
    else if (A.onset === B.onset) console.error('✗ Anlaute identisch:', A.word, B.word, ++bad);
    else for (const x of [A, B, C, D])
      if (!known(x.word, x.onset + x.rime)) { console.error('✗ Aussprache erfunden:', x.word, x.code, ++bad); break; }
    if (bad === bad0 && new Set([A.word, B.word, C.word, D.word]).size !== 4) { console.error('✗ Wort doppelt'); bad++; }
    // Vulgaritätsstufe eingehalten?
    const v = [A, B, C, D].filter(x => x.vulgar).length;
    const lvl = opts.vulgarity ?? 0;
    if (lvl === 0 && v > 0) { console.error('✗ derbes Wort trotz Stufe 0:', [A, B, C, D].filter(x => x.vulgar).map(x => x.word)); bad++; }
    if (lvl === 2 && v === 0) { console.error('✗ kein derbes Wort bei Stufe 2'); bad++; }
    if (lvl === 3 && !((A.vulgar || B.vulgar) && (C.vulgar || D.vulgar))) { console.error('✗ Stufe 3 nicht erfüllt:', [A, B, C, D].map(x => x.word).join(' ')); bad++; }
  }
  const ms = performance.now() - t0;
  console.log(`${name.padEnd(28)} ${String(N - fails).padStart(5)}/${N} Treffer  ` +
    `${(ms / N).toFixed(2)} ms pro Durchlauf` +
    (uniq.size ? `  ${uniq.size} verschiedene Ergebnisse` : ''));
}

// Wortvorgaben
for (const w of ['lighting', 'butter', 'crash', 'spoon', 'nonexistentword']) {
  const r = generate(index, { seedWord: w });
  const used = r.pairs && [r.pairs[0][0].word, r.pairs[1][0].word].includes(w);
  if (r.pairs && !used) { console.error('✗ Startwort fehlt im Ergebnis:', w); bad++; }
  console.log(`  seed ${w.padEnd(18)} ${r.error ?? r.pairs.map(p => p.map(x => x.word).join(' ')).join('  →  ')}`);
}

console.log(bad ? `\n${bad} Verstöße` : '\nAlle Invarianten erfüllt.');
process.exit(bad ? 1 : 0);
