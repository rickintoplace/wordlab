// Wort-Werkstatt: ein einzelnes Wort, das im Video nicht vorkommt, auf
// verschiedene Arten aus Lauten bauen. Eine Fassung ist doppelt dabei
// (andere Datei, anderer Buchstabe), um zu sehen, wie stark Noten streuen.
//
//   node workshop.mjs media/vlog-voc out/werkstatt pizza computer dinosaur

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { loadSource, targetPhones, select, plan, render, writeWav, W, syllableBounds } from './mix.mjs';
import { loadScorer, hear, targetTokens, per } from './score.mjs';
import { page } from './page.mjs';

const [dir, outDir, ...wordList] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
const src = loadSource(dir);
await loadScorer();

// Gewichte wie die beste Satz-Fassung (Runde 8/9: b + Kontext)
Object.assign(W, { normLoud: 0 });

// Runde 2 der Werkstatt: Silben (Sieger) ohne/mit gelerntem Akzent, dazu frei mit Akzent
const STRATEGIES = [
  { key: 'silbe', cuts: 'syll', accent: false, label: 'Silben, Aussprache aus dem (amerikanischen) Wörterbuch' },
  { key: 'silbe-akzent', cuts: 'syll', accent: true, label: 'Silben, Aussprache an den Akzent der Sprecherin angepasst' },
  { key: 'frei-akzent', cuts: 'all', accent: true, label: 'Frei geschnitten, Aussprache an den Akzent angepasst' },
];

const report = [];
for (const word of wordList) {
  const tgtPlain = targetPhones(word, meta.vocab, src.lang, src.lexicon);
  const tgtAcc = targetPhones(word, meta.vocab, src.lang, src.lexicon, src.accent);
  const tgt = tgtAcc;
  const syl = syllableBounds(tgt.phones);
  const sylText = tgt.phones.map((p, i) => (syl.has(i) ? '·' : '') + p.t).join('');
  const ref = targetTokens(word, src.lang);
  const versions = [];
  for (const s of STRATEGIES) {
    const tgt = s.accent ? tgtAcc : tgtPlain;
    const { chosen } = select(src, tgt, 250, {}, s.cuts);
    const segs = plan(src, tgt, chosen);
    const f = `${word}-${s.key}.wav`;
    writeWav(`${outDir}/${f}`, render(src, segs));
    const heard = await hear(`${outDir}/${f}`);
    const pieces = segs.map(g => {
      const ws = [...new Set(g.parts.map(st => src.words[chosen[st].p.w].w.replace(/[^\p{L}\p{N}'-]/gu, '')))].join(' ');
      return { at: +g.start.toFixed(2), len: +(g.end - g.start).toFixed(2), sounds: [...new Set(g.parts.map(st => st >> 1))].map(i => tgt.phones[i].t).join(''), words: ws };
    });
    versions.push({ file: f, label: `${s.label} · ${segs.length} Stücke · Modell hört: ${heard.join('')} (PER ${(100 * per(ref, heard)).toFixed(0)} %)`, detail: pieces, missing: [] });
    console.error(`${word.padEnd(10)} ${s.key.padEnd(7)} ${segs.length} Stücke  ${heard.join('')}`);
  }
  const plainText = tgtPlain.phones.map(p => p.t).join('');
  report.push({ text: word, note: `Wörterbuch: ${plainText} · an den Akzent angepasst: ${sylText}`, versions });
}
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
writeFileSync(`${outDir}/index.html`, page(report));
console.error(`→ ${outDir}/index.html`);
