import { buildIndex, generate, PAIR_DEFAULTS } from './engine.js';
import { faceSlider, stackSlider } from './sliders.js';
import { icon } from './icons.js';
import { voicesReady, say, sayAll, stopSpeaking, mountVoiceControls } from './speak.js';

const $ = sel => document.querySelector(sel);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------ Buchstabenlauf */

/**
 * Zerlegt Text in .letter-Spans. Jeder bekommt seinen Index als --i, damit die
 * Animationen in CSS gestaffelt laufen können, ohne nth-child-Regeln.
 */
function letterize(el, text, offset = 0) {
  el.textContent = '';
  [...text].forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'letter';
    span.style.setProperty('--i', offset + i);
    span.textContent = ch === ' ' ? ' ' : ch;
    el.append(span);
  });
  return el;
}

/* ------------------------------------------------------------------- Titel */

// Der Titel ist selbst ein Spoonerismus. Beim Überfahren wechseln die beiden
// Anlaute die Plätze und machen "Slips of the Tongue" daraus. Die Anlaute sind
// feste Elemente, die zwischen den Wörtern umgehängt werden — nur so können sie
// sichtbar quer durch den Titel wandern.
//
// Die Schreibung des zweiten Reims zieht mit: aus "ung" wird "ongue", weil sich
// Laute und Buchstaben im Englischen nicht decken. Damit daraus kein harter
// Textwechsel wird, steht der Reim in festen Zellen: "n" und "g" bleiben stehen,
// das "u" rollt zum "o" um, und das stumme "ue" klappt hinten auf.

const phrase = document.querySelector('#phrase');
const word1 = phrase.querySelector('[data-word="1"]');
const word2 = phrase.querySelector('[data-word="2"]');
const plain = phrase.querySelector('.plain');

// Eine Zelle hält genau ein Glyphenpaket und behält ihren Platz. Beim
// Umschreiben rollt der alte Inhalt nach oben weg, der neue von unten herein.
function glyphCell(text) {
  const el = document.createElement('span');
  el.className = 'letter';
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = text;
  el.append(glyph);
  return el;
}

const ROLL = { duration: 300, easing: 'cubic-bezier(.22, .9, .28, 1)' };
const ghosts = new Set();
const dropGhosts = () => { for (const g of ghosts) g.remove(); ghosts.clear(); };

