// Vollständige Zählung statt Stichprobe: welche Spoonerismen gibt es überhaupt?
//
//   node tools/census.mjs                  Gesamtzahl und die fruchtbarsten Anlautpaare
//   node tools/census.mjs --rude 4         alle mit vier derben Wörtern (ausschreiben)
//   node tools/census.mjs --rude 3 --list  dito ab drei derben Wörtern
//   node tools/census.mjs --matrix         Anlaut × Anlaut als TSV (für eine Heatmap)
//   node tools/census.mjs --rank 10000     nur die N häufigsten Wörter
//
// Ein Spoonerismus ist hier ein Viereck: zwei Reime R1, R2 und zwei Anlaute a, b,
// bei denen alle vier Kombinationen echte Wörter sind. Deshalb reicht es, je Reim
// alle Anlautpaare zu notieren — zwei Reime mit demselben Anlautpaar ergeben
// genau einen Spoonerismus.
import fs from 'node:fs';
import { buildIndex } from '../public/engine.js';
import { toIPA } from '../public/phonemes.js';

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const maxRank = Number(get('--rank', Infinity));
const rude = Number(get('--rude', 0));
const list = flag('--list') || rude >= 4;

const index = buildIndex(
  fs.readFileSync(new URL('../public/data/words.txt', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../public/data/vulgar.txt', import.meta.url), 'utf8'));

// Je (Reim, Anlaut) das häufigste Wort der Hauptaussprache — mehr braucht die
// Zählung nicht, Homophone sind derselbe Klang.
const byRime = new Map();
for (const e of index.entries) {
  if (e.variant !== 0 || e.rank >= maxRank) continue;
  if (rude && !e.vulgar && rude === 4) continue;      // spart bei der harten Frage viel Arbeit
  let onsets = byRime.get(e.rime);
  if (!onsets) byRime.set(e.rime, (onsets = new Map()));
  if (!onsets.has(e.onset)) onsets.set(e.onset, e);
}

/** Anlautpaar -> Reime, die beide Anlaute hergeben. */
const byPair = new Map();
for (const [rime, onsets] of byRime) {
  const keys = [...onsets.keys()].sort();
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const key = keys[i] + '\t' + keys[j];
      const bucket = byPair.get(key);
      if (bucket) bucket.push(rime); else byPair.set(key, [rime]);
    }
}

/** Teilen sich zwei Wörter die ersten vier Buchstaben, ist es nur eine Beugung. */
const sameStem = (x, y) => {
  const n = Math.min(x.length, y.length, 4);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
  return n >= 4;
};

let total = 0, degenerate = 0;
const hits = [];
const counts = new Map();                     // Anlautpaar -> Anzahl

for (const [key, rimes] of byPair) {
  if (rimes.length < 2) continue;
  const [a, b] = key.split('\t');
  let n = 0;
  for (let i = 0; i < rimes.length; i++)
    for (let j = i + 1; j < rimes.length; j++) {
      const A = byRime.get(rimes[i]).get(a), B = byRime.get(rimes[i]).get(b);
      const C = byRime.get(rimes[j]).get(b), D = byRime.get(rimes[j]).get(a);
      n++;
      total++;
      // Der Generator wirft weg, was nur zwei Wörter in zwei Formen sind.
      const stem = sameStem(A.word, B.word) || sameStem(A.word, C.word)
        || sameStem(A.word, D.word) || sameStem(B.word, C.word)
        || sameStem(B.word, D.word) || sameStem(C.word, D.word);
      if (stem) degenerate++;
      if (rude) {
        const vulgar = [A, B, C, D].filter(e => e.vulgar).length;
        if (vulgar >= rude) hits.push({ A, B, C, D, vulgar, stem });
      }
    }
  counts.set(key, n);
}

const ipa = code => toIPA(code) || '∅';

if (flag('--matrix')) {
  console.log(['onset1', 'onset2', 'count'].join('\t'));
  for (const [key, n] of [...counts].sort((x, y) => y[1] - x[1])) {
    const [a, b] = key.split('\t');
    console.log([ipa(a), ipa(b), n].join('\t'));
  }
} else if (rude) {
  console.log(`Spoonerismen mit mindestens ${rude} derben Wörtern: ${hits.length}\n`);
  hits.sort((x, y) => y.vulgar - x.vulgar || x.A.rank - y.A.rank);
  for (const h of hits) {
    const mark = e => (e.vulgar ? '*' : '') + e.word;
    if (!list) continue;
    console.log(`  ${(mark(h.A) + ' ' + mark(h.C)).padEnd(24)} → ` +
      `${(mark(h.B) + ' ' + mark(h.D)).padEnd(24)}` +
      `  ${h.vulgar}/4${h.stem ? '  (gleicher Stamm — der Generator wirft das weg)' : ''}`);
  }
} else {
  console.log(`Wörter:            ${[...byRime.values()].reduce((n, m) => n + m.size, 0)}`);
  console.log(`Reime:             ${byRime.size}`);
  console.log(`Anlautpaare:       ${counts.size}`);
  console.log(`Spoonerismen:      ${total.toLocaleString('de-DE')}`);
  console.log(`davon Beugungen:   ${degenerate.toLocaleString('de-DE')} ` +
    `(${(degenerate / total * 100).toFixed(1)} %)\n`);
  console.log('Fruchtbarste Anlautpaare:');
  for (const [key, n] of [...counts].sort((x, y) => y[1] - x[1]).slice(0, 15)) {
    const [a, b] = key.split('\t');
    console.log(`  ${(ipa(a) + ' / ' + ipa(b)).padEnd(14)} ${n.toLocaleString('de-DE')}`);
  }
}
