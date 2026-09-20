// Wie leicht verwechselt man zwei Laute?
//
// Grundlage ist der klassische Befund von Miller & Nicely (1955): im Rauschen
// überleben Stimmhaftigkeit und Nasalität, der Artikulationsort geht als
// Erstes verloren. Entsprechend ist ein Ortswechsel bei gleicher Artikulationsart
// billig, ein Wechsel der Art oder der Stimmhaftigkeit teuer. Ein paar
// notorische Paare (θ/f, ð/v, l/ɹ) sind zusätzlich von Hand verbilligt.
//
// Die Zahlen sind Kosten, keine Wahrscheinlichkeiten: 0 = identisch,
// ~1 = im Nebenzimmer verwechselbar, >3 = eigentlich nicht.

import { encodeMap, unstress, isVowel } from './phonemes.js';

const VOWEL_NAMES = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'];

// [Ort, Art, stimmhaft]
const CONSONANT = {
  P: ['labial', 'stop', 0], B: ['labial', 'stop', 1],
  T: ['alveolar', 'stop', 0], D: ['alveolar', 'stop', 1],
  K: ['velar', 'stop', 0], G: ['velar', 'stop', 1],
  CH: ['postalveolar', 'affricate', 0], JH: ['postalveolar', 'affricate', 1],
  F: ['labiodental', 'fricative', 0], V: ['labiodental', 'fricative', 1],
  TH: ['dental', 'fricative', 0], DH: ['dental', 'fricative', 1],
  S: ['alveolar', 'fricative', 0], Z: ['alveolar', 'fricative', 1],
  SH: ['postalveolar', 'fricative', 0], ZH: ['postalveolar', 'fricative', 1],
  HH: ['glottal', 'fricative', 0],
  M: ['labial', 'nasal', 1], N: ['alveolar', 'nasal', 1], NG: ['velar', 'nasal', 1],
  L: ['alveolar', 'liquid', 1], R: ['alveolar', 'liquid', 1],
  W: ['labial', 'glide', 1], Y: ['palatal', 'glide', 1],
};

// [Höhe 0..3, Lage 0..2 (vorn..hinten), Diphthong]
const VOWEL = {
  IY: [3, 0, 0], IH: [2.4, 0.3, 0], EY: [2.5, 0.3, 1], EH: [1.6, 0.3, 0],
  AE: [0.8, 0.4, 0], AA: [0, 1.6, 0], AO: [0.9, 2, 0], OW: [1.8, 1.8, 1],
  UH: [2.4, 1.7, 0], UW: [3, 2, 0], AH: [1.5, 1.1, 0], ER: [1.7, 1.1, 0],
  AY: [1.2, 0.9, 1], AW: [1.2, 1.1, 1], OY: [1.6, 1.4, 1],
};

const PLACE_STEP = { labial: 0, labiodental: 0.5, dental: 1, alveolar: 1.5, postalveolar: 2, palatal: 2.5, velar: 3, glottal: 4 };

// Paare, die sich der Systematik entziehen — meist, weil sie im Alltag
// tatsächlich ständig verwechselt werden.
const OVERRIDES = {
  'TH F': 0.5, 'DH V': 0.5, 'TH S': 1.2, 'DH Z': 1.2, 'TH T': 1.4, 'DH D': 1.4,
  'L R': 1.4, 'W R': 1.8, 'W V': 1.6, 'M N': 1.1, 'N NG': 0.9, 'M NG': 1.8,
  'Y IY': 1.2, 'W UW': 1.2, 'HH F': 1.8,
};

function consonantCost(a, b) {
  const x = CONSONANT[a], y = CONSONANT[b];
  if (!x || !y) return 9;
  const key = OVERRIDES[`${a} ${b}`] ?? OVERRIDES[`${b} ${a}`];
  if (key !== undefined) return key;

  const place = Math.abs(PLACE_STEP[x[0]] - PLACE_STEP[y[0]]);
  const voice = x[2] === y[2] ? 0 : 1.6;          // Stimmhaftigkeit hält sich
  if (x[1] === y[1]) return 0.7 + place * 0.45 + voice;

  // Artikulationsart gewechselt: Nasale und Verschlüsse sind gut unterscheidbar,
  // Reibe- und Affrikatlaute gehen ineinander über.
  const soft = new Set(['fricative', 'affricate']);
  const manner = soft.has(x[1]) && soft.has(y[1]) ? 1.3
    : x[1] === 'nasal' || y[1] === 'nasal' ? 3.2
    : 2.4;
  return manner + place * 0.35 + voice;
}

function vowelCost(a, b) {
  const x = VOWEL[a], y = VOWEL[b];
  if (!x || !y) return 9;
  const d = Math.hypot((x[0] - y[0]) * 0.75, (x[1] - y[1]) * 0.6);
  return 0.45 + d + (x[2] === y[2] ? 0 : 0.5);
}

const base = name => name;

/** Kostentabelle über die kodierten Zeichen, betonungsfrei. */
export const COST = new Map();
/** Für jedes Zeichen die billigen Alternativen, aufsteigend nach Kosten. */
export const NEIGHBOURS = new Map();

