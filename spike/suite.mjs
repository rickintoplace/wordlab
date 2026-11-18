// Hörtest: erzeugt für jeden Testsatz mehrere Fassungen und eine Seite zum
// blinden Vergleichen.
//
//   node suite.mjs media/dino out/dino

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { loadSource, targetPhones, select, plan, render, writeWav, W } from './mix.mjs';
import { loadScorer, hear, targetTokens, per } from './score.mjs';
import { page } from './page.mjs';

// Analyse durch Synthese: mehrere Gewichtungen ausprobieren, das Phonemmodell
// hört jede Fassung an, die verständlichste gewinnt.
const BASE = { ...W };
const VARIANTS = [
  { name: 'standard' },
  { name: 'größere Stücke', cutEdge: BASE.cutEdge * 1.6, cutMid: BASE.cutMid * 1.6 },
  { name: 'strenger Kontext', ctxClass: BASE.ctxClass * 1.6, ctxGroup: BASE.ctxGroup * 1.6, ctxOther: BASE.ctxOther * 1.6 },
  { name: 'mehr Prosodie', prom: BASE.prom * 2, f0: BASE.f0 * 1.5 },
  { name: 'kleinere Stücke', cutEdge: BASE.cutEdge * 0.6, cutMid: BASE.cutMid * 0.6, cutWord: BASE.cutWord * 0.6 },
];
await loadScorer();

const [dir, outDir, suffix = ''] = process.argv.slice(2);
const tests = JSON.parse(readFileSync(`${dir}/tests.json`));
const meta = JSON.parse(readFileSync(`${dir}/post${suffix}.json`));
mkdirSync(outDir, { recursive: true });
const src = loadSource(dir, suffix);
const VOC = /-voc/.test(dir);
const MUSIC = VOC ? (() => { const b = readFileSync(`${dir}/music48.f32`); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); })() : null;
const norm = w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** Wie heutige Tools: ganze Wörter an Whisper-Zeitstempeln, harte Schnitte. */
function naive(text) {
  const segs = [], missingWords = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const hit = src.words.find(x => norm(x.w) === norm(w));
    if (!hit) { missingWords.push(w); continue; }
    segs.push({ start: hit.s, end: hit.e, parts: [], pauseAfter: /[.!?]$/.test(w) ? 0.35 : /[,;:]$/.test(w) ? 0.15 : 0 });
  }
  return { segs, missingWords };
}

// Umgebungen für die Phonetik-Tests
const VOWEL = /^(a|aː|ɑ|ɑː|e|eː|ɛ|ɛː|i|iː|ɪ|o|oː|ɔ|u|uː|ʊ|y|yː|ø|øː|œ|aɪ|aʊ|ɔø)$/;
const PRED = {
  // d mit nasaler Lösung: direkt vor n oder vor sehr kurzem Schwa + n
  dNasal: (p, all) => {
    const n1 = all[p.next], n2 = n1 && all[n1.next];
    if (!n1) return false;
    return n1.t === 'n' || (n1.t === 'ə' && n1.e - n1.s <= 0.04 && n2?.t === 'n');
  },
  dOral: (p, all) => { const n1 = all[p.next]; return !!n1 && VOWEL.test(n1.t); },
  afterR: p => /^(r|ʁ|ɾ)$/.test(p.prevT ?? ''),
  afterVelar: p => /^(k|ɡ)$/.test(p.prevT ?? ''),
};

const STAMP = Date.now();

// Runde 5: Neu-Abgleich. Die Wort-Methode ist raus (immer abgeschnitten), dafür
// treten Engine-Einstellungen gegeneinander an.
const R1 = { ...BASE, ctxPause: 1.2, cutMid: 0.6, cutWord: BASE.cutEdge, maskRange: 200, f0: 4,
  prom: 0, dur: 0, midVowel: 0, midSonorant: 0, durDev: 0, normLoud: 0 };
// Runde 6: Basis je Satz = Sieger aus Runde 5 (a, nur Satz 3: b), dagegen dieselbe
// Auswahl mit geglätteter Prosodie (PSOLA: Tonhöhe auf eine Satzmelodie, Tempo vereinheitlicht).
const CONFIGS = [
  { key: 'a', name: 'Gewichte wie Runde 1 (Fehlerkorrekturen behalten)', w: R1, pick: false },
  { key: 'b', name: 'Gewichte wie Runde 4, ohne Lautstärke-Angleichung', w: { ...BASE, normLoud: 0 }, pick: false },
];
const PROSODY_VARIANTS = /vlog/.test(dir) ? [false] : [false, true];
const BASE_FOR = i => (/vlog/.test(dir) || i === 3 ? 'b' : 'a');

async function engine(test, tgt, cfg) {
  const ref = targetTokens(test.text, src.lang);
  const tmp = `${outDir}/_try.wav`;
  let best = null;
  for (const v of cfg.pick ? VARIANTS : [VARIANTS[0]]) {
    Object.assign(W, cfg.w, v.name === 'standard' ? {} : Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'name').map(([k, x]) => [k, x / BASE[k] * cfg.w[k]])));
    const { chosen, total, missing } = select(src, tgt);
    const segs = plan(src, tgt, chosen);
    const audio = render(src, segs);
    writeWav(tmp, audio);
    const heard = await hear(tmp);
    const e = per(ref, heard);
    if (!best || e < best.e - 0.02) best = { e, audio, v, chosen, segs, total, missing, heard };
  }
  Object.assign(W, BASE);
  return best;
}

