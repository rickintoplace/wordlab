import { buildIndex } from './engine.js';
import { buildPhraseIndex, readPhrase, findOronyms, pronounce, readBigrams } from './oronyms.js';
import { toIPA } from './phonemes.js';
import { stackSlider, faceSlider, noiseSlider, curveSlider } from './sliders.js';
import { hasApi, voicesReady, say, stopSpeaking, mountVoiceControls } from './speak.js';
import { icon } from './icons.js';

const $ = sel => document.querySelector(sel);

/* ------------------------------------------------------------------- Titel */

// "a nice man" / "an ice man": gleiche Buchstaben, die Lücke wandert um eins.
const LETTERS = ['a', 'n', 'i', 'c', 'e', 'm', 'a', 'n'];
const SPLITS = [[1, 5], [2, 5]];          // Schnittstellen der beiden Lesarten

const words = [1, 2, 3].map(n => $(`#phrase [data-word="${n}"]`));
const letters = LETTERS.map((ch, i) => {
  const el = document.createElement('span');
  el.className = 'letter' + (i === 1 ? ' pivot' : '');
  el.style.setProperty('--i', i);
  el.textContent = ch;
  return el;
});

function writeSplit(k) {
  const [a, b] = SPLITS[k];
  words[0].replaceChildren(...letters.slice(0, a));
  words[1].replaceChildren(...letters.slice(a, b));
  words[2].replaceChildren(...letters.slice(b));
}

let split = 0;
let sliding = false;
function slideTo(k) {
  if (sliding || k === split) return;
  split = k;
  const before = letters.map(el => el.getBoundingClientRect().left);
  writeSplit(k);
  const after = letters.map(el => el.getBoundingClientRect().left);
  let longest = 0;
  letters.forEach((el, i) => {
    const dx = before[i] - after[i];
    if (Math.abs(dx) < 0.5) return;
    const duration = Math.abs(dx) > 20 ? 460 : 300;
    longest = Math.max(longest, duration);
    el.animate([
      { transform: `translateX(${dx}px)` },
      ...(Math.abs(dx) > 20 ? [{ transform: `translateX(${dx * .5}px) translateY(-22px)`, offset: .5 }] : []),
      { transform: 'none' },
    ], { duration, easing: 'cubic-bezier(.65, 0, .35, 1)' });
  });
  sliding = true;
  setTimeout(() => { sliding = false; }, longest);
}

writeSplit(0);
const phraseEl = $('#phrase');
// Der Zeiger fährt über den Titel, der Finger nicht: auf Tastbildschirmen
// meldet ein Tippen erst "pointerenter" und lässt das "pointerleave" bis zum
// nächsten Tippen irgendwo anders aus. Der Wechsel lief so genau einmal. Auf
// Berührung zählt deshalb nur das Tippen selbst, und das schaltet um.
const hovers = e => e.pointerType !== 'touch';
phraseEl.addEventListener('pointerenter', e => { if (hovers(e)) slideTo(1); });
phraseEl.addEventListener('pointerleave', e => { if (hovers(e)) slideTo(0); });
phraseEl.addEventListener('click', () => slideTo(split ? 0 : 1));

document.body.classList.add('intro');
setTimeout(() => document.body.classList.remove('intro'), 1600);

/* ---------------------------------------------------------------- Optionen */

const VOCABULARY = [3000, 8000, 20000, 43500];

const tolerance = noiseSlider($('#tolerance'), {
  title: 'How hard you are listening',
  labels: ['Exact', 'Faint', 'Noisy', 'Loud'],
  statuses: [
    'the very same sounds, nothing swapped',
    'normal distractions',
    'as if across a room',
    'as if at a party',
  ],
  // "Noisy": erst hier ist "recognize speech" / "wreck a nice beach" in
  // Reichweite, und gegen die Messliste schneidet die Stufe am besten ab.
  value: 2,
  onChange: () => run(),
});

const vocabulary = stackSlider($('#vocabulary'), {
  title: 'Words it may hear',
  labels: ['3k', '8k', '20k', 'All'],
  statuses: VOCABULARY.map((n, i) => i === VOCABULARY.length - 1
    ? 'every word in the dictionary'
    : `the ${n.toLocaleString('en')} most frequent words`),
  value: 2,
  onChange: () => run(),
});

