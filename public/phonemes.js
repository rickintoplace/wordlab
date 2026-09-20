// Gemeinsame Phonem-Tabelle für Build und Runtime.
// Jedes Phonem wird auf genau ein ASCII-Zeichen abgebildet, damit die Datendatei
// klein bleibt und zur Laufzeit ohne Parsing auskommt.
//
// Kodierung (Reihenfolge ist Teil des Datenformats, nicht ändern):
//   Index  0..23  Konsonanten
//   Index 24..38  betonte Vokale       (Primär- und Sekundärbetonung zusammengefasst)
//   Index 39..53  dieselben Vokale unbetont

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const CONSONANTS = ['B','CH','D','DH','F','G','HH','JH','K','L','M','N',
  'NG','P','R','S','SH','T','TH','V','W','Y','Z','ZH'];
export const VOWELS = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY',
  'OW','OY','UH','UW'];

export const VOWEL_START = CONSONANTS.length;             // 24
export const N_SYMBOLS = CONSONANTS.length + VOWELS.length * 2; // 54

/** ARPAbet-Phonem (mit Betonungsziffer) -> Kodierzeichen */
export const encodeMap = new Map();
/** Kodierzeichen -> IPA-Darstellung */
export const ipaMap = new Map();

const IPA_CONS = ['b','tʃ','d','ð','f','ɡ','h','dʒ','k','l','m','n',
  'ŋ','p','ɹ','s','ʃ','t','θ','v','w','j','z','ʒ'];
const IPA_VOW = ['ɑ','æ','ʌ','ɔ','aʊ','aɪ','ɛ','ɝ','eɪ','ɪ','i','oʊ','ɔɪ','ʊ','u'];
// Unbetonte Varianten weichen im Amerikanischen teils ab (Schwa).
const IPA_VOW_UNSTRESSED = ['ɑ','æ','ə','ɔ','aʊ','aɪ','ɛ','ɚ','eɪ','ɪ','i','oʊ','ɔɪ','ʊ','u'];

CONSONANTS.forEach((p, i) => { encodeMap.set(p, CHARS[i]); ipaMap.set(CHARS[i], IPA_CONS[i]); });
VOWELS.forEach((p, i) => {
  const s = CHARS[VOWEL_START + i], u = CHARS[VOWEL_START + VOWELS.length + i];
  encodeMap.set(p + '1', s); encodeMap.set(p + '2', s); encodeMap.set(p + '0', u);
  ipaMap.set(s, IPA_VOW[i]); ipaMap.set(u, IPA_VOW_UNSTRESSED[i]);
});

/** Betonte -> unbetonte Variante desselben Vokals. */
const UNSTRESS = new Map(
  VOWELS.map((_, i) => [CHARS[VOWEL_START + i], CHARS[VOWEL_START + VOWELS.length + i]]));

export const unstress = ch => UNSTRESS.get(ch) ?? ch;

/**
 * Affrikaten sind lautlich ein Verschluss plus ein Reibelaut. Als ein Zeichen
 * geführt, hätten "why choose" (… tʃ u z) und "white shoes" (… t ʃ u z)
 * verschiedene Kettenlängen und könnten sich nie treffen — die Wortgrenze fällt
 * ja mitten in die Affrikate. Deshalb werden sie überall aufgelöst.
 */
const AFFRICATE_PARTS = new Map([
  [encodeMap.get('CH'), encodeMap.get('T') + encodeMap.get('SH')],
  [encodeMap.get('JH'), encodeMap.get('D') + encodeMap.get('ZH')],
]);

export const expand = code => [...code].map(ch => AFFRICATE_PARTS.get(ch) ?? ch).join('');

/**
 * Dieselbe Lautfolge ohne Betonung und mit aufgelösten Affrikaten. In
 * zusammenhängender Rede verschiebt sich die Betonung ständig — wer
 * "ice cream" als "I scream" hört, hört genau das.
 */
export const looseCode = code => expand([...code].map(unstress).join(''));

const vowelChars = new Set(CHARS.slice(VOWEL_START, N_SYMBOLS));
export const isVowel = ch => vowelChars.has(ch);
const stressedChars = new Set(CHARS.slice(VOWEL_START, VOWEL_START + VOWELS.length));
export const isStressed = ch => stressedChars.has(ch);

/** ARPAbet-Folge -> kodierter String; null wenn ein Phonem unbekannt ist. */
export function encode(phones) {
  let out = '';
  for (const p of phones) {
    const c = encodeMap.get(p);
    if (!c) return null;
    out += c;
  }
  return out;
}

export const countSyllables = code => [...code].filter(isVowel).length;

/**
 * Kodierter String -> IPA. Die erste betonte Silbe bekommt ein ˈ; Sekundär-
 * betonung ist beim Kodieren bewusst mit der Primärbetonung verschmolzen.
 */
export function toIPA(code) {
  const parts = [...code].map(ch => ipaMap.get(ch) ?? '?');
  const first = [...code].findIndex(isStressed);
  if (first >= 0 && countSyllables(code) > 1) {
    let j = first;
    while (j > 0 && !isVowel(code[j - 1])) j--; // Anlaut der betonten Silbe
    parts[j] = 'ˈ' + parts[j];
  }
  return parts.join('');
}

/** Position des ersten Vokals = Länge des Anlauts. */
export function onsetLength(code) {
  let i = 0;
  while (i < code.length && !isVowel(code[i])) i++;
  return i;
}

