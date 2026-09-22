// Kern des Generators: baut aus der Wortliste einen phonetischen Index und
// erzeugt daraus Spoonerismen. Kein DOM — läuft genauso unter Node.
//
// Ein Spoonerismus besteht hier aus zwei Wortpaaren, deren Anlaute getauscht
// werden:  A = a+R1, C = b+R2  ->  B = b+R1, D = a+R2.
// Alle vier müssen existierende Wörter sein. Weil A/B denselben Reim teilen
// (und C/D ebenso), reimen sich die Zeilen automatisch.

import { onsetLength, countSyllables, toIPA } from './phonemes.js';

/**
 * @typedef {{word: string, code: string, onset: string, rime: string,
 *            rank: number, variant: number, syllables: number}} Entry
 */

/**
 * Baut die Indizes aus der Datendatei (eine Zeile je Aussprache, nach
 * Häufigkeit sortiert). `vulgarText` ist die Wortliste aus data/vulgar.txt.
 */
export function buildIndex(text, vulgarText = '') {
  const vulgarWords = new Set(vulgarText.split('\n').map(w => w.trim()).filter(Boolean));
  /** @type {Entry[]} */
  const entries = [];
  /** @type {Map<string, Map<string, Entry[]>>} rime -> onset -> Einträge (Homophone) */
  const byRime = new Map();
  /** @type {Map<string, string[]>} onset -> Reime */
  const byOnset = new Map();
  /** @type {Map<string, Entry[]>} wort -> Aussprachen */
  const byWord = new Map();

  const lines = text.split('\n');
  for (let rank = 0; rank < lines.length; rank++) {
    const line = lines[rank];
    if (!line) continue;
    const tab1 = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab1 + 1);
    const word = line.slice(0, tab1);
    const code = line.slice(tab1 + 1, tab2);
    const k = onsetLength(code);
    /** @type {Entry} */
    const entry = {
      word, code, rank,
      onset: code.slice(0, k),
      rime: code.slice(k),
      variant: +line.slice(tab2 + 1),
      syllables: countSyllables(code),
      vulgar: vulgarWords.has(word),
    };
    entries.push(entry);

    let onsets = byRime.get(entry.rime);
    if (!onsets) byRime.set(entry.rime, (onsets = new Map()));
    const bucket = onsets.get(entry.onset);
    if (bucket) {
      bucket.push(entry);                    // Homophon oder Zweitaussprache
    } else {
      onsets.set(entry.onset, [entry]);
      let rimes = byOnset.get(entry.onset);
      if (!rimes) byOnset.set(entry.onset, (rimes = []));
      rimes.push(entry.rime);
    }

    const w = byWord.get(word);
    if (w) w.push(entry); else byWord.set(word, [entry]);
  }
  // Für die derben Modi: ein eigener Topf, aus dem gezogen wird.
  const vulgarEntries = entries.filter(e => e.vulgar && e.variant === 0);
  return { entries, byRime, byOnset, byWord, vulgarEntries };
}

/** Einschränkungen, die für ein Wortpaar (= eine Spalte) gelten. */
export const PAIR_DEFAULTS = {
  minLetters: 3, maxLetters: 12, minSyllables: 1, maxSyllables: 3,
};

/**
 * Wie derb darf es sein?
 *   NONE  derbe Wörter sind ausgeschlossen
 *   ANY   kein Filter
 *   SOME  mindestens eins der vier Wörter ist derb
 *   MOST  in jedem Wortpaar steckt ein derbes Wort (alle vier gibt das
 *         Vokabular praktisch nicht her — siehe README)
 */
export const VULGARITY = { NONE: 0, ANY: 1, SOME: 2, MOST: 3 };

export const DEFAULTS = {
  maxRank: 10000,         // nur die N häufigsten Wörter zulassen
  allowVowelOnset: true,  // leerer Anlaut, z. B. icicle/bicycle
  allowVariants: false,   // Nebenaussprachen (for -> /fɚ/) stiften mehr Unsinn als Nutzen
  vulgarity: VULGARITY.NONE,
  bias: 2,                // >1 bevorzugt häufigere Wörter bei der Auswahl
  shortlist: 3,           // so viele Treffer sammeln, den natürlichsten nehmen
  pairs: [PAIR_DEFAULTS, PAIR_DEFAULTS],
};

