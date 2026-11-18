// G2P über espeak-ng (dieselbe Lautschrift, mit der das Phonemmodell trainiert
// wurde) und Zerlegung in Tokens des Modell-Vokabulars.

import { execFileSync } from 'node:child_process';

const VOICE = { de: 'de', en: 'en-us', 'en-us': 'en-us', 'en-gb': 'en-gb' };

/** Ein Wort pro Eintrag → IPA-String pro Wort (Betonungszeichen bleiben drin). */
// Schwache Formen englischer Funktionswörter (wie in Misheard, oronyms.js):
// Im Satz sagt niemand /eɪ/ für „a“ oder /tuː/ für „to“.
const EN_WEAK = { a: 'ə', an: 'ən', and: 'ənd', as: 'əz', at: 'ət', for: 'fɚ', from: 'fɹəm',
  of: 'əv', than: 'ðən', the: 'ðə', to: 'tə' };

export function espeak(words, lang = 'de') {
  // Apostrophe gehören im Englischen zum Wort („I'm“, „don't“)
  const clean = w => (lang.startsWith('en') ? w.replace(/[^\p{L}\p{N}']/gu, '').replace(/^'+|'+$/g, '') : w.replace(/[^\p{L}\p{N}]/gu, '')) || 'äh';
  const input = words.map(w => clean(w) + '.').join('\n');
  const out = execFileSync('espeak-ng', ['-v', VOICE[lang], '-q', '--ipa=3'], { input, encoding: 'utf8' });
  const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length !== words.length) throw new Error(`espeak: ${lines.length} Zeilen für ${words.length} Wörter`);
  if (lang.startsWith('en')) return lines.map((l, i) => {
    const weak = EN_WEAK[clean(words[i]).toLowerCase()];
    return weak ? (lang === 'en-gb' ? weak.replace('ɚ', 'ə') : weak) : l;   // britisch: nicht rhotisch
  });
  return lines;
}


/**
 * IPA → [{t, stress}] mit längster Übereinstimmung gegen das Vokabular.
 * `stress` = 1 für den Vokal direkt nach ˈ, 2 nach ˌ.
 */
export function tokenize(ipa, vocabSet) {
  // ʏ fehlt im Vokabular; das Modell schreibt kurzes ü als y.
  const s = ipa.replace(/‍/g, '').replace(/_/g, '').replace(/ʏ/g, 'y');
  const out = [];
  let stress = 0;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === 'ˈ') { stress = 1; i++; continue; }
    if (c === 'ˌ') { stress = 2; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    let hit = null;
    for (let n = 4; n >= 1; n--) {
      const cand = s.slice(i, i + n);
      if (vocabSet.has(cand)) { hit = cand; break; }
    }
    if (!hit) { i++; continue; }                  // unbekanntes Zeichen überspringen
    if (hit === 'pf') {                           // Modell gibt „pf“ praktisch nie aus, hört p + f
      out.push({ t: 'p', stress: 0 }, { t: 'f', stress: 0 }); i += 2; continue;
    }
    const isV = isVowel(hit);
    out.push({ t: hit, stress: isV ? stress : 0 });
    if (isV) stress = 0;
    i += hit.length;
  }
  return out;
}

const VOWEL_CHARS = 'aeiouyøœɛɪɔʊəɐɜɚɝɑæʌɒɨʉɵɤɯ';
export const isVowel = t => VOWEL_CHARS.includes(t[0]) && t !== 'j';

/**
 * Lautklasse fürs Alignment: Varianten, die espeak und das Modell
 * unterschiedlich schreiben, zählen als gleich (der tatsächlich gehörte
 * Laut wird trotzdem mitprotokolliert).
 */
export function soundClass(t) {
  const b = t.replace(/ː/g, '');
  if (/^(r|ʁ|ɾ|ɐ|ɜ|ɚ|ɹ|ʀ|χ)$/.test(b)) return 'R';
  if (/^(ɔø|oɪ|ɔɪ|ɔʏ|ɔy)$/.test(b)) return 'OY';
  if (/^(aɪ|ai|ae)$/.test(b)) return 'AI';
  if (/^(aʊ|au|ao)$/.test(b)) return 'AU';
  if (/^(a|ɑ|ä|ʌ|æ)$/.test(b)) return 'A';
  if (/^(e|ɛ|e̞)$/.test(b)) return 'E';
  if (/^(i|ɪ|ᵻ)$/.test(b)) return 'I';
  if (/^(o|ɔ|o̞)$/.test(b)) return 'O';
  if (/^(u|ʊ)$/.test(b)) return 'U';
  if (/^(y|ʏ|ʉ)$/.test(b)) return 'Y';
  if (/^(ø|œ)$/.test(b)) return 'OE';
  if (/^(ç|x|ɕ)$/.test(b)) return 'CH';
  if (b === 'ə') return 'SCHWA';
  return b;
}

/** Nur echte Einzellaute aus dem Modell-Vokabular (keine Silbenkombis wie „əl“, keine Tonziffern). */
export function phoneVocab(vocab) {
  const COMBOS = new Set(['əl', 'ɔːɹ', 'ɑːɹ', 'oːɹ', 'ɛɹ', 'ɪɹ', 'ʊɹ', 'aɪə', 'aɪɚ', 'ja', 'ju']);
  return new Set(vocab.filter(t => !/[<>\d.\[\]^"?]/.test(t) && !COMBOS.has(t)));
}