function setCell(el, text, animate) {
  const glyph = el.querySelector('.glyph:not(.ghost)');
  if (glyph.textContent === text) return;
  if (!animate) { glyph.textContent = text; return; }

  const next = glyphCell(text).firstChild;
  el.prepend(next);
  glyph.classList.add('ghost');       // aus dem Fluss, damit die Zelle sofort passt
  ghosts.add(glyph);

  glyph.animate([
    { transform: 'none', opacity: 1 },
    { transform: 'perspective(240px) translateY(-.42em) rotateX(84deg)', opacity: 0 },
  ], ROLL).finished.then(() => { glyph.remove(); ghosts.delete(glyph); }, () => {});
  next.animate([
    { transform: 'perspective(240px) translateY(.42em) rotateX(-84deg)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], ROLL);
}

const chunk = (cls, text) => {
  const el = document.createElement('span');
  el.className = cls;
  el.append(...[...text].map(ch => glyphCell(ch)));
  return el;
};

const onsetT = chunk('onset onset-a', 'T');
const onsetSl = chunk('onset onset-b', 'Sl');
const rimeIps = chunk('rime rime-a', 'ips');
const rimeUng = chunk('rime rime-b', 'ung');
rimeUng.append(glyphCell(''));             // Platzhalter für das stumme "ue"

// [Anlaut von Wort 1, Anlaut von Wort 2, Zellen des zweiten Reims]
const PHRASES = [
  [onsetT, onsetSl, ['u', 'n', 'g', '']],       // Tips of the Slung
  [onsetSl, onsetT, ['o', 'n', 'g', 'ue']],     // Slips of the Tongue
];

const parts = [onsetT, onsetSl, rimeIps, rimeUng, plain];
let phraseIndex = 0;

function writePhrase(i, animate = false) {
  const [first, second, spelling] = PHRASES[i];
  word1.replaceChildren(first, rimeIps);
  word2.replaceChildren(second, rimeUng);
  spelling.forEach((text, k) => setCell(rimeUng.children[k], text, animate));
  // Buchstabenindizes in Lesereihenfolge, damit der Einlauf sauber staffelt.
  let n = 0;
  for (const el of [first, rimeIps, second, rimeUng])
    for (const c of el.children) c.style.setProperty('--i', n++);
}

/**
 * Wechselt die Fassung und lässt jeden Baustein von dort losfliegen, wo er
 * gerade steht (FLIP): messen, umbauen, wieder messen, die Differenz als
 * Startpunkt animieren. Gemessen wird bewusst *vor* dem Abbruch der laufenden
 * Flüge — so kehrt ein schnelles Hin und Her mitten in der Bewegung um, statt
 * die alte Strecke erst zu Ende zu spielen.
 */
let flights = [];
function swapPhrase(to) {
  if (to === phraseIndex) return;
  phraseIndex = to;

  const before = parts.map(el => el.getBoundingClientRect());
  for (const a of flights) a.cancel();
  flights = [];
  dropGhosts();

  writePhrase(to, true);
  const after = parts.map(el => el.getBoundingClientRect());

  parts.forEach((el, i) => {
    const dx = before[i].left - after[i].left;
    const dy = before[i].top - after[i].top;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    // Gegenläufige Bögen: der nach rechts wandernde Anlaut fliegt oben herum,
    // der nach links unten herum. So kreuzen sie sich, statt sich zu überlagern.
    const arc = Math.min(Math.abs(dx) * .18, 32) * Math.sign(dx);
    // Die Dauer hängt am wirklich verbleibenden Weg, nicht an der vollen Strecke.
    const duration = 200 + Math.min(dist * .55, 250);
    flights.push(el.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * .5}px, ${dy - arc}px)`, offset: .5 },
      { transform: 'none' },
    ], { duration, easing: 'cubic-bezier(.33, .9, .3, 1)' }));
  });
}

writePhrase(0);
for (const el of document.querySelectorAll('.loading-text [data-text]')) letterize(el, el.dataset.text);

// Der Zeiger fährt über den Titel, der Finger nicht: auf Tastbildschirmen
// meldet ein Tippen erst "pointerenter" und lässt das "pointerleave" bis zum
// nächsten Tippen irgendwo anders aus. Der Wechsel lief so genau einmal. Auf
// Berührung zählt deshalb nur das Tippen selbst, und das schaltet um.
const hovers = e => e.pointerType !== 'touch';
phrase.addEventListener('pointerenter', e => { if (hovers(e)) swapPhrase(1); });
phrase.addEventListener('pointerleave', e => { if (hovers(e)) swapPhrase(0); });
phrase.addEventListener('click', () => swapPhrase(phraseIndex ? 0 : 1));

// Der Einlauf des Titels läuft genau einmal.
document.body.classList.add('intro');
setTimeout(() => document.body.classList.remove('intro'), 1600);

/* -------------------------------------------------------------- Einfachregler */

/** Zwei übereinanderliegende Range-Inputs mit gefülltem Zwischenstück. */
function dualRange(host, { min, max, start, onChange }) {
  const lo = Object.assign(document.createElement('input'), { type: 'range', min, max, step: 1, value: start[0] });
  const hi = Object.assign(document.createElement('input'), { type: 'range', min, max, step: 1, value: start[1] });
  const connect = document.createElement('div');
  connect.className = 'connect';
  host.append(connect, lo, hi);

  const pct = v => ((v - min) / (max - min)) * 100;
  function sync(mover) {
    let a = +lo.value, b = +hi.value;
    if (a > b) {                                  // Griffe nicht kreuzen lassen
      if (mover === lo) hi.value = a = b = Math.max(a, b);
      else lo.value = a = b = Math.min(a, b);
    }
    connect.style.left = pct(a) + '%';
    connect.style.width = (pct(b) - pct(a)) + '%';
    onChange(+lo.value, +hi.value);
  }
  lo.addEventListener('input', () => sync(lo));
  hi.addEventListener('input', () => sync(hi));
  sync(null);
  return { get: () => [+lo.value, +hi.value] };
}

function singleRange(input, onChange) {
  const connect = document.createElement('div');
  connect.className = 'connect';
  input.parentElement.prepend(connect);
  const sync = () => {
    const { min, max, value } = input;
    connect.style.width = ((value - min) / (max - min)) * 100 + '%';
    onChange(+value);
  };
  input.addEventListener('input', sync);
  sync();
}

/* ------------------------------------------------------------------ Optionen */

// Stufen des Wortschatzreglers: Rang, bis zu dem Wörter zugelassen sind.
const VOCABULARY = [3000, 6000, 10000, 20000, 43500];

const vocabulary = stackSlider($('#vocabulary'), {
  title: 'How common the words must be',
  labels: ['3k', '6k', '10k', '20k', 'All'],
  statuses: VOCABULARY.map((n, i) => i === VOCABULARY.length - 1
    ? 'every word in the dictionary'
    : `the ${n.toLocaleString('en')} most frequent words`),
  value: 2,
});

const rudeness = faceSlider($('#rudeness'), {
  title: 'Rude words',
  labels: ['Clean', 'Normal', 'Spicy', 'Filthy'],
  statuses: [
    'Safe for work. No rude words',
    'no filter. Whatever comes up',
    'I do the swear words all the time',
    'How to: Mandatory HR meeting',
  ],
  value: 0,
});

const pairRanges = {};
for (const host of document.querySelectorAll('.range')) {
  const key = host.dataset.target;
  const label = $(`#${key}-value`);
  pairRanges[key] = dualRange(host, {
    min: 2, max: 14, start: [PAIR_DEFAULTS.minLetters, PAIR_DEFAULTS.maxLetters],
    onChange: (a, b) => { label.textContent = `${a}–${b} letters`; },
  });
}
singleRange($('#syllables'), v => {
  $('#syllables-value').textContent = v === 1 ? '1 syllable' : `up to ${v} syllables`;
});

function currentOptions() {
  const maxSyllables = +$('#syllables').value;
  const pair = key => {
    const [minLetters, maxLetters] = pairRanges[key].get();
    return { minLetters, maxLetters, minSyllables: 1, maxSyllables };
  };
  return {
    maxRank: VOCABULARY[vocabulary.get()],
    vulgarity: rudeness.get(),
    allowVowelOnset: $('#vowel-onset').checked,
    allowVariants: $('#variants').checked,
    seedWord: $('#seed').value,
    pairs: [pair('pair1'), pair('pair2')],
  };
}

const moreButton = $('#more-button');
moreButton.addEventListener('click', () => {
  const open = $('#more').classList.toggle('open');
  moreButton.classList.toggle('open', open);
  moreButton.setAttribute('aria-expanded', String(open));
  moreButton.lastChild.textContent = open ? 'Show less' : 'Show more';
});

/* -------------------------------------------------------------------- Daten */

const button = $('#generate');
const result = $('#result');
const actions = $('.actions');
let index = null;
let last = null;

button.classList.add('busy');
try {
  const [words, vulgar] = await Promise.all(
    ['data/words.txt', 'data/vulgar.txt'].map(async url => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.text();
    }));
  index = buildIndex(words, vulgar);
  button.disabled = false;
  button.classList.remove('busy');
  showHint();
} catch (err) {
  button.classList.remove('busy');
  showMessage(`Could not load the word list (${err.message}).`);
}

/* ---------------------------------------------------------------- Darstellung */

/**
 * Eine Wortzelle. `parts` sagt, welcher der beiden Anlaute und welcher der
 * beiden Reime hier steckt — daraus ergibt sich die Einfärbung der Lautschrift:
 * gleicher Lautanteil, gleiche Farbe, über alle vier Wörter hinweg.
 */
function cell(item, parts) {
  const div = document.createElement('div');
  div.className = 'word-cell';

  const spelling = document.createElement('span');
  spelling.className = 'spelling';
  letterize(spelling, item.word);
  div.append(spelling);

  const ipa = document.createElement('span');
  ipa.className = 'ipa';
  ipa.append('/');
  if (item.onsetIpa) {
    const onset = document.createElement('span');
    onset.className = `seg onset-${parts.onset}`;
    onset.textContent = item.onsetIpa;
    ipa.append(onset);
  }
  const rime = document.createElement('span');
  rime.className = `seg rime-${parts.rime}`;
  rime.textContent = item.rimeIpa;
  ipa.append(rime, '/');
  div.append(ipa);

  if (item.homophones?.length) {
    const homo = document.createElement('div');
    homo.className = 'homophones';
    homo.textContent = 'also: ' + item.homophones.join(', ');
    div.append(homo);
  }
  return div;
}

function render(pairs) {
  // Über die vier Wörter verteilen sich genau zwei Anlaute und zwei Reime.
  const all = pairs.flat();
  const onsets = [...new Set(all.map(x => x.onset))];
  const rimes = [...new Set(all.map(x => x.rime))];

  const rows = pairs.map((row, r) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'word-wrapper';
    wrapper.style.setProperty('--row', r);
    for (const item of row) {
      wrapper.append(cell(item, {
        onset: onsets.indexOf(item.onset),
        rime: rimes.indexOf(item.rime),
      }));
    }
    if (speech) {
      // Anklicken spricht genau diese Zeile.
      const text = row.map(x => x.word).join(' ');
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'row-play';
      play.append(icon('play', { size: '23px' }));
      play.setAttribute('aria-label', `Hear "${text}"`);
      play.addEventListener('click', () => say(text));
      wrapper.append(play);
    }
    return wrapper;
  });
  result.replaceChildren(...rows);
}

/** Leerer Ergebnisbereich bekommt einen Hinweis statt Leere. */
function showHint() {
  const p = document.createElement('p');
  p.className = 'message hint';
  p.textContent = 'Press the button. Or shake your phone.';
  result.replaceChildren(p);
}

function showMessage(html) {
  const p = document.createElement('p');
  p.className = 'message';
  p.innerHTML = html;
  result.replaceChildren(p);
  actions.hidden = true;
}

/* ------------------------------------------------------------------ Ablauf */

const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let busy = false;

async function run() {
  if (busy || !index) return;
  busy = true;
  button.disabled = true;
  button.classList.add('busy');
  stopSpeaking();
  $('#seed-hint').classList.remove('error');

  const opts = currentOptions();

  // Das alte Ergebnis fällt heraus, bevor das neue einläuft. Die Suche selbst
  // dauert Bruchteile einer Millisekunde — die Zeit gehört ganz der Animation.
  if (result.querySelector('.word-wrapper')) {
    result.classList.add('leaving');
    await wait(190);
    result.classList.remove('leaving');
  }

  const outcome = generate(index, opts);
  const seed = opts.seedWord.trim();

  if (outcome.error === 'unknown-word') {
    showMessage(`<strong>${escapeHtml(seed)}</strong> is not in the pronunciation dictionary.`);
    $('#seed-hint').classList.add('error');
  } else if (outcome.error) {
    showMessage(seed
      ? `No spoonerism found for <strong>${escapeHtml(seed)}</strong>. Try loosening the options.`
      : 'Nothing found — try loosening the options.');
  } else {
    last = outcome.pairs;
    render(outcome.pairs);
    actions.hidden = false;
  }

  await wait(520);                       // bis der letzte Buchstabe sitzt
  button.classList.remove('busy');
  button.disabled = false;
  button.blur();
  busy = false;
}

const lines = () => last.map(row => row.map(x => x.word).join(' '));

// Gelesen sind die beiden Zeilen verschieden, gesprochen hört man den Tausch.
// Der Knopf erscheint nur, wenn der Browser wirklich eine Stimme hat — unter
// Linux fehlt dafür oft speech-dispatcher. Nicht abwarten: ohne Stimmen läuft
// die Prüfung in einen Zeitablauf, und so lange darf hier nichts stillstehen.
let speech = false;
voicesReady().then(ok => {
  speech = ok;
  if (!ok) return;
  const hear = $('#hear');
  hear.hidden = false;
  hear.addEventListener('click', () => sayAll(lines()));
  mountVoiceControls($('.playback'), () => (last ? lines()[0] : null));
  if (last) render(last);              // Zeilenknöpfe nachrüsten
});

button.addEventListener('click', run);
$('#seed').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

$('#copy').addEventListener('click', async e => {
  await navigator.clipboard.writeText(lines().join('\n'));
  e.target.textContent = 'Copied!';
  setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
});

$('#sentence').addEventListener('click', () => {
  const [a, b] = lines();
  const q = `Write one short, funny saying that uses these four words: ${a} ${b}.`;
  window.open('https://chat.openai.com/?q=' + encodeURIComponent(q), '_blank', 'noopener');
});

/* Schütteln am Telefon löst die Suche aus — wie in der deutschen Fassung. */
window.addEventListener('devicemotion', e => {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  if (Math.abs(a.x) > 20 || Math.abs(a.y) > 20 || Math.abs(a.z) > 20) run();
});