export function withDefaults(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  o.pairs = [0, 1].map(i => ({ ...PAIR_DEFAULTS, ...(opts.pairs?.[i] ?? {}) }));
  return o;
}

/** Erfüllt der Eintrag die Optionen für Spalte `slot`? */
function ok(entry, o, slot) {
  const p = o.pairs[slot];
  return entry.rank <= o.maxRank
    && !entry.word.includes("'")          // "that's" ist für Misheard da
    && (o.allowVariants || entry.variant === 0)
    && (o.vulgarity !== VULGARITY.NONE || !entry.vulgar)
    && (o.allowVowelOnset || entry.onset.length > 0)
    && entry.word.length >= p.minLetters && entry.word.length <= p.maxLetters
    && entry.syllables >= p.minSyllables && entry.syllables <= p.maxSyllables;
}

/** Alle zulässigen Schreibweisen für onset+rime, häufigste zuerst. */
function spellings(index, rime, onset, o, slot) {
  const bucket = index.byRime.get(rime)?.get(onset);
  if (!bucket) return [];
  const seen = new Set();
  const out = [];
  for (const e of bucket) {
    if (!ok(e, o, slot) || seen.has(e.word)) continue;
    seen.add(e.word);
    out.push(e);
  }
  return out;
}

/** Das Wort, das für onset+rime angezeigt würde — oder null. */
const best = (index, rime, onset, o, slot) => spellings(index, rime, onset, o, slot)[0] ?? null;

function describe(index, rime, onset, o, slot, prefer) {
  const list = spellings(index, rime, onset, o, slot);
  const i = prefer ? list.findIndex(x => x.word === prefer) : -1;
  if (i > 0) list.unshift(...list.splice(i, 1));
  const e = list[0];
  return {
    word: e.word,
    vulgar: e.vulgar,
    code: e.code,
    onset: e.onset,
    rime: e.rime,
    ipa: toIPA(e.code),
    // getrennt, damit die Oberfläche den getauschten Anlaut hervorheben kann
    onsetIpa: toIPA(e.onset),
    rimeIpa: toIPA(e.rime).replace(/^ˈ/, ''),
    rank: e.rank,
    homophones: list.slice(1).map(x => x.word),
  };
}

/**
 * Erkennt entartete Treffer wie "cooking looked -> looking cooked": beide Spalten
 * bestehen dann aus denselben Wortstämmen, nur anders flektiert. Das ist formal
 * korrekt, aber als Spoonerismus langweilig.
 */
function sameStem(col1, col2) {
  for (const x of col1) for (const y of col2) {
    const n = Math.min(x.word.length, y.word.length);
    let i = 0;
    while (i < n && x.word[i] === y.word[i]) i++;
    if (i >= 4) return true;
  }
  return false;
}

/** Zufallsindex mit Bias zu kleinen Werten (= häufigeren Wörtern). */
const biased = (n, bias, rnd) => Math.floor(n * Math.pow(rnd(), bias));

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Sucht zu Reim R1 zwei Anlaute, die auch ein zweiter Reim R2 hergibt.
 * @returns {null | {a: string, b: string, rime2: string}}
 */
function findPartner(index, rime1, o, rnd, fixedOnset = null, needVulgar2 = false, tries = 300) {
  const onsets1 = [...(index.byRime.get(rime1)?.keys() ?? [])]
    .filter(on => best(index, rime1, on, o, 0));
  if (onsets1.length < 2) return null;
  // Bei Wortvorgabe steht der Anlaut der ersten Spalte fest.
  const starts = fixedOnset === null ? shuffle(onsets1.slice(), rnd)
    : onsets1.includes(fixedOnset) ? [fixedOnset] : [];

  for (const a of starts) {
    const rimes = index.byOnset.get(a);
    if (!rimes) continue;
    const others = onsets1.filter(on => on !== a);
    for (let t = 0; t < tries; t++) {
      const rime2 = rimes[Math.floor(rnd() * rimes.length)];
      if (rime2 === rime1) continue;
      const wordA2 = best(index, rime2, a, o, 1);
      if (!wordA2) continue;
      for (const b of shuffle(others.slice(), rnd)) {
        const wordB2 = best(index, rime2, b, o, 1);
        if (!wordB2) continue;
        if (needVulgar2 && !wordA2.vulgar && !wordB2.vulgar) continue;
        return { a, b, rime2 };
      }
    }
  }
  return null;
}

