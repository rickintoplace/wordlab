// Aussprachelexika für Slinky-Cut, in den Symbolen des Phonemmodells
// (wav2vec2-xlsr-53-espeak-cv-ft, espeak-artige IPA).
//
//   Englisch: CMUdict (ARPAbet mit Betonung)        → public/data/slinky/lex-en.txt
//   Deutsch:  WikiPron/Wiktionary (breite IPA)      → public/data/slinky/lex-de.txt
//
// Zeilenformat: <wort>\t<laute>, Laute durch Leerzeichen getrennt; ein
// vorangestelltes ˈ bzw. ˌ markiert den betonten Vokal.

import fs from 'node:fs';
import path from 'node:path';
import { ensureSources } from './sources.mjs';
import { rulesDe } from '../public/slinky/g2p.js';
import { soundClass } from '../public/slinky/phones.js';

const OUT = path.join(import.meta.dirname, '..', 'public', 'data', 'slinky');
fs.mkdirSync(OUT, { recursive: true });
const cache = await ensureSources();

// ---------- Englisch ----------
const ARPA = {
  AA: 'ɑː', AE: 'æ', AH: 'ʌ', AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɜː', EY: 'eɪ',
  IH: 'ɪ', IY: 'iː', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm',
  N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
const en = new Map();
for (const line of fs.readFileSync(path.join(cache, 'cmudict.dict'), 'utf8').split('\n')) {
  const m = line.match(/^([^\s(]+)(?:\(\d+\))?\s+([^#]+)/);
  if (!m) continue;
  const word = m[1].toLowerCase();
  if (en.has(word)) continue;                     // erste Variante = häufigste
  const toks = m[2].trim().split(/\s+/).map(ph => {
    const base = ph.replace(/\d/, ''), stress = ph.match(/\d/)?.[0];
    let t = ARPA[base];
    if (!t) return null;
    if (base === 'AH' && stress === '0') t = 'ə';   // unbetontes AH ist Schwa
    if (base === 'ER' && stress === '0') t = 'ɚ';
    return (stress === '1' ? 'ˈ' : stress === '2' ? 'ˌ' : '') + t;
  });
  if (toks.includes(null)) continue;
  en.set(word, toks.join(' '));
}
fs.writeFileSync(path.join(OUT, 'lex-en.txt'), [...en].map(([w, p]) => `${w}\t${p}`).join('\n') + '\n');
console.log(`Englisch: ${en.size} Wörter`);

// ---------- Deutsch ----------
// WikiPron schreibt breite IPA ohne Betonung. Abbildung auf die espeak-artigen
// Symbole, mit denen das Modell trainiert wurde: -er als [ɜ], r nach Vokal als [ɾ],
// konsonantisches r als [r]; silbische Konsonanten als Schwa + Konsonant.
function mapDe(ipa) {
  const raw = ipa.split(' ').map(s => s.replace(/[ˑ̥̊ʰ͜‿]/g, '').replace('t͡s', 'ts').replace('t͡ʃ', 'tʃ').replace('d͡ʒ', 'dʒ').replace('p͡f', 'pf'));
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i], nx = raw[i + 1] ?? '';
    if (!s || s === 'ʔ') continue;
    // Diphthonge
    if (s === 'a' && (nx === 'ɪ̯' || nx === 'ɛ̯' || nx === 'e̯' || nx === 'i̯' || nx === 'ɪ')) { out.push('aɪ'); i++; continue; }
    if (s === 'a' && (nx === 'ʊ̯' || nx === 'ɔ̯' || nx === 'o̯' || nx === 'u̯' || nx === 'ʊ')) { out.push('aʊ'); i++; continue; }
    if ((s === 'ɔ' || s === 'ɔʏ') && (nx === 'ʏ̯' || nx === 'ɪ̯' || nx === 'y̯' || nx === 'ø̯' || nx === 'œ̯' || nx === 'ʏ')) { out.push('ɔø'); i++; continue; }
    if (s === 'pf') { out.push('p', 'f'); continue; }
    if (/^[nlmŋ]̩/.test(s)) { out.push('ə', s[0]); continue; }
    const t = {
      'ʁ': 'r', 'ʀ': 'r', 'r': 'r', 'χ': 'x', 'ɐ': 'ɜ', 'ɐ̯': 'ɾ', 'ʏ': 'y', 'ʏ̯': 'y', 'ɪ̯': 'j', 'i̯': 'j',
      'ʊ̯': 'ʊ', 'u̯': 'u', 'e̯': 'e', 'o̯': 'o', 'ɛ̯': 'ɛ', 'ɔ̯': 'ɔ',
    }[s] ?? s.replace(/[̯̩]/g, '');
    if (!t || /[̃]/.test(t)) { out.push(t.replace(/̃/g, '')); continue; }
    out.push(t);
  }
  // „t s“ ist im Deutschen die Affrikate [ts] (z, tz) – das Modell kennt sie als ein Symbol
  const merged = [];
  for (const t of out.filter(Boolean)) {
    if (t === 's' && merged.at(-1) === 't') merged[merged.length - 1] = 'ts';
    else merged.push(t);
  }
  return merged;
}

const VOWEL = /^(aː|a|eː|e|ɛː|ɛ|iː|i|ɪ|oː|o|ɔ|uː|u|ʊ|yː|y|øː|ø|œ|ə|ɜ|aɪ|aʊ|ɔø|ɑ|ɑː|ɔː|æ)$/;
// Deutsche Betonung (Näherung): erste Silbe des Stamms; nicht auf unbetonten
// Präfixen; Fremdwortendungen tragen den Ton selbst.
const UNSTRESSED_PREFIX = /^(be|ge|er|ver|zer|ent|emp|miss)(?=[a-zäöüß]{3})/;
const STRESSED_SUFFIX = /(ieren|ierung|ion|ei|ität|ur|ist|ismus|ie|ik|ant|enz|anz|ell|ös|är|al|ent|ett|eur|ös|ade|age)$/;
function stressDe(word, toks) {
  const vows = toks.map((t, i) => (VOWEL.test(t) && t !== 'ə' && t !== 'ɜ' ? i : -1)).filter(i => i >= 0);
  if (!vows.length) return toks;
  let k = vows[0];
  const w = word.toLowerCase();
  const suf = w.match(STRESSED_SUFFIX);
  if (suf && vows.length > 1) {
    // Vokal der Endung: der letzte volle Vokal (bei -ieren der vorletzte)
    k = /ieren$|ierung$/.test(w) && vows.length >= 2 ? vows.find(i => toks[i] === 'iː' && i >= vows.at(-2)) ?? vows.at(-1) : vows.at(-1);
  } else if (UNSTRESSED_PREFIX.test(w) && vows.length > 1) k = vows[1];
  return toks.map((t, i) => (i === k ? 'ˈ' + t : t));
}

// Wiktionary führt oft Umgangs- und Schnellsprech-Varianten mit, manchmal an
// erster Stelle („wir“ → [mɐ], „eine“ → [nə], „und“ → [ən]), und Groß- und
// Kleinschreibung fallen zusammen („IM“ [iːɛm] vs. „im“). Gewählt wird darum
// die Variante, die der Aussprache nach der Schreibung (Regeln) am nächsten
// kommt – das ist fast immer die Standardform. Gleichstand: die erste.
const de = new Map();
const cands = new Map();
for (const line of fs.readFileSync(path.join(cache, 'deu_latn_broad.tsv'), 'utf8').split('\n')) {
  const [word, ipa] = line.split('\t');
  if (!word || !ipa || /\s/.test(word)) continue;
  const toks = mapDe(ipa);
  if (!toks.length) continue;
  const key = word.toLowerCase();
  (cands.get(key) ?? cands.set(key, []).get(key)).push({ word, toks });
}
function editDist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const sub = a[i - 1] === b[j - 1] ? 0 : soundClass(a[i - 1]) === soundClass(b[j - 1]) ? 0 : 1;   // Länge egal: die regelt Wiktionary besser
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
  }
  return d[a.length][b.length];
}
for (const [key, list] of cands) {
  const rules = rulesDe(key).map(x => x.t);
  let best = null, bestScore = Infinity;
  for (const c of list) {
    // Schreibung genau wie der Schlüssel (klein) bevorzugen: „im“ statt „IM“
    const sc = editDist(c.toks, rules) + (c.word === key || list.every(x => x.word !== key) ? 0 : 1.5);
    if (sc < bestScore - 1e-9) { best = c; bestScore = sc; }
  }
  de.set(key, best.toks);
}
for (const [w, toks] of de) de.set(w, stressDe(w, toks).join(' '));
fs.writeFileSync(path.join(OUT, 'lex-de.txt'), [...de].map(([w, p]) => `${w}\t${p}`).join('\n') + '\n');
console.log(`Deutsch: ${de.size} Wörter`);
for (const w of ['wir', 'im', 'und', 'ist', 'es', 'das', 'den', 'mir', 'du', 'eine', 'einem', 'einen', 'ein', 'neue', 'dinosaurier', 'evolution', 'regnen', 'werden', 'oder', 'verwandt', 'profitieren', 'göttingen', 'pizza', 'computer', 'neun', 'häuser'])
  console.log('  ', w, '→', de.get(w));
for (const w of ['pizza', 'computer', 'dinosaur', 'the', "i'm", 'butter', 'water'])
  console.log('  ', w, '→', en.get(w));