// Wie tief in den Wortschatz darf die Bewertung greifen? Gewicht und Sockel
// zusammen bestimmen, wie stark seltene Wörter benachteiligt werden.
const TASTE = [
  { lmWeight: 1.5, lmFloor: 12 },
  { lmWeight: 0.9, lmFloor: 900 },
  { lmWeight: 0.6, lmFloor: 2500 },
  { lmWeight: 0.35, lmFloor: 6000 },
];

const taste = curveSlider($('#taste'), {
  title: 'How ordinary the words must be',
  labels: ['Plain', 'Normal', 'Curious', 'Obscure'],
  statuses: [
    'everyday words only',
    'a taste for the unusual',
    'happy to dig deeper',
    'the long tail is fair game',
  ],
  value: 1,
  onChange: () => run(),
});

const rudeness = faceSlider($('#rudeness'), {
  title: 'Rude readings',
  labels: ['Never', 'Allowed', 'Favoured'],
  statuses: ['rude words are left out', 'taken as they come', 'the filthy reading wins'],
  value: 1,
  onChange: () => run(),
});

/* -------------------------------------------------------------------- Daten */

const notice = $('#notice');
const readings = $('#readings');
const ribbon = $('#ribbon');
const listen = $('#listen');

let index = null;
let lex = null;
let running = false;
let speech = false;        // steht überhaupt eine Stimme zur Verfügung?
let current = null;        // aktuelle Phrase
let picked = null;         // angeklickte Lesart
let lastHits = [];
let extra = null;           // Zusatzlexikon, erst bei Bedarf geladen

const showNotice = (text, kind = '') => {
  notice.textContent = text;
  notice.className = 'message ' + kind;
  notice.hidden = !text;
};

/** Das Zusatzlexikon deckt Namen und seltene Wörter ab — nur für die Eingabe. */
async function loadExtra() {
  if (extra) return extra;
  const res = await fetch('data/lexicon-extra.txt');
  if (!res.ok) return (extra = new Map());
  extra = new Map();
  for (const line of (await res.text()).split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const word = line.slice(0, tab);
    if (!extra.has(word)) extra.set(word, line.slice(tab + 1));
  }
  return extra;
}

const lookup = (word, inPhrase) => pronounce(index, word, inPhrase) ?? extra?.get(word);

/* ----------------------------------------------------------------- Anzeige */

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const gooLayer = ribbon.querySelector('.words-bottom .goo');
const labelLayer = ribbon.querySelector('.words-bottom .labels');
const topLane = ribbon.querySelector('.words-top');
const sourceLane = ribbon.querySelector('.phones.source');
const heardLane = ribbon.querySelector('.phones.heard');

const POOL = 10;                  // so viele Blasen hält die untere Zeile vor
let cells = 0;
let sourceCells = [];
let shown = null;

// Der Goo-Filter wird nicht an- und ausgeschaltet — das ist der Sprung, den man
// sieht. Stattdessen läuft seine Weichzeichnung dauerhaft mit und wird beim
// Wechsel hochgezogen: schnell verschmelzen, langsam wieder lösen.
const gooBlur = document.querySelector('#goo feGaussianBlur');
const GOO_REST = 0.8;
const GOO_FLOW = 6;
const GOO_MS = 700;
let gooRaf = 0;
let gooUntil = 0;

function stirGoo() {
  gooUntil = performance.now() + GOO_MS;
  if (!gooRaf) gooRaf = requestAnimationFrame(tickGoo);
}

function tickGoo(now) {
  const left = gooUntil - now;
  if (left <= 0) {
    gooBlur.setAttribute('stdDeviation', GOO_REST);
    gooRaf = 0;
    return;
  }
  // t: 1 -> 0. Der flache Exponent hält die Weichzeichnung lange oben und
  // lässt sie erst zum Schluss abfallen, damit sich nichts abrupt trennt.
  const t = Math.pow(left / GOO_MS, 0.55);
  gooBlur.setAttribute('stdDeviation', (GOO_REST + (GOO_FLOW - GOO_REST) * t).toFixed(2));
  gooRaf = requestAnimationFrame(tickGoo);
}

