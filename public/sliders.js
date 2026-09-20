// Zwei Regler im Stil des cindermate-Projekts (BadTraitsSlider und
// CharacterDepthBooksSlider), hier ohne React: ein Gesicht, das sich mit dem
// Wert verzieht, und ein Bücherstapel, der mitwächst. Darunter jeweils
// anklickbare Wörter.
//
// Gemeinsam ist beiden: ein <input type=range> mit step 0.01, das beim Loslassen
// weich auf den nächsten ganzen Wert rutscht, und eine Füllspur, deren Breite in
// Pixeln gesetzt wird (--fill-px), damit sie exakt unter dem Griff endet.

const easeOutQuart = p => 1 - Math.pow(1 - p, 4);
const SNAP_MS = 380;

/**
 * @param {HTMLElement} host
 * @param {{title: string, labels: string[], value?: number,
 *          onChange?: (v: number) => void,
 *          build: (stage: HTMLElement, card: HTMLElement) =>
 *                 { update: (raw: number, index: number) => string }}} opts
 */
function makeSlider(host, { title, labels, value = 0, onChange, build }) {
  const max = labels.length - 1;
  host.classList.add('slider-card');
  host.innerHTML = `
    <div class="slider-title"></div>
    <div class="slider-stage"></div>
    <div class="slider-status" aria-live="polite"></div>
    <div class="slider-track">
      <input class="slider-input" type="range" min="0" step="0.01">
    </div>
    <div class="slider-labels"></div>`;

  const titleEl = host.querySelector('.slider-title');
  const stage = host.querySelector('.slider-stage');
  const status = host.querySelector('.slider-status');
  const input = host.querySelector('.slider-input');
  const labelsEl = host.querySelector('.slider-labels');

  titleEl.textContent = title;
  input.max = String(max);
  input.value = String(value);
  input.setAttribute('aria-label', title);

  const buttons = labels.map((text, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slider-label';
    b.textContent = text;
    b.addEventListener('click', () => { moveTo(i); onChange?.(i); });
    labelsEl.append(b);
    return b;
  });

  const visual = build(stage, host);

  // Der maßgebliche Wert. `input.value` taugt dafür nicht: während des
  // Einrastens läuft er erst noch zum Ziel, und wer ihn in dem Moment ausliest
  // — etwa ein onChange-Empfänger, der die Suche neu anwirft — bekommt den
  // alten Stand.
  let settled = value;

  /** Die Füllspur endet exakt in der Mitte des Griffs. */
  function setFill(raw) {
    const thumb = parseFloat(getComputedStyle(host).getPropertyValue('--thumb-size')) || 26;
    const w = input.clientWidth || 1;
    const ratio = max ? Math.min(Math.max(raw, 0), max) / max : 0;
    host.style.setProperty('--fill-px', `${thumb / 2 + ratio * (w - thumb)}px`);
  }

  function paint(raw) {
    const i = Math.max(0, Math.min(max, Math.round(raw)));
    setFill(raw);
    status.textContent = visual.update(raw, i) ?? '';
    buttons.forEach((b, k) => b.classList.toggle('active', k === i));
  }

  let animation = 0;
  function moveTo(target) {
    settled = target;
    cancelAnimationFrame(animation);        // eine neue Bewegung sticht die alte
    const start = parseFloat(input.value);
    const t0 = performance.now();
    const step = t => {
      const p = Math.min((t - t0) / SNAP_MS, 1);
      const cur = start + (target - start) * easeOutQuart(p);
      input.value = String(cur);
      paint(cur);
      if (p < 1) animation = requestAnimationFrame(step);
      else { animation = 0; host.classList.remove('dragging'); }
    };
    animation = requestAnimationFrame(step);
  }

  let dragging = false;
  const release = () => {
    if (!dragging) return;
    dragging = false;
    const target = Math.round(parseFloat(input.value));
    moveTo(target);
    onChange?.(target);
  };
  input.addEventListener('pointerdown', () => { dragging = true; host.classList.add('dragging'); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  input.addEventListener('input', () => {
    settled = Math.round(parseFloat(input.value));
    paint(parseFloat(input.value));
  });
  input.addEventListener('change', () => {        // Tastatur
    if (dragging) return;
    const target = Math.round(parseFloat(input.value));
    moveTo(target);
    onChange?.(target);
  });
  window.addEventListener('resize', () => paint(parseFloat(input.value)));

  paint(value);
  return {
    get: () => settled,
    set(v) { settled = v; input.value = String(v); paint(v); },
  };
}

/* ------------------------------------------------------------------ Gesicht */

const FACES = [
  { face: '#eaf6ff', glow: 'rgba(56,189,248,.55)', mouth: 'M15,20 Q35,35 65,20',
    brow: 0, browL: '0deg', browR: '0deg', browY: '0px',
    halo: 1, haloY: '0px', horn: 0, hornY: '40px' },
  { face: '#fde68a', glow: 'rgba(250,204,21,.45)', mouth: 'M15,23 Q35,31 65,23',
    brow: 0, browL: '0deg', browR: '0deg', browY: '0px',
    halo: 0, haloY: '18px', horn: 0, hornY: '40px' },
  { face: '#ff754b', glow: 'rgba(251,146,60,.5)', mouth: 'M15,20 Q35,40 65,15',
    brow: 1, browL: '20deg', browR: '-20deg', browY: '2px',
    halo: 0, haloY: '20px', horn: .55, hornY: '14px' },
  { face: '#ff5f5f', glow: 'rgba(248,113,113,.6)', mouth: 'M10,20 Q35,45 70,20',
    brow: 1, browL: '35deg', browR: '-35deg', browY: '5px',
    halo: 0, haloY: '20px', horn: 1, hornY: '-15px' },
];

/**
 * Derbheitsregler: ein Gesicht vom Heiligenschein bis zu den Hörnern.
 * @param {HTMLElement} host
 * @param {{value?: number, labels: string[], statuses: string[], onChange?: (v: number) => void}} opts
 */
export function faceSlider(host, { value = 0, labels, statuses, onChange, title }) {
  return makeSlider(host, {
    title, labels, value, onChange,
    build(stage, card) {
      card.classList.add('face-card');
      stage.innerHTML = `
        <div class="face-box">
          <div class="face-halo"></div>
          <svg class="face-horn left" viewBox="0 0 30 40" aria-hidden="true">
            <path d="M5,40 Q0,20 25,0 Q15,25 20,40 Z"/>
          </svg>
          <svg class="face-horn right" viewBox="0 0 30 40" aria-hidden="true">
            <path d="M5,40 Q0,20 25,0 Q15,25 20,40 Z"/>
          </svg>
          <div class="face">
            <div class="face-brow left"></div>
            <div class="face-brow right"></div>
            <div class="face-eye left"></div>
            <div class="face-eye right"></div>
            <svg class="face-mouth" viewBox="0 0 80 40" aria-hidden="true"><path d=""/></svg>
          </div>
        </div>`;
      const box = stage.querySelector('.face-box');
      const mouth = stage.querySelector('.face-mouth path');
      return {
        update(raw, i) {
          const s = FACES[i];
          const set = (k, v) => card.style.setProperty(k, String(v));
          set('--face-color', s.face);
          set('--face-glow', s.glow);
          set('--brow-opacity', s.brow);
          set('--brow-y', s.browY);
          set('--brow-angle-l', s.browL);
          set('--brow-angle-r', s.browR);
          set('--halo-opacity', s.halo);
          set('--halo-y', s.haloY);
          set('--horn-opacity', s.horn);
          set('--horn-y', s.hornY);
          // Der Kopf legt sich beim Ziehen in die Kurve.
          box.style.setProperty('--face-tilt', `${(raw - (FACES.length - 1) / 2) * -7}deg`);
          mouth.setAttribute('d', s.mouth);
          return statuses[i];
        },
      };
    },
  });
}

/* ------------------------------------------------------------ Bücherstapel */

const SPINES = ['#4f46e5', '#0891b2', '#059669', '#ca8a04', '#dc2626', '#7c3aed', '#db2777'];
const COUNTS = [0, 1, 4, 8, 12];

/**
 * Wortschatzregler: vom losen Zettel bis zum Bücherhaufen.
 * @param {HTMLElement} host
 * @param {{value?: number, labels: string[], statuses: string[], onChange?: (v: number) => void}} opts
 */
export function stackSlider(host, { value = 0, labels, statuses, onChange, title }) {
  return makeSlider(host, {
    title, labels, value, onChange,
    build(stage, card) {
      card.classList.add('stack-card');
      stage.innerHTML = '<div class="stack-scene"><div class="stack-paper"></div></div>';
      const scene = stage.querySelector('.stack-scene');
      const paper = stage.querySelector('.stack-paper');
      const books = Array.from({ length: 12 }, (_, i) => {
        const b = document.createElement('div');
        b.className = 'stack-book';
        b.style.backgroundColor = SPINES[i % SPINES.length];
        b.style.zIndex = String(i + 1);
        scene.append(b);
        return b;
      });

      return {
        update(raw, i) {
          const count = COUNTS[i];
          // Der Zettel kippt weg, sobald der erste Band erscheint.
          paper.classList.toggle('hidden', raw >= 0.5);
          if (raw < 0.5) {
            paper.style.transform =
              `rotateX(${raw * 60}deg) translateY(${raw * 50}px) scale(${1 - raw})`;
          }
          books.forEach((book, k) => {
            if (k >= count) {
              book.classList.remove('visible');
              book.style.transform = 'scale(1.8) translateY(-150px) rotateX(-20deg)';
              return;
            }
            book.classList.add('visible');
            if (i === COUNTS.length - 1) {          // oberste Stufe: Haufen
              book.style.transform = `translate(${Math.sin(k) * 24}px, ` +
                `${Math.cos(k) * 8 - k * 1.8}px) rotate(${((k * 137.5) % 360) / 10}deg)`;
              return;
            }
            // Deterministisches "Zufalls"-Wackeln, damit nichts flackert.
            const n = (seed, m) => { const r = Math.sin(k * seed + m) * 43758.5453; return (r - Math.floor(r)) * 2 - 1; };
            const n1 = n(12.9898, 0.123), n2 = n(78.233, 4.567);
            book.style.transform =
              `translate(${k * 1.6 + n2 * 6.2}px, ${-(k * 8 + n1 * 1.6)}px) ` +
              `rotateZ(${n1 * 3.5}deg) rotateY(${n2 * 2}deg) rotateX(${12 + n1 * 2.5}deg)`;
          });
          return statuses[i];
        },
      };
    },
  });
}

/* ------------------------------------------------------------------ Rauschen */

/**
 * Toleranzregler: eine Wellenform, die mit jeder Stufe verrauschter wird.
 * @param {HTMLElement} host
 */
export function noiseSlider(host, { value = 0, labels, statuses, onChange, title }) {
  const BARS = 30;
  // Fester "Zufall" je Balken, damit beim Ziehen nichts flackert.
  const jitter = Array.from({ length: BARS }, (_, i) => {
    const r = Math.sin(i * 37.13 + 1.7) * 43758.5453;
    return r - Math.floor(r);
  });

  return makeSlider(host, {
    title, labels, value, onChange,
    build(stage, card) {
      card.classList.add('noise-card');
      stage.innerHTML = '<div class="noise-wave"></div>';
      const wave = stage.querySelector('.noise-wave');
      const bars = Array.from({ length: BARS }, () => {
        const b = document.createElement('span');
        b.className = 'noise-bar';
        wave.append(b);
        return b;
      });
      const max = labels.length - 1;

      return {
        update(raw, i) {
          const t = Math.max(0, Math.min(1, raw / max));
          bars.forEach((bar, k) => {
            const clean = Math.abs(Math.sin((k / BARS) * Math.PI * 3)) * 0.85 + 0.12;
            const height = clean * (1 - t) + jitter[k] * t;
            bar.style.height = (8 + height * 84).toFixed(1) + '%';
          });
          card.style.setProperty('--noise', t.toFixed(3));
          return statuses[i];
        },
      };
    },
  });
}

/* ------------------------------------------------------------- Wortschatztiefe */

/**
 * Wie gewöhnlich sollen die Wörter sein? Gezeigt wird die Häufigkeitskurve des
 * Wortschatzes — links der kleine Kopf aus lauter Alltagswörtern, rechts der
 * lange Schwanz. Der ausgefüllte Teil ist das, was die Bewertung noch gern
 * nimmt.
 */
export function curveSlider(host, { value = 0, labels, statuses, onChange, title }) {
  return makeSlider(host, {
    title, labels, value, onChange,
    build(stage, card) {
      card.classList.add('curve-card');
      stage.innerHTML = `
        <svg class="curve" viewBox="0 0 170 86" aria-hidden="true">
          <use href="#zipf" class="curve-line"/>
          <g class="curve-fill">
            <use href="#zipf" class="curve-area"/>
          </g>
          <line class="curve-mark" y1="2" y2="84"/>
        </svg>`;
      const fill = stage.querySelector('.curve-fill');
      const mark = stage.querySelector('.curve-mark');
      const max = labels.length - 1;

      return {
        update(raw, i) {
          const t = Math.max(0, Math.min(1, raw / max));
          const x = 8 + t * 158;
          fill.style.clipPath = `inset(0 ${(100 - t * 100).toFixed(1)}% 0 0)`;
          mark.setAttribute('x1', x.toFixed(1));
          mark.setAttribute('x2', x.toFixed(1));
          return statuses[i];
        },
      };
    },
  });
}