{
  const cons = Object.keys(CONSONANT).map(n => [n, encodeMap.get(n)]);
  const vows = Object.keys(VOWEL).map(n => [n, unstress(encodeMap.get(n + '1'))]);

  const put = (ca, cb, cost) => {
    COST.set(ca + cb, cost);
    COST.set(cb + ca, cost);
  };
  for (let i = 0; i < cons.length; i++)
    for (let j = i + 1; j < cons.length; j++)
      put(cons[i][1], cons[j][1], consonantCost(base(cons[i][0]), base(cons[j][0])));
  for (let i = 0; i < vows.length; i++)
    for (let j = i + 1; j < vows.length; j++)
      put(vows[i][1], vows[j][1], vowelCost(base(vows[i][0]), base(vows[j][0])));

  // Schwa ist der Schluckauf des Englischen: unbetonte Vokale fallen zusammen.
  const schwa = unstress(encodeMap.get('AH1'));
  for (const [, c] of vows) if (c !== schwa) put(c, schwa, Math.min(COST.get(c + schwa) ?? 9, 0.55));

  for (const [, c] of [...cons, ...vows]) {
    const list = [];
    for (const [, d] of [...cons, ...vows]) {
      if (c === d) continue;
      const cost = COST.get(c + d);
      // Großzügiger Schnitt: manche Paare werden erst im Kontext billig
      // (k/g nach /s/), die dürfen hier nicht schon wegfallen.
      if (cost !== undefined && cost <= 3.2) list.push({ ch: d, cost });
    }
    list.sort((a, b) => a.cost - b.cost);
    NEIGHBOURS.set(c, list);
  }
}

const VOWELS_SET = new Set([...Array(15).keys()].map(i => unstress(encodeMap.get(VOWEL_NAMES[i] + '1'))));
const STOPS_ALL = new Set(['P', 'B', 'T', 'D', 'K', 'G'].map(n => encodeMap.get(n)));

/**
 * Clustervereinfachung: ein Verschlusslaut zwischen zwei Konsonanten fällt im
 * Englischen routinemäßig weg — "mints" und "mince" klingen gleich, ebenso
 * "friendship" und "frienship". Ohne diese Regel kostet das Weglassen so viel
 * wie ein beliebiger Lautverlust.
 */
export function elisionFactor(prevCh, nextCh, ch) {
  if (!STOPS_ALL.has(ch)) return 1;
  const consonant = c => c !== undefined && !VOWELS_SET.has(c);
  return consonant(prevCh) && consonant(nextCh) ? 0.3 : 1;
}

/** Laute, die beim Hören gern verschwinden oder dazukommen. */
export const ELIDABLE = new Map([
  [encodeMap.get('HH'), 0.7],
  [unstress(encodeMap.get('AH1')), 0.8],
  [encodeMap.get('T'), 1.6],
  [encodeMap.get('D'), 1.6],
  [unstress(encodeMap.get('ER1')), 1.4],
]);

export const cost = (a, b) => (a === b ? 0 : COST.get(a + b) ?? 9);

const S = encodeMap.get('S');
const pair = list => new Map(list.flatMap(([a, b]) =>
  [[encodeMap.get(a), encodeMap.get(b)], [encodeMap.get(b), encodeMap.get(a)]]));

const STOP_TWIN = pair([['P', 'B'], ['T', 'D'], ['K', 'G']]);
/** Verschluss-, Reibe- und Affrikatlaute — alles, was ein Geräusch erzeugt. */
const OBSTRUENTS = new Set(['P', 'B', 'T', 'D', 'K', 'G', 'F', 'V', 'TH', 'DH',
  'S', 'Z', 'SH', 'ZH', 'CH', 'JH', 'HH'].map(n => encodeMap.get(n)));
const VOICE_TWIN = pair([['P', 'B'], ['T', 'D'], ['K', 'G'],
  ['F', 'V'], ['TH', 'DH'], ['S', 'Z'], ['SH', 'ZH'], ['CH', 'JH']]);

/**
 * Manche Verwechslungen sind nur in bestimmter Umgebung billig.
 *
 * - Nach /s/ ist der Stimmhaftigkeitskontrast der Verschlusslaute praktisch
 *   aufgehoben: das k in "sky" ist unbehaucht und klingt wie ein g. Daran
 *   hängt das bekannteste Oronym überhaupt ("the sky" / "this guy").
 * - Am Wortende sind Verschlusslaute im Englischen unreleased; die
 *   Stimmhaftigkeit wird dort fast nur über die Länge des Vokals davor
 *   signalisiert, also über ein schwaches Merkmal. "heard" und "hurt" liegen
 *   näher beieinander, als die Systematik vermuten lässt.
 * - Angleichung an den Nachbarlaut: wird ein Laut so gehört, dass er mit dem
 *   Laut davor oder danach zusammenfällt, entsteht ein langer Laut statt zweier
 *   kurzer — und genau das hört niemand heraus. "mishear it" wird so zu
 *   "miss see rid": das /h/ verschwindet im /s/ davor.
 */
export function contextFactor(prevCh, nextCh, from, to, atEnd) {
  if (to === prevCh || to === nextCh) return 0.35;
  if (prevCh === S && STOP_TWIN.get(from) === to) return 0.25;
  if (atEnd && VOICE_TWIN.get(from) === to) return 0.3;
  // Angleichung der Stimmhaftigkeit im Geräuschlautcluster: neben einem
  // anderen Obstruenten gleicht sich ein Laut in der Stimmhaftigkeit an, und
  // der Unterschied wird unhörbar. "example" und "egg sample" trennt genau das.
  if (VOICE_TWIN.get(from) === to && (OBSTRUENTS.has(prevCh) || OBSTRUENTS.has(nextCh))) return 0.35;
  return 1;
}

/**
 * Affrikaten sind bei uns ein Laut, ihre Bestandteile zwei — dadurch haben
 * "why choose" (w aɪ tʃ u z) und "white shoes" (w aɪ t ʃ u z) verschiedene
 * Kettenlängen und könnten sich sonst nie treffen. Gesprochen ist der
 * Unterschied minimal.
 */
export const AFFRICATES = new Map([
  [encodeMap.get('CH'), encodeMap.get('T') + encodeMap.get('SH')],
  [encodeMap.get('JH'), encodeMap.get('D') + encodeMap.get('ZH')],
]);
export const AFFRICATE_COST = 0.5;
export { isVowel };