// Feste Blasen statt ständigem Neuaufbau: so laufen CSS-Übergänge ineinander,
// wenn man schnell über die Liste fährt, statt jedes Mal neu zu starten.
const pills = Array.from({ length: POOL }, () => {
  const pill = el('span', 'pill');
  const label = el('span', 'label');
  gooLayer.append(pill);
  labelLayer.append(label);
  return { pill, label, block: null };
});

const place = (node, from, to) => {
  node.style.left = `calc(${(from / cells) * 100}% + 2px)`;
  node.style.width = `calc(${((to - from) / cells) * 100}% - 4px)`;
};

/** Obere Zeile und Ausgangslaute hängen nur an der Phrase. */
function drawPhrase(phrase) {
  const sounds = phrase.words.flatMap(w => w.ipaParts);
  cells = sounds.length;
  ribbon.style.setProperty('--cells', cells);

  sourceCells = sounds.map(ch => el('span', 'phone', ch));
  sourceLane.replaceChildren(...sourceCells);
  heardLane.replaceChildren();

  let at = 0;
  topLane.replaceChildren(...phrase.words.map(w => {
    const box = el('span', 'block top', w.word);
    box.style.gridColumn = `${at + 1} / ${at + w.loose.length + 1}`;
    at += w.loose.length;
    return box;
  }));

  for (const slot of pills) {
    slot.block = null;
    slot.pill.className = 'pill';
    slot.label.className = 'label';
    slot.pill.style.opacity = '0';
    slot.label.style.opacity = '0';
  }
  shown = null;
  ribbon.hidden = false;
}

/**
 * Setzt die untere Zeile auf eine Lesart. Die Blasen bleiben dieselben
 * Elemente und bekommen nur neue Maße — dadurch greifen die CSS-Übergänge
 * auch mitten in der Bewegung, ohne Ruckler.
 */
function showReading(reading) {
  if (reading === shown) return;
  shown = reading;
  const blocks = reading?.words ?? [];

  stirGoo();

  pills.forEach((slot, i) => {
    const block = blocks[i];
    const previous = slot.block;

    if (!block) {                                   // Blase wird nicht gebraucht
      if (previous) {                               // in die Mitte einschmelzen
        const middle = (previous.from + previous.to) / 2;
        place(slot.pill, middle, middle);
        slot.pill.style.opacity = '0';
        slot.label.style.opacity = '0';
      }
      slot.block = null;
      return;
    }

    if (!previous) {
      // Neu: als Strich an der Trennstelle beginnen und aufgehen lassen.
      slot.pill.style.transition = 'none';
      place(slot.pill, block.from, block.from);
      slot.pill.style.opacity = '1';
      void slot.pill.offsetWidth;                   // Zwischenstand erzwingen
      slot.pill.style.transition = '';
    }

    place(slot.pill, block.from, block.to);
    place(slot.label, block.from, block.to);
    slot.pill.style.opacity = '1';
    slot.label.style.opacity = '1';
    slot.label.textContent = block.word;
    const tone = block.vulgar ? ' vulgar' : block.cost ? ' altered' : '';
    slot.pill.className = 'pill' + tone;
    slot.label.className = 'label' + tone;
    slot.block = block;
  });

  drawHeard(blocks);
}

/**
 * Die zweite Lautzeile: was man statt der Vorlage hört. Wo sich ein Laut
 * unterscheidet, sind beide Zeilen markiert — damit sichtbar wird, woran der
 * Verhörer hängt, statt nur dass einer da ist.
 */