const report = [];
let n = 0;
for (const test of tests) {
  const tgt = targetPhones(test.text, meta.vocab, src.lang, src.lexicon);
  const versions = [];
  n++;
  if (test.variants) { n--; continue; }                // Phonetik ruht, bis die Grundqualität stimmt
  // Runde 8: dieselbe Basis ohne und mit Kontext für Wortposition und Phrasengrenze
  for (const ctx of VOC ? [true] : [false, true]) {
    const base = CONFIGS.find(c => c.key === BASE_FOR(n));
    const cfg = { ...base, w: { ...base.w, ...(ctx ? {} : { wpos: 0, bound: 0 }) } };
    const r = await engine(test, tgt, cfg);
    const f = `${n}-${cfg.key}${ctx ? '-kontext' : ''}.wav`;
    writeWav(`${outDir}/${f}`, r.audio);
    versions.push({ file: f, label: `${VOC ? 'Nur Stimmspur (Musik abgetrennt)' : cfg.name}${ctx && !VOC ? ' + Wortposition und Phrasengrenze' : ''} · Modell hört: ${r.heard.join('')}`, detail: describe(r.segs, r.chosen, tgt), missing: r.missing });
    if (VOC) {
      // Runde 9: dieselbe Stimmspur mit durchgehender Musik darunter, und zum Vergleich Runde 8 (aus der Mischung geschnitten)
      const m0 = Math.round(60 * 48000), withMusic = Float32Array.from(r.audio, (x, i) => x + (MUSIC[m0 + i] ?? 0));
      const fm = `${n}-stimme-musik.wav`;
      writeWav(`${outDir}/${fm}`, withMusic);
      versions.push({ file: fm, label: 'Stimmspur geschnitten, Musik läuft durchgehend darunter', detail: describe(r.segs, r.chosen, tgt), missing: r.missing });
      const old = `${outDir.replace('-voc', '')}/${n}-b-kontext.wav`;
      if (existsSync(old)) { copyFileSync(old, `${outDir}/${n}-mischung.wav`); versions.push({ file: `${n}-mischung.wav`, label: 'Runde 8: aus der Mischung mit Musik geschnitten' }); }
    }
    console.error(`   ${f}: PER ${(100 * r.e).toFixed(0)} %  ${r.segs.length} Stücke  ${r.heard.join('')}`);
  }
  if (test.variants) {                                   // (ruht, s. o.)
    // Saubere Minimalpaare: Ein Satz, nur der eine Laut wird ausgetauscht.
    Object.assign(W, BASE, { normLoud: 0 });
    const base = select(src, tgt);
    Object.assign(W, BASE);
    for (const v of test.variants) {
      const idx = tgt.phones.findIndex(p => p.t === v.phone && (!v.word || p.word === v.word));
      const T = tgt.phones[idx];
      const pool = src.phones.filter(p => p.t === v.phone && p.e - p.s >= 0.02 && p.lp > -1 && PRED[v.pred](p, src.phones));
      const score = p => (p.prevT === T.prevT ? 0 : 1) + Math.abs(Math.log((p.e - p.s) / src.typical(p.t)));
      const pick = pool.sort((x, y) => score(x) - score(y))[0];
      const chosen = base.chosen.map(c => ({ ...c }));
      chosen[2 * idx] = { p: pick }; chosen[2 * idx + 1] = { p: pick };
      const segs = plan(src, tgt, chosen);
      const f = `${n}-${v.key}.wav`;
      writeWav(`${outDir}/${f}`, render(src, segs));
      versions.push({ file: f, label: `${v.label} – aus „${src.words[pick.w].w}“ (${pool.length} Kandidaten)`, detail: describe(segs, chosen, tgt), missing: [] });
    }
  }
  if (/vlog/.test(dir) && !VOC && !test.variants) {
    const nv = naive(test.text);
    if (!nv.missingWords.length) {
      const f = `${n}-woerter.wav`;
      writeWav(`${outDir}/${f}`, render(src, nv.segs, { naive: true }));
      versions.push({ file: f, label: 'Ganze Wörter an Untertitel-Zeiten, harte Schnitte (wie heutige Tools)' });
    }
  }
  report.push({ ...test, versions });
  console.error(`✓ ${test.text}`);
}

function describe(segs, chosen, tgt) {
  return segs.map(s => {
    const ps = s.parts.map(st => chosen[st].p);
    const words = [...new Set(ps.map(p => src.words[p.w].w.replace(/[^\p{L}\p{N}-]/gu, '')))].join(' ');
    const sounds = s.parts.map(st => (st % 2 === 0 ? '' : '') + tgt.phones[st >> 1].t).filter((x, i, a) => i === 0 || s.parts[i] >> 1 !== s.parts[i - 1] >> 1).join('');
    return { at: +s.start.toFixed(2), len: +(s.end - s.start).toFixed(2), sounds, words };
  });
}

writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
writeFileSync(`${outDir}/index.html`, page(report, STAMP));
console.error(`→ ${outDir}/index.html`);


