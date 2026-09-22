// Oronyme: dieselbe Lautkette, anders in Wörter geschnitten.
//
//   ice cream   /aɪskɹim/   I scream
//   a nice man  /ənaɪsmæn/  an ice man
//
// Die Phrase wird zu einer durchgehenden Lautfolge ohne Wortgrenzen; eine
// Strahlsuche schneidet sie auf alle anderen Arten neu, die lauter echte Wörter
// ergeben. Mit steigender Toleranz dürfen dabei einzelne Laute verrutschen —
// die Kosten dafür kommen aus confusion.js.

import { looseCode, expand, toIPA, isStressed, isVowel, encode } from './phonemes.js';
import { NEIGHBOURS, ELIDABLE, contextFactor, elisionFactor,
  clusterTwins, CLUSTER_VOICING, cost, voicingTwin, geminateCost, GEMINATE } from './confusion.js';


const MAX_WORD = 16;      // längste betrachtete Lautfolge eines Wortes

/** Nachschlagetabelle Lautfolge -> Wörter (häufigstes zuerst). */
export function buildPhraseIndex(index) {
  const byLoose = new Map();
  for (const e of index.entries) {
    if (e.code.length > MAX_WORD) continue;
    const key = looseCode(e.code);
    const bucket = byLoose.get(key);
    if (!bucket) byLoose.set(key, [e]);
    else if (!bucket.some(x => x.word === e.word)) bucket.push(e);
  }
  return { byLoose };
}

/**
 * Schwache Formen der Funktionswörter. Das Wörterbuch nennt zuerst die
 * Zitierform — "an" als /æn/, "for" als /fɔɹ/ —, im Satz spricht die aber
 * niemand: da heißt es /ən/ und /fɚ/. Ohne diese Tabelle ist "an ice cold
 * shower" nicht lautgleich mit "a nice cold shower", obwohl es genau das ist.
 * Nur Artikel und Präpositionen: bei Hilfsverben wie "can" lebt manches Oronym
 * gerade von der vollen Form ("the good can decay" / "the good candy came").
 */
const WEAK_FORMS = new Map(Object.entries({
  a: 'AH0', an: 'AH0 N', and: 'AH0 N D', as: 'AH0 Z', at: 'AH0 T',
  for: 'F ER0', from: 'F R AH0 M', of: 'AH0 V', than: 'DH AH0 N',
  the: 'DH AH0', to: 'T AH0',
}).map(([w, arpa]) => [w, encode(arpa.split(' '))]));

/**
 * Aussprache eines Wortes, in einer Phrase mit den schwachen Formen.
 * @returns {string | undefined}
 */
export function pronounce(index, word, inPhrase) {
  if (inPhrase && WEAK_FORMS.has(word)) return WEAK_FORMS.get(word);
  return index.byWord.get(word)?.[0]?.code;
}

/**
 * Zerlegt einen Text in Wörter mit Aussprache.
 * @param {(w: string, inPhrase: boolean) => string | undefined} lookup
 *   liefert die Lautfolge; `inPhrase` heißt, das Wort steht nicht allein
 */