function drawHeard(blocks) {
  const cellsOut = [];
  for (const cell of sourceCells) cell.classList.remove('changed');

  for (const block of blocks) {
    const span = block.to - block.from;
    const sounds = block.sounds ?? [];

    if (sounds.length === span) {
      sounds.forEach((ch, k) => {
        const at = block.from + k;
        const same = sourceCells[at]?.textContent === ch;
        const node = el('span', 'phone' + (same ? '' : ' changed'), ch);
        node.style.gridColumn = `${at + 1} / ${at + 2}`;
        cellsOut.push(node);
        if (!same) sourceCells[at]?.classList.add('changed');
      });
      continue;
    }

    // Andere Lautzahl: gemeinsamer Anfang und gemeinsames Ende bleiben
    // unmarkiert, damit ein eingefügtes /h/ nicht das ganze Wort einfärbt.
    const limit = Math.min(sounds.length, span);
    let head = 0;
    while (head < limit && sounds[head] === sourceCells[block.from + head]?.textContent) head++;
    let tail = 0;
    while (tail < limit - head
      && sounds[sounds.length - 1 - tail] === sourceCells[block.to - 1 - tail]?.textContent) tail++;

    const group = el('span', 'phone group');
    group.style.gridColumn = `${block.from + 1} / ${block.to + 1}`;
    sounds.forEach((ch, k) => {
      const odd = k >= head && k < sounds.length - tail;
      group.append(el('span', odd ? 'changed' : '', ch));
    });
    cellsOut.push(group);
    for (let k = block.from + head; k < block.to - tail; k++) sourceCells[k]?.classList.add('changed');
    if (block.to - tail <= block.from + head) {
      sourceCells[Math.min(block.to - 1, block.from + head)]?.classList.add('changed');
    }
  }
  heardLane.replaceChildren(...cellsOut);
}

function showMessageOnly(text, kind) {
  ribbon.hidden = true;
  readings.replaceChildren();
  moreReadings.hidden = true;
  $('.playback').hidden = true;
  showNotice(text, kind);
}

/**
 * Wie überzeugend ein Treffer ist — gemessen am Abstand zur besten Lesart.
 * Aus Lautabstand und Wortseltenheit direkt zu rechnen sah willkürlich aus:
 * der erste Treffer konnte blasser stehen als der zehnte. Am Bewertungsabstand
 * ist die Helligkeit dagegen zwangsläufig mit der Reihenfolge einig.
 */
const SPAN = 9;                       // Punkte, über die die Schrift ausbleicht

function strengths(hits) {
  if (!hits.length) return [];
  const best = hits[0].score;
  return hits.map(h => Math.max(1 - (best - h.score) / SPAN, 0.26));
}

// Nur die ersten fünf stehen offen da; der Rest ist ab Platz sechs meist
// Beiwerk und hinter "more" besser aufgehoben.
const VISIBLE = 5;
const moreReadings = $('#more-readings');
moreReadings.addEventListener('click', () => {
  readings.classList.add('expanded');
  moreReadings.hidden = true;
});

function renderReadings(hits) {
  const weights = strengths(hits);
  readings.classList.remove('expanded');
  moreReadings.hidden = hits.length <= VISIBLE;
  moreReadings.textContent = `${hits.length - VISIBLE} more`;
  readings.replaceChildren(...hits.map((h, i) => {
    const li = el('li', 'reading' + (h.resegmented ? '' : ' same-cut') + (i >= VISIBLE ? ' extra' : ''));
    li.style.setProperty('--i', i);
    li.style.setProperty('--strength', weights[i].toFixed(3));
    li.append(el('span', 'reading-text', h.text));

    // Feste Spalte rechts, damit beim Überfahren nichts springt.
    const n = h.changed.size;
    const meta = [];
    if (!h.resegmented) meta.push('same cut');
    if (n) meta.push(`${n} sound${n > 1 ? 's' : ''} off`);
    li.append(el('span', 'reading-meta', meta.join(' · ')));

    // Die Knöpfe sitzen in der Zeile, aber nicht in ihrer Wirkung: ein Klick
    // darauf soll nicht zusätzlich das aus, was ein Klick auf die Zeile tut.
    const acts = el('div', 'reading-actions');
    const act = (name, label, run) => {
      const b = el('button', 'act');
      b.type = 'button';
      b.append(icon(name, { size: '13px' }));
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', e => { e.stopPropagation(); run(b); });
      acts.append(b);
      return b;
    };

    if (speech) act('play', `Hear "${h.text}"`, () => say(h.text));

    act('copy', `Copy "${h.text}"`, async b => {
      try { await navigator.clipboard.writeText(h.text); } catch { return; }
      // Kurz ein Haken statt der Blätter — die einzige Rückmeldung, die es gibt.
      b.replaceChildren(icon('check', { size: '13px' }));
      b.classList.add('done');
      setTimeout(() => {
        b.replaceChildren(icon('copy', { size: '13px' }));
        b.classList.remove('done');
      }, 1100);
    });

    act('arrow-up', `Mishear "${h.text}"`, () => {
      stopSpeaking();
      $('#input').value = h.text;
      run();
    });

    li.append(acts);

    li.addEventListener('pointerenter', () => showReading(h));
    li.addEventListener('click', () => {
      for (const row of readings.children) row.classList.toggle('picked', row === li);
      picked = h;
      showReading(h, true);
      if (speech) say(h.text);          // nur das, was angeklickt wurde
    });
    return li;
  }));
}