/**
 * Erzeugt einen Spoonerismus.
 * @param {ReturnType<typeof buildIndex>} index
 * @param {object} [opts] wie DEFAULTS, zusätzlich `seedWord`
 * @returns {{pairs: [any, any][]} | {error: 'unknown-word' | 'no-match'}}
 */
export function generate(index, opts = {}, rnd = Math.random) {
  const o = withDefaults(opts);
  const wantVulgar = o.vulgarity >= VULGARITY.SOME;

  /** @type {Entry[] | null} Aussprachen des vorgegebenen Startworts */
  let seeds = null;
  if (opts.seedWord?.trim()) {
    const found = index.byWord.get(opts.seedWord.trim().toLowerCase());
    if (!found) return { error: 'unknown-word' };
    // Bei Wortvorgabe zählen Häufigkeit und Länge des Startworts nicht.
    seeds = found.filter(e => o.allowVariants || e.variant === 0);
    if (!seeds.length) seeds = found;
  }

  const scope = seeds
    ? { ...o, maxRank: Math.max(o.maxRank, ...seeds.map(e => e.rank)),
        pairs: [{ ...o.pairs[0], minLetters: 1, maxLetters: 40, minSyllables: 1, maxSyllables: 8 },
                o.pairs[1]] }
    : o;

  // Für die derben Modi wird das Startwort aus dem derben Topf gezogen — blind
  // zu würfeln, bis zufällig ein derbes Wort dabei ist, wäre aussichtslos.
  const pool = !seeds && wantVulgar
    ? index.vulgarEntries.filter(e => ok(e, o, 0))
    : index.entries;
  if (!pool.length) return { error: 'no-match' };

  // Wird aus einem kleinen Topf gezogen, muss das gezogene Wort auch vorkommen.
  const pinned = Boolean(seeds) || (wantVulgar && !seeds);
  const attempts = seeds ? seeds.length * 60 : 800;

  const found = [];
  for (let i = 0; i < attempts && found.length < o.shortlist; i++) {
    // Im derben Topf (wenige hundert Wörter) wird gleichverteilt gezogen,
    // sonst käme fast immer "hell" heraus.
    const seed = seeds ? seeds[i % seeds.length]
      : pool[biased(pool.length, pool === index.entries ? o.bias : 1, rnd)];
    if (!seeds && !ok(seed, o, 0)) continue;

    const hit = findPartner(index, seed.rime, scope, rnd, pinned ? seed.onset : null,
      o.vulgarity === VULGARITY.MOST);
    if (!hit) continue;

    const A = describe(index, seed.rime, hit.a, scope, 0, pinned ? seed.word : null);
    const B = describe(index, seed.rime, hit.b, scope, 0);
    const C = describe(index, hit.rime2, hit.b, scope, 1);
    const D = describe(index, hit.rime2, hit.a, scope, 1);
    if (new Set([A.word, B.word, C.word, D.word]).size < 4) continue;
    if (sameStem([A, B], [C, D])) continue;

    const vulgar = [A, B, C, D].filter(x => x.vulgar).length;
    if (o.vulgarity === VULGARITY.SOME && !vulgar) continue;
    if (o.vulgarity === VULGARITY.MOST && !((A.vulgar || B.vulgar) && (C.vulgar || D.vulgar))) continue;

    found.push({
      pairs: [[A, C], [B, D]],
      // Das seltenste der vier Wörter bestimmt, wie natürlich das Ergebnis wirkt;
      // in den derben Modi zählt zuerst, wie viele Wörter derb sind.
      score: (wantVulgar ? -vulgar * 1e6 : 0) + Math.max(A.rank, B.rank, C.rank, D.rank),
    });
  }

  if (!found.length) return { error: 'no-match' };
  found.sort((x, y) => x.score - y.score);
  const pairs = found[0].pairs;
  // Ohne Wortvorgabe darf das Ergebnis frei gespiegelt werden — beide
  // Spiegelungen sind wieder gültige Spoonerismen und verteilen das
  // aus dem Topf gezogene Wort über alle vier Positionen.
  if (!seeds) {
    if (rnd() < 0.5) pairs.reverse();
    if (rnd() < 0.5) for (const row of pairs) row.reverse();
  }
  return { pairs };
}