export function readPhrase(text, lookup) {
  const tokens = (text.toLowerCase().match(/[a-z][a-z']*/g) ?? [])
    .map(t => t.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
  const words = [];
  const unknown = [];
  for (const token of tokens) {
    const code = lookup(token, tokens.length > 1);
    if (code) words.push({ word: token, code, loose: looseCode(code) });
    else unknown.push(token);
  }
  return { words, unknown };
}

export const DEFAULTS = {
  maxRank: 20000,
  tolerance: 0,        // 0 = lautgleich, 1..3 = zunehmend verhört
  vulgarity: 1,        // 0 ohne, 1 egal, 2 derbe Lesart bevorzugt
  // Die Bewertung wiegt zwei Dinge gegeneinander: wie plausibel eine Lesart
  // sprachlich ist (Worthäufigkeit) und wie interessant sie als Oronym ist
  // (neue Grenzen, nichts unverändert übernommen). Die Gewichte sind nicht
  // geraten, sondern gegen tools/tune-oronyms.mjs eingestellt.
  lmWeight: 0.9,       // Gewicht der Häufigkeit
  lmFloor: 900,        // ab wo Häufigkeit aufhört, einen Vorteil zu bringen
  wordPenalty: 1.2,    // bremst das Zerbröseln in lauter Kurzwörter
  cutBonus: 2.0,       // belohnt jede Wortgrenze an neuer Stelle
  carryPenalty: 1.0,   // je Laut, den ein unverändert übernommenes Wort abdeckt
  spanPenalty: 0.5,    // Anteil davon für ein anderes Wort an derselben Stelle
  perPattern: 2,       // höchstens so viele Lesarten je Schnittmuster
  exactBonus: 4.0,     // wirklich lautgleich zu sein ist das Versprechen der Seite
  voicingBonus: 4.0,   // und gleich danach: nur die Stimmhaftigkeit ist anders
  stressPenalty: 1.8,  // je Silbe, die anders betont werden müsste
  fillerPenalty: 2.6,  // je Interjektion in der Lesart
  headStart: 3,        // so viele beste Treffer stehen vor dem Rundlauf
  pairWeight: 0.85,    // Gewicht der Wortpaare (nur mit geladenen Bigrammen)
  pairClamp: 6,        // weiter reicht ein einzelnes Paar nicht
  pairFloor: 0,        // und so weit nach unten: Ungewöhnliches wird nicht bestraft
  pairSeen: 1.5,       // Zuschlag für ein Paar, das überhaupt vorkommt
  beam: 0,             // Pfade je Position; 0 = nach Kettenlänge gestaffelt
  limit: 12,
};

// Wie stark Lautabweichungen bestraft werden und was insgesamt erlaubt ist.
// Die Strafe wächst quadratisch mit den Lautkosten. Linear ginge nicht auf: hart
// genug, um eine 2,3er-Vertauschung zu erdrücken, wäre auch hart genug, um die
// 0,6er-Verschiebung zu erdrücken, an der "the sky" / "this guy" hängt. So ist
// ein kaum hörbarer Versprecher fast gratis und ein grober ruinös.
const TOLERANCE = [
  { maxStep: 0,   budget: 0,   lambda: 0 },
  { maxStep: 0.9, budget: 1.2, lambda: 3.0 },
  { maxStep: 1.6, budget: 2.8, lambda: 2.0 },
  // Nur ganz oben: zwei verrutschte Laute im selben Wort. "mishear it" wird zu
  // "miss see rid" erst, wenn in "see" gleich zwei Laute anders gehört werden.
  { maxStep: 2.2, budget: 5.0, lambda: 1.4, pairStep: 1.9, pairBudget: 3.0 },
];

/**
 * Interjektionen sind in Untertiteln maßlos überrepräsentiert — "huh", "duh"
 * und "uh" stehen dort häufiger als die meisten Inhaltswörter. Als Lesart sind
 * sie fast immer Füllsel ("her duh" statt "hurt"), deshalb ein Aufschlag.
 * Nicht ausgeschlossen: manchmal sind sie genau richtig.
 */
const FILLERS = new Set(`
ah aha aw aww duh eh er erm ew gee ha hah haha heh hey hm hmm hoo huh ick meh
mhm mm mmm nah oh oho ooh oops ow phew psst sh shh tsk ugh uh uhh um umm whoa
whew wow yay yeah yep yikes yup
`.trim().split(/\s+/));

const CARRY_REF = 12;      // Bezugslänge für den Aufschlag auf übernommene Wörter
const PAIR_FANOUT = 4;     // nur die billigsten Alternativen paarweise kombinieren
const PAIR_MAX_LEN = 7;    // und nur in überschaubar langen Wörtern

/**
 * Alle Wörter, die für die Lautfolge `t` in Frage kommen.
 * @returns {{entry: object, cost: number}[]}
 */
function candidates(phones, i, j, lex, tol, ok) {
  const t = phones.slice(i, j);
  const out = new Map();
  // `at` ist die Stelle in der Gesamtkette, an der etwas anders gehört wurde.
  const add = (key, cost, at = -1) => {
    const bucket = lex.byLoose.get(key);
    if (!bucket) return;
    for (const e of bucket) {
      if (!ok(e)) continue;
      const seen = out.get(e.word);
      if (!seen || cost < seen.cost) out.set(e.word, { entry: e, cost, at });
    }
  };

  add(t, 0);
  if (tol.maxStep <= 0) return [...out.values()];

  for (let p = 0; p < t.length; p++) {
    // ein Laut anders gehört — die Nachbarlaute aus der ganzen Kette zählen mit
    const prev = phones[i + p - 1];
    const next = phones[i + p + 1];
    for (const n of NEIGHBOURS.get(t[p]) ?? []) {
      const c = n.cost * contextFactor(prev, next, t[p], n.ch, p === t.length - 1);
      if (c > tol.maxStep) continue;
      add(t.slice(0, p) + n.ch + t.slice(p + 1), c, i + p);
    }
    // ein Laut überhört
    const base = ELIDABLE.get(t[p]);
    if (base !== undefined) {
      const drop = base * elisionFactor(prev, next, t[p]);
      if (drop <= tol.maxStep) add(t.slice(0, p) + t.slice(p + 1), drop, i + p);
    }
    // ein Doppelkonsonant als einfacher gehört
    const merge = Math.min(geminateCost(t[p], prev) ?? 9, geminateCost(t[p], next) ?? 9);
    if (merge <= tol.maxStep) add(t.slice(0, p) + t.slice(p + 1), merge, i + p);
  }
  // Ein Geräuschlautcluster kippt in der Stimmhaftigkeit als Ganzes: /zd/ als
  // /st/ zu hören ist ein Hörfehler und nicht zwei. Das Paar wird deshalb
  // zusammen bepreist und gilt überall dort, wo auch ein einzelner Laut
  // verrutschen darf — sonst bliebe "used ink" / "you stink" der obersten
  // Stufe vorbehalten, obwohl es näher liegt als jede Vokalverschiebung.
  for (let p = 0; p + 1 < t.length; p++) {
    const twins = clusterTwins(t[p], t[p + 1]);
    if (!twins) continue;
    const [x, y] = twins;
    const single = (q, from, to) =>
      cost(from, to) * contextFactor(phones[i + q - 1], phones[i + q + 1], from, to, q === t.length - 1);
    const c = (single(p, t[p], x) + single(p + 1, t[p + 1], y)) * CLUSTER_VOICING;
    if (c <= tol.maxStep) add(t.slice(0, p) + x + y + t.slice(p + 2), c, i + p);
  }

  // ein Laut zuviel gehört
  for (let p = 0; p <= t.length; p++) {
    for (const [ch, c] of ELIDABLE) {
      if (c <= tol.maxStep) add(t.slice(0, p) + ch + t.slice(p), c, i + Math.min(p, t.length - 1));
    }
    // und ein einfacher Konsonant als doppelter: das /m/ in "some others"
    // gehört dann zu beiden Wörtern.
    // gehört. Nur am Wortrand: im Wortinneren kennt das Englische keine
    // Doppelkonsonanten.
    const edge = p === 0 ? phones[i - 1] : p === t.length ? phones[j] : undefined;
    if (GEMINATE <= tol.maxStep && edge !== undefined && !isVowel(edge)) {
      add(t.slice(0, p) + edge + t.slice(p), GEMINATE, i + Math.min(p, t.length - 1));
    }
  }

  // zwei Laute anders gehört — teuer zu suchen, deshalb nur auf der obersten
  // Stufe, nur in kurzen Wörtern und nur mit den billigsten Alternativen.
  if (tol.pairStep && t.length <= PAIR_MAX_LEN) {
    const options = p => (NEIGHBOURS.get(t[p]) ?? [])
      .map(n => ({ ch: n.ch,
        cost: n.cost * contextFactor(phones[i + p - 1], phones[i + p + 1], t[p], n.ch, p === t.length - 1) }))
      .filter(n => n.cost <= tol.pairStep)
      .sort((a, b) => a.cost - b.cost)
      .slice(0, PAIR_FANOUT);

    for (let p = 0; p < t.length; p++) {
      const first = options(p);
      if (!first.length) continue;
      for (let q = p + 1; q < t.length; q++) {
        for (const a of first) {
          for (const b of options(q)) {
            const total = a.cost + b.cost;
            if (total > tol.pairBudget) continue;
            add(t.slice(0, p) + a.ch + t.slice(p + 1, q) + b.ch + t.slice(q + 1), total, i + p);
          }
        }
      }
    }
  }
  return [...out.values()];
}

/**
 * Wortpaare aus gesprochener Sprache (data/bigrams.txt, gezählt in 40 Mio.
 * Untertitelzeilen). Lautlich sind "wreck a nice beach" und "reckon eyes beach"
 * gleich weit von "recognize speech" entfernt — aber nur das eine sagt jemand.
 * Das Format steht in build/build-bigrams.mjs.
 */
export function readBigrams(text, index) {
  const lines = text.split('\n');
  const [total, min] = lines[0].split(' ').map(Number);
  const unigram = Float64Array.from(lines[1].split(' '), s => parseInt(s, 36));
  const rows = lines.slice(2, 2 + unigram.length + 1);
  const offsets = new Uint32Array(rows.length + 1);
  let pairs = 0;
  rows.forEach((row, r) => {
    for (let k = 0; k < row.length; k++) if (row.charCodeAt(k) >= 65 && row.charCodeAt(k) <= 90) pairs++;
    offsets[r + 1] = pairs;
  });
  const next = new Uint16Array(pairs);
  const logCount = new Uint8Array(pairs);
  let at = 0;
  for (const row of rows) {
    let id = 0, digits = '';
    for (const ch of row) {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        id += parseInt(digits, 36);
        next[at] = id;
        logCount[at++] = code - 65;
        digits = '';
      } else digits += ch;
    }
  }
  // Wort-IDs sind die Reihenfolge in words.txt — dieselbe wie in index.byWord.
  const ids = new Map();
  for (const word of index.byWord.keys()) ids.set(word, ids.size);
  for (const e of index.entries) e.wid = ids.get(e.word);
  let sum = 0;
  for (const n of unigram) sum += n;
  return { total, min, unigram, sum, offsets, next, logCount };
}

const SMOOTHING = 100;     // so viele Pseudo-Vorkommen stehen hinter jeder Schätzung

/**
 * Wie viel wahrscheinlicher `id` nach `prev` ist als irgendwo sonst — die
 * punktweise Transinformation, geglättet: bei seltenen Vorgängern weiß man
 * wenig und bleibt nahe 0. `prev` = -1 heißt Satzanfang.
 *
 * Dazu kommt `seenBonus`, wenn das Paar überhaupt belegt ist: "wreck a" ist
 * seltener, als die Einzelwörter erwarten lassen, aber es kommt vor — "reckon
 * eyes" nicht.
 *
 * Paare unter der Schwelle fehlen in der Datei. Ob eins fehlt, weil es nie
 * vorkommt, oder weil beide Wörter zu selten sind, um es zu erwarten, sagt die
 * erwartete Anzahl: liegt sie unter der Schwelle, ist das Fehlen kein Beleg.
 */
export function association(bg, prev, id, seenBonus = 0) {
  if (id === undefined || prev === undefined) return 0;
  let lo = bg.offsets[prev + 1], hi = bg.offsets[prev + 2];
  let count = -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = bg.next[mid];
    if (v === id) { count = 2 ** bg.logCount[mid]; break; }
    if (v < id) lo = mid + 1; else hi = mid;
  }
  const before = prev < 0 ? bg.total : bg.unigram[prev];
  const p = (bg.unigram[id] + 1) / bg.sum;
  const seen = count >= 0;
  if (!seen) {
    const expected = before * p;
    count = expected < bg.min ? expected : bg.min / 2;
  }
  return Math.log((count + SMOOTHING * p) / (before + SMOOTHING)) - Math.log(p) + (seen ? seenBonus : 0);
}

/**
 * Häufige Wörter sind plausiblere Verhörer als seltene. Der Sockel bestimmt, ab
 * wann das aufhört zu zählen: ohne ihn bekommen Funktionswörter wie "my" einen
 * so großen Vorsprung, dass "my self" jede interessantere Lesart erschlägt.
 */
const logp = (entry, floor) => -Math.log(entry.rank + floor);

/**
 * Positionen in der Lautkette, an denen die Lesart abweicht. Bei ungleicher
 * Lautzahl werden gemeinsamer Anfang und gemeinsames Ende abgezogen — sonst
 * gilt ein eingefügtes /h/ als "sechs Laute anders", weil der Rest sich
 * verschiebt.
 */
function diff(parts, phones) {
  const out = new Set();
  for (const p of parts) {
    const from = p.prev.at, to = p.at;
    const code = looseCode(p.entry.code);
    if (code.length === to - from) {
      for (let k = 0; k < code.length; k++) {
        if (code[k] !== phones[from + k]) out.add(from + k);
      }
      continue;
    }
    const limit = Math.min(code.length, to - from);
    let head = 0;
    while (head < limit && code[head] === phones[from + head]) head++;
    let tail = 0;
    while (tail < limit - head && code[code.length - 1 - tail] === phones[to - 1 - tail]) tail++;
    for (let k = from + head; k < to - tail; k++) out.add(k);
    if (to - tail <= from + head) out.add(Math.min(to - 1, from + head));
  }
  return out;
}

function collect(state) {
  const parts = [];
  for (let s = state; s.entry; s = s.prev) parts.push(s);
  return parts.reverse();
}

/**
 * Sucht andere Lesarten derselben Lautkette.
 * @param {{words: {word: string, loose: string}[]}} phrase aus readPhrase()
 */
export function findOronyms(phrase, lex, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const tol = { ...TOLERANCE[Math.max(0, Math.min(TOLERANCE.length - 1, o.tolerance))] };
  // Für Messungen überschreibbar.
  for (const key of ['maxStep', 'budget', 'lambda', 'pairStep', 'pairBudget']) {
    if (o[key] !== undefined) tol[key] = o[key];
  }
  const phones = phrase.words.map(w => w.loose).join('');
  // Dieselbe Kette mit Betonung. Der Index ist betonungsfrei, damit sich
  // Betonungsverschiebungen überhaupt finden lassen — aber umsonst sind sie
  // nicht: "thus" für ein unbetontes "the" zu hören verlangt eine Betonung, wo
  // keine war. Ohne diesen Aufschlag gilt so etwas als lautgleich.
  const stressed = phrase.words.map(w => expand(w.code)).join('');
  const n = phones.length;
  if (!n) return [];

  // Nebenaussprachen sind hier ausdrücklich erwünscht: "an" als /ən/ und "for"
  // als /fɚ/ sind genau die reduzierten Formen, über die man sich verhört.
  const ok = e => e.rank <= o.maxRank && (o.vulgarity > 0 || !e.vulgar);

  // Schnittstellen der Vorlage — ein Ergebnis, das genau dort schneidet, hat
  // nur Homophone getauscht und ist weniger interessant.
  const original = new Set();
  let at = 0;
  for (const w of phrase.words) original.add(at += w.loose.length);

  const sourceWords = new Set(phrase.words.map(w => w.word));
  // Wortspannen der Vorlage — bei einem einzelnen Wort ist das Ersetzen an
  // derselben Stelle ("heard" -> "hurt") gerade der Treffer.
  const sourceSpans = new Set();
  if (phrase.words.length > 1) {
    let from = 0;
    for (const w of phrase.words) { sourceSpans.add(from * 4096 + from + w.loose.length); from += w.loose.length; }
  }
  // Je länger die Kette, desto mehr Pfade konkurrieren um dieselbe Position —
  // mit fester Breite fällt bei langen Sätzen genau der interessante Pfad
  // heraus, bevor er sich auszahlt ("the stuff he knows" überlebt sonst nicht
  // bis ans Ende).
  const beam = o.beam || Math.min(800, Math.max(60, n * 30));

  const bigrams = lex.bigrams ?? null;
  const beams = Array.from({ length: n + 1 }, () => []);
  beams[0] = [{ score: 0, cost: 0, shifts: 0, count: 0, entry: null, prev: null, at: 0 }];

  for (let i = 0; i < n; i++) {
    if (!beams[i].length) continue;
    beams[i].sort((a, b) => b.score - a.score);
    beams[i].length = Math.min(beams[i].length, beam);

    for (let j = i + 1; j <= Math.min(n, i + MAX_WORD); j++) {
      const hits = candidates(phones, i, j, lex, tol, ok);
      if (!hits.length) continue;
      // Eine Grenze an neuer Stelle ist der eigentliche Zweck — das muss schon
      // während der Suche zählen, sonst wirft der Strahl die tief umgeschnittenen
      // Pfade weg, bevor sie sich auszahlen können.
      const bonus = original.has(j) ? 0 : o.cutBonus;
      for (const { entry, cost, at } of hits) {
        // Ein Wort, das schon in der Vorlage stand, ist kein Verhörer.
        // Ein übernommenes Wort ist kein Verhörer — und je mehr von der Phrase
        // es abdeckt, desto weniger ist überhaupt passiert. "us punk myself"
        // lässt die halbe Kette stehen, "ice bank mice elf" nichts.
        // Auf die Kettenlänge bezogen: sonst wächst der Aufschlag mit der
        // Satzlänge ins Absurde und zwingt lange Eingaben dazu, auch den Teil
        // umzudeuten, der offensichtlich stehen bleiben soll.
        // Ein anderes Wort genau an der Stelle eines Vorlagenworts ("case"
        // für "kiss") verschiebt keine Grenze: halb so schlimm wie ein
        // übernommenes Wort, aber kein Grund, das Original zu verdrängen.
        const kept = sourceWords.has(entry.word) ? 1
          : sourceSpans.has(i * 4096 + j) ? o.spanPenalty : 0;
        const carry = o.carryPenalty * kept * (j - i) * Math.min(CARRY_REF / n, 1)
          + (FILLERS.has(entry.word) ? o.fillerPenalty : 0);
        let shifts = 0;
        const spelled = expand(entry.code);
        if (spelled.length === j - i) {
          for (let k = 0; k < spelled.length; k++) {
            if (isStressed(spelled[k]) !== isStressed(stressed[i + k])) shifts++;
          }
        }
        const own = o.lmWeight * logp(entry, o.lmFloor)
          - tol.lambda * cost * cost - o.wordPenalty - carry
          - o.stressPenalty * shifts + bonus;
        for (const state of beams[i]) {
          const total = state.cost + cost;
          if (total > tol.budget) continue;
          const pair = bigrams && o.pairWeight
            ? o.pairWeight * Math.max(-o.pairFloor, Math.min(o.pairClamp,
              association(bigrams, state.entry ? state.entry.wid : -1, entry.wid, o.pairSeen)))
            : 0;
          beams[j].push({
            score: state.score + own + pair,
            cost: total,
            shifts: state.shifts + shifts,
            count: state.count + 1,
            step: cost,
            changedAt: at,
            entry, prev: state, at: j,
          });
        }
      }
    }
  }

  const source = phrase.words.map(w => w.word).join(' ');
  const seen = new Set([source]);
  const results = [];

  for (const state of beams[n].sort((a, b) => b.score - a.score)) {
    const parts = collect(state);
    const text = parts.map(p => p.entry.word).join(' ');
    if (seen.has(text)) continue;
    seen.add(text);

    const cuts = parts.slice(0, -1).map(p => p.at);
    // Wenn alle Wörter schon in der Vorlage stehen, ist nichts passiert, was
    // interessant wäre — dann wurde höchstens ein Wort überhört.
    const fresh = parts.some(p => !sourceWords.has(p.entry.word));
    if (!fresh) continue;                    // es ist nichts passiert
    // Nur neue Schnittstellen zählen. Ein bloß überhörtes Wort ("a bit of luck"
    // -> "bit of luck") verschiebt keine Grenze und ist kein Oronym.
    const resegmented = cuts.some(c => !original.has(c));
    const rude = parts.some(p => p.entry.vulgar);

    // Lautgleich ist das Beste, was eine Lesart sein kann; gleich danach kommt
    // eine, in der sich kein Laut anders anhört als sein eigener Stimmzwilling.
    // /zd/ gegen /st/ ist derselbe Mund in derselben Stellung, nur der Kehlkopf
    // schweigt — das sind die besten Verhörer, die keine Homophone mehr sind.
    const heard = parts.map(p => looseCode(p.entry.code)).join('');
    const voicingOnly = state.cost > 0 && heard.length === phones.length
      && [...heard].every((ch, k) => ch === phones[k] || voicingTwin(phones[k]) === ch);
    const tier = state.shifts > 0 ? 0
      : state.cost === 0 ? o.exactBonus
      : voicingOnly ? o.voicingBonus : 0;

    results.push({
      text,
      words: parts.map(p => ({
        word: p.entry.word,
        ipa: toIPA(p.entry.code),
        // Einzellaute, damit die Oberfläche zeigen kann, was sich ändert.
        sounds: [...looseCode(p.entry.code)].map(ch => toIPA(ch)),
        from: p.prev.at,
        to: p.at,
        vulgar: p.entry.vulgar,
        cost: p.step,
      })),
      // Welche Laute anders sind, ergibt der direkte Vergleich — verlässlicher
      // als mitzuschreiben, was der Kandidatengenerator gerade getan hat.
      changed: diff(parts, phones),
      cuts,
      resegmented,
      // "gleicher Schnitt, kein Laut verändert" ist ein Homophon; alles andere
      // ohne neuen Schnitt ist schlicht verhört.
      kind: resegmented ? 'recut' : state.cost > 0 ? 'misheard' : 'homophone',
      rude,
      cost: state.cost,
      // Das seltenste Wort der Lesart — zusammen mit den Lautkosten ergibt das,
      // wie schwach ein Treffer ist.
      rarity: Math.max(...parts.map(p => p.entry.rank)),
      // Der Bonus gilt nur für wirklich lautgleiche Lesarten. Der Index ist
      // betonungsfrei, damit sich Betonungsverschiebungen finden lassen — aber
      // "thus" für ein unbetontes "the" ist eben nicht dasselbe Geräusch, und
      // ohne diese Bedingung kassiert es trotzdem den vollen Bonus.
      score: state.score + tier + (o.vulgarity > 1 && rude ? 4 : 0),
      rank: state.score + tier + (o.vulgarity > 1 && rude ? 4 : 0),
    });
  }

  // Neu geschnittene Lesarten sind der Zweck der Übung. Bloße Wortvertauschungen
  // ("a but of like") sind zwar auch Verhörer, aber sie fluten sonst die Liste —
  // deshalb stehen sie hinten und nur in kleiner Zahl.
  // Nur nach Bewertung. Neue Schnitte sind darin schon belohnt (cutBonus) —
  // sie zusätzlich absolut vorzuziehen hieße, bei einwortigen Eingaben jede
  // Ein-Wort-Lesart nach hinten zu schieben, auch die beste.
  results.sort((a, b) => b.rank - a.rank);

  // Nach Schnittmuster gruppieren und im Rundlauf ausgeben: erst die beste
  // Lesart jeder Zerlegung, dann die zweitbeste jeder Zerlegung, und so weiter.
  // Sonst füllen Varianten derselben Zerlegung ("ice bank my self", "ice punk
  // my self", …) die ganze Liste. Ein Deckel je Muster wäre einfacher, würde
  // aber bei einsilbigen Eingaben — wo es nur ein Muster gibt — die halbe
  // Trefferliste wegwerfen.
  // Der Deckel für "gleicher Schnitt" soll Varianten bremsen, die bei längeren
  // Phrasen die Liste fluten. Bei einem einzelnen Wort gibt es aber gar keine
  // Schnittstelle zu verschieben — dort ist "heard" -> "hurt" der Treffer, um
  // den es geht, und kein Beiwerk.
  const anyRecut = results.some(r => r.resegmented);
  const plainCap = anyRecut && phrase.words.length > 1 ? 3 : o.limit;

  const byPattern = new Map();
  let plain = 0;
  for (const r of results) {
    if (!r.resegmented && ++plain > plainCap) continue;
    const pattern = r.cuts.join(',');
    const bucket = byPattern.get(pattern);
    if (bucket) bucket.push(r); else byPattern.set(pattern, [r]);
  }

  // Die stärksten Treffer stehen trotzdem vorn — Vielfalt weiter unten hilft
  // niemandem, wenn dafür die überzeugendste Lesart auf Platz elf rutscht.
  const out = [];
  const taken = new Set();
  for (const r of results) {
    if (out.length >= o.headStart || out.length >= o.limit) break;
    if (!byPattern.has(r.cuts.join(','))) continue;      // wurde oben aussortiert
    out.push(r);
    taken.add(r);
  }

  const buckets = [...byPattern.values()].map(list => list.filter(r => !taken.has(r)));
  for (let round = 0; out.length < o.limit; round++) {
    let added = false;
    for (const bucket of buckets) {
      if (bucket.length <= round) continue;
      out.push(bucket[round]);
      added = true;
      if (out.length >= o.limit) break;
    }
    if (!added) break;
  }
  return out;
}

/** Die Lautkette der Vorlage, als IPA-Zeichen je Position. */
export function phraseIPA(phrase) {
  return phrase.words.flatMap(w => [...w.loose].map(ch => toIPA(ch)));
}