/* ------------------------------------------------------------------ Beispiele */

// Vorlagen, die wirklich etwas hergeben — dieselben, gegen die die Bewertung
// eingestellt ist (tools/tune-oronyms.mjs).
const EXAMPLES = [
  'kiss the sky', 'ice cream', 'four candles', 'why choose', 'a nice man',
  'ice bank mice elf', 'iced ink', 'used ink', 'nitrate', 'illegal', 'attacks', 'mishear it',
  'the good can decay many ways', 'gray tape', 'some others',
  'myself', 'isle of man', 'stuff he knows', 'decadent', 'an aim',
  'recognize speech', 'that stuff', 'an ice cold shower', 'known ocean', 'europe',
];

// Sechs zufällige Vorlagen — bei jedem Seitenaufruf andere, damit man nicht
// immer dieselben sieht.
const shown6 = [...EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 6);
$('.examples').replaceChildren(...shown6.map(text => {
  const chip = el('button', 'chip', text);
  chip.type = 'button';
  chip.addEventListener('click', () => { $('#input').value = text; run(); });
  return chip;
}));

/* --------------------------------------------------------------- Adresse */

// Die Phrase und alle Regler, die nicht auf der Voreinstellung stehen, landen
// in der Adresse — so lässt sich jeder Fund als Link weitergeben.
const SETTINGS = { t: tolerance, v: vocabulary, o: taste, r: rudeness };
const DEFAULT_SETTINGS = Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.get()]));

const params = new URLSearchParams(location.search);
const fromLink = params.get('q')?.trim() || null;
for (const [key, slider] of Object.entries(SETTINGS)) {
  const value = Number(params.get(key));
  if (params.has(key) && Number.isInteger(value)) slider.set(value);
}

function remember(text) {
  const next = new URLSearchParams({ q: text });
  for (const [key, slider] of Object.entries(SETTINGS)) {
    if (slider.get() !== DEFAULT_SETTINGS[key]) next.set(key, slider.get());
  }
  history.replaceState(null, '', `${location.pathname}?${next.toString().replace(/%20/g, '+')}`);
}

/* ------------------------------------------------------------- Platzhalter */

// Beim ersten Aufruf bleibt die Seite leer, damit einen nichts erschlägt. Der
// Platzhalter tippt stattdessen Beispiele vor, und der Knopf nimmt bei leerem
// Feld genau das, was gerade dasteht.
const ghost = (() => {
  const input = $('#input');
  const base = input.placeholder;
  const order = [...EXAMPLES].sort(() => Math.random() - 0.5);
  let timer = 0;
  let stopped = false;
  const api = { current: null, stop() { stopped = true; clearTimeout(timer); input.placeholder = base; api.current = null; } };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return api;

  let k = 0;
  const step = (text, shown, dir) => {
    if (stopped) return;
    if (dir > 0 && shown === text.length) { timer = setTimeout(() => step(text, shown, -1), 2200); return; }
    if (dir < 0 && shown === 0) { k++; timer = setTimeout(next, 350); return; }
    shown += dir;
    input.placeholder = text.slice(0, shown) || base;
    api.current = shown === text.length ? text : null;
    timer = setTimeout(() => step(text, shown, dir), dir > 0 ? 70 : 30);
  };
  const next = () => step(order[k % order.length], 0, 1);
  timer = setTimeout(next, 1400);
  input.addEventListener('focus', () => { if (!input.value) input.placeholder = 'type a phrase'; });
  return api;
})();

