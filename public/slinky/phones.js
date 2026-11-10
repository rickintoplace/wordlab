// Gemeinsame Lautlehre für Slinky-Cut: Vokale, Lautklassen, Vokabular des Phonemmodells.

const VOWELS = 'aeiouyøœɛɪɔʊəɐɜɚɝɑæʌɒɨʉɵɤɯ';
export const isVowel = t => !!t && VOWELS.includes(t[0]) && t !== 'j';

/**
 * Lautklasse: Varianten, die Wörterbuch und Modell unterschiedlich schreiben,
 * gelten als gleich (der tatsächlich gehörte Laut wird trotzdem mitgeführt).
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

/**
 * Gleicher Laut, nur anders geschrieben (freie Varianten, kein Bedeutungsunterschied):
 * r/ɾ/ʁ/ʀ/ɹ, vokalisches r (ɐ/ɜ/ɚ), die Schreibweisen der Diphthonge. Wörterbuch
 * und Phonemmodell schreiben dasselbe r verschieden – beim Vergleich zählt das nicht.
 * Länge (aː/a) und Qualität (eː/ɛ) bleiben verschieden.
 */
export function canon(t) {
  if (!t) return t;
  if (/^(r|ʁ|ɾ|ʀ|ɹ)$/.test(t)) return 'r';
  if (/^(ɐ|ɜ|ɚ|ɐ̯)$/.test(t)) return 'ɐ';
  const c = soundClass(t);
  if (c === 'OY' || c === 'AI' || c === 'AU') return c;
  return t;
}

/** Nur echte Einzellaute aus dem Modell-Vokabular (keine Silbenkombis, keine Tonziffern). */
export function phoneVocab(vocab) {
  const COMBOS = new Set(['əl', 'ɔːɹ', 'ɑːɹ', 'oːɹ', 'ɛɹ', 'ɪɹ', 'ʊɹ', 'aɪə', 'aɪɚ', 'ja', 'ju']);
  return new Set(vocab.filter(t => !/[<>\d.\[\]^"?]/.test(t) && !COMBOS.has(t)));
}