/**
 * Baut den Spoonerismus zu einer gegebenen ersten Zeile nach — für geteilte
 * Links. Probiert alle Aussprachen beider Wörter, die erste passende gewinnt.
 * @returns {{pairs: [any, any][]} | {error: 'unknown-word' | 'no-match'}}
 */
export function fromLine(index, first, second, opts = {}) {
  const o = { ...withDefaults(opts), maxRank: Infinity, allowVariants: true,
    vulgarity: VULGARITY.ANY, allowVowelOnset: true };
  o.pairs = [0, 1].map(() => ({ minLetters: 1, maxLetters: 40, minSyllables: 1, maxSyllables: 8 }));
  const as = index.byWord.get(first), cs = index.byWord.get(second);
  if (!as || !cs) return { error: 'unknown-word' };
  for (const a of as) {
    for (const c of cs) {
      if (a.onset === c.onset) continue;
      if (!best(index, a.rime, c.onset, o, 0) || !best(index, c.rime, a.onset, o, 1)) continue;
      return { pairs: [
        [describe(index, a.rime, a.onset, o, 0, first), describe(index, c.rime, c.onset, o, 1, second)],
        [describe(index, a.rime, c.onset, o, 0), describe(index, c.rime, a.onset, o, 1)],
      ] };
    }
  }
  return { error: 'no-match' };
}

/**
 * Liest data/phrases.txt: Spoonerismen, deren beide Zeilen so tatsächlich
 * gesagt werden (gezählt in Untertiteln, siehe build/build-phrases.mjs).
 * Zeilenformat: wortA  wortC  wortB  wortD  bewertung, die besten zuerst.
 */
export function readPhrases(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const [a, c, b, d, score] = line.split('\t');
    return { words: [a, c, b, d], score: Number(score) };
  });
}

/**
 * Zieht einen Spoonerismus aus der Phrasenliste. Wortschatz, Derbheit und
 * Startwort gelten wie beim freien Würfeln; Längen und Silben nicht — die
 * Liste ist ohnehin kurz.
 * @returns {{pairs: [any, any][]} | {error: 'no-match'}}
 */
export function generatePhrase(index, phrases, opts = {}, rnd = Math.random) {
  const o = withDefaults(opts);
  const seed = opts.seedWord?.trim().toLowerCase();
  const vulgar = w => index.byWord.get(w)?.[0]?.vulgar ?? false;
  const rank = w => index.byWord.get(w)?.[0]?.rank ?? Infinity;

  const pool = phrases.filter(p => {
    if (seed && !p.words.includes(seed)) return false;
    // Das Startwort darf seltener sein als der Regler erlaubt.
    if (p.words.some(w => w !== seed && rank(w) > o.maxRank)) return false;
    const [a, c, b, d] = p.words.map(vulgar);
    if (o.vulgarity === VULGARITY.NONE) return !(a || b || c || d);
    if (o.vulgarity === VULGARITY.SOME) return a || b || c || d;
    if (o.vulgarity === VULGARITY.MOST) return (a || b) && (c || d);
    return true;
  });
  if (!pool.length) return { error: 'no-match' };

  const pick = pool[biased(pool.length, 1.6, rnd)];
  const [a, c] = pick.words;
  const out = fromLine(index, a, c);
  if (out.error) return out;
  // Zeilen dürfen tauschen, Spalten nicht: "tricks magic" sagt niemand.
  if (seed ? !out.pairs[0].some(x => x.word === seed) : rnd() < 0.5) out.pairs.reverse();
  return out;
}