/* ------------------------------------------------------------------ Ablauf */

async function run() {
  if (!index || running) return;
  running = true;
  listen.disabled = true;
  listen.classList.add('busy');
  stopSpeaking();

  // Leeres Feld: dann das Beispiel, das der Platzhalter gerade zeigt.
  if (!$('#input').value.trim()) {
    $('#input').value = ghost.current ?? EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];
  }
  ghost.stop();
  const text = $('#input').value.trim();
  let phrase = readPhrase(text, lookup);

  // Unbekanntes Wort? Dann das große Lexikon nachladen und noch einmal.
  if (phrase.unknown.length) {
    await loadExtra();
    phrase = readPhrase(text, lookup);
  }

  listen.disabled = false;
  listen.classList.remove('busy');
  running = false;

  if (!phrase.words.length) {
    showMessageOnly(text ? `Not a word I know: ${phrase.unknown.join(', ')}` : '', text ? 'error' : '');
    return;
  }
  showNotice(phrase.unknown.length
    ? `Skipped (not in the dictionary): ${phrase.unknown.join(', ')}` : '');

  // IPA je Laut, damit das Band eine Zelle pro Laut bekommt.
  for (const w of phrase.words) w.ipaParts = [...w.loose].map(ch => toIPA(ch));

  const hits = findOronyms(phrase, lex, {
    tolerance: tolerance.get(),
    maxRank: VOCABULARY[vocabulary.get()],
    vulgarity: rudeness.get(),
    ...TASTE[taste.get()],
    // Längere Phrasen haben mehr Zerlegungen; eine feste Zwölf zeigt davon
    // zu wenig, um die durchgehend umgeschnittenen Lesarten zu erwischen.
    limit: Math.min(20, 9 + phrase.words.length * 2),
  });

  remember(text);
  current = phrase;
  picked = hits[0] ?? null;
  drawPhrase(phrase);
  showReading(picked);
  lastHits = hits;
  renderReadings(hits);

  if (!hits.length) showNotice('No other way to cut this one. Try more slack, or a longer phrase.');
}

$('#ask').addEventListener('submit', e => { e.preventDefault(); run(); });

/* ------------------------------------------------------------------- Start */

listen.disabled = true;
listen.classList.add('busy');
showNotice('Reading dictionaries…');
try {
  const [w, v, b] = await Promise.all(['data/words.txt', 'data/vulgar.txt', 'data/bigrams.txt'].map(async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  }));
  index = buildIndex(w, v);
  lex = buildPhraseIndex(index);
  lex.bigrams = readBigrams(b, index);
  listen.disabled = false;
  listen.classList.remove('busy');
  showNotice('');

  // Ein geteilter Link bringt seine Phrase mit.
  if (fromLink) {
    $('#input').value = fromLink;
    ghost.stop();
    run();
  }


  // Unter Linux liefert speechSynthesis ohne speech-dispatcher keine einzige
  // Stimme und schweigt stumm — das sagen wir lieber, als nichts zu tun. Die
  // Prüfung läuft nebenher, weil sie im Fehlerfall in einen Zeitablauf läuft.
  voicesReady().then(ok => {
    speech = ok;
    if (ok) {
      renderReadings(lastHits);           // Abspielknöpfe nachrüsten
      mountVoiceControls($('.playback'), () => picked?.text ?? current?.words.map(w => w.word).join(' '));
      return;
    }
    const note = document.createElement('p');
    note.className = 'speech-note';
    note.innerHTML = hasApi
      ? 'No speech voices in this browser. <span>On Linux the voices come from '
        + '<code>speech-dispatcher</code>; install it together with <code>espeak-ng</code> '
        + 'and restart the browser. Chrome sometimes needs a second reload.</span>'
      : 'This browser has no speech synthesis, so the readings cannot be played.';
    $('.playback').after(note);
  });
} catch (err) {
  listen.classList.remove('busy');
  showNotice(`Could not load the word list (${err.message}).`, 'error');
}
