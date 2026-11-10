/*
 * Ein paar Strichzeichnungen aus Lucide (ISC-Lizenz, lucide.dev) — nur die
 * Pfaddaten, ohne Abhängigkeit. Alle teilen dasselbe 24er-Raster und erben die
 * Textfarbe, damit sie sich in jedem Thema von selbst richtig einfärben.
 */
const PATHS = {
  'flask-conical': [
    'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2',
    'M6.453 15h11.094',
    'M8.5 2h7',
  ],
  sun: [
    'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41',
    'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41',
  ],
  moon: ['M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401'],
  play: ['M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'],
  'volume-2': [
    'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
    'M16 9a5 5 0 0 1 0 6',
    'M19.364 18.364a9 9 0 0 0 0-12.728',
  ],
  copy: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  'arrow-up': ['m5 12 7-7 7 7', 'M12 19V5'],
  // Die letzten drei Pfade sind die Knöpfe; settings.js schiebt sie beim Überfahren.
  'sliders-horizontal': ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3',
    'M14 2v4', 'M8 10v4', 'M16 18v4'],
  check: ['M20 6 9 17l-5-5'],
  'external-link': ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  'arrow-left': ['m12 19-7-7 7-7', 'M19 12H5'],
  'file-text': [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
    'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8',
  ],
  shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
  mail: ['m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7', 'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z'],
  'map-pin': ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0', 'M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4'],
  server: [
    'M22 8a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z',
    'M22 16a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z',
    'M6 10h.01', 'M6 18h.01',
  ],
  // Slinky-Cut: eine Feder, die als Bogen auf dem Boden steht, diagonal durchgeschnitten
  // (eigene Zeichnung; die Windungen stehen in SHAPES)
  slinky: ['M14.2 6.8 9.8 15.2'],
  upload: ['M12 3v12', 'm17 8-5-5-5 5', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'],
  download: ['M12 15V3', 'm7 10 5 5 5-5', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'],
  square: ['M5 5h14v14H5z'],
  scissors: ['M20 4 8.12 15.88', 'M14.47 14.48 20 20', 'M8.12 8.12 12 12'],
  'volume-x': ['M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z', 'M22 9l-6 6', 'M16 9l6 6'],
  'volume-2': ['M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z', 'M16 9a5 5 0 0 1 0 6', 'M19.364 18.364a9 9 0 0 0 0-12.728'],
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13'],
  zoom: ['m21 21-4.3-4.3', 'M11 8v6', 'M8 11h6'],
  plus: ['M5 12h14', 'M12 5v14'],
  sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z', 'M20 3v4', 'M22 5h-4', 'M4 17v2', 'M5 18H3'],
  xfade: ['M3 18 21 6', 'M3 6l18 12'],
  rewind: ['M11 19 2 12l9-7z', 'M22 19l-9-7 9-7z'],
  film: ['M7 3v18', 'M3 7.5h4', 'M3 12h18', 'M3 16.5h4', 'M17 3v18', 'M17 7.5h4', 'M17 16.5h4'],
};

/* Was sich nicht als Pfad schreiben lässt. */
const SHAPES = {
  sun: [['circle', { cx: 12, cy: 12, r: 4 }]],
  copy: [['rect', { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }]],
  scissors: [['circle', { cx: 6, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }]],
  pause: [['rect', { x: 14, y: 4, width: 4, height: 16, rx: 1 }], ['rect', { x: 6, y: 4, width: 4, height: 16, rx: 1 }]],
  zoom: [['circle', { cx: 11, cy: 11, r: 8 }]],
  film: [['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }]],
  // Windungen: an den Füßen gestaucht, im Bogen gestreckt – wie ein ruhender Slinky
  slinky: [
    ['ellipse', { cx: 3.6, cy: 19.4, rx: 2.6, ry: 1.05, transform: 'rotate(-180.0 3.6 19.4)' }],
    ['ellipse', { cx: 3.68, cy: 18.27, rx: 2.6, ry: 1.05, transform: 'rotate(-172.3 3.68 18.27)' }],
    ['ellipse', { cx: 4.03, cy: 16.73, rx: 2.6, ry: 1.05, transform: 'rotate(-161.5 4.03 16.73)' }],
    ['ellipse', { cx: 4.79, cy: 15.09, rx: 2.6, ry: 1.05, transform: 'rotate(-149.1 4.79 15.09)' }],
    ['ellipse', { cx: 6.0, cy: 13.52, rx: 2.6, ry: 1.05, transform: 'rotate(-135.6 6.0 13.52)' }],
    ['ellipse', { cx: 7.65, cy: 12.21, rx: 2.6, ry: 1.05, transform: 'rotate(-121.2 7.65 12.21)' }],
    ['ellipse', { cx: 9.68, cy: 11.33, rx: 2.6, ry: 1.05, transform: 'rotate(-106.0 9.68 11.33)' }],
    ['ellipse', { cx: 20.4, cy: 19.4, rx: 2.6, ry: 1.05, transform: 'rotate(-0.0 20.4 19.4)' }],
    ['ellipse', { cx: 20.32, cy: 18.27, rx: 2.6, ry: 1.05, transform: 'rotate(-7.7 20.32 18.27)' }],
    ['ellipse', { cx: 19.97, cy: 16.73, rx: 2.6, ry: 1.05, transform: 'rotate(-18.5 19.97 16.73)' }],
    ['ellipse', { cx: 19.21, cy: 15.09, rx: 2.6, ry: 1.05, transform: 'rotate(-30.9 19.21 15.09)' }],
    ['ellipse', { cx: 18.0, cy: 13.52, rx: 2.6, ry: 1.05, transform: 'rotate(-44.4 18.0 13.52)' }],
    ['ellipse', { cx: 16.35, cy: 12.21, rx: 2.6, ry: 1.05, transform: 'rotate(-58.8 16.35 12.21)' }],
    ['ellipse', { cx: 14.32, cy: 11.33, rx: 2.6, ry: 1.05, transform: 'rotate(-74.0 14.32 11.33)' }],
  ],
};

const NS = 'http://www.w3.org/2000/svg';

/** Baut ein SVG-Symbol. Die Größe kommt aus der Schriftgröße (1em), sofern nicht gesetzt. */
export function icon(name, { size = '1em', stroke = 1.75 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  for (const [tag, attrs] of SHAPES[name] ?? []) {
    const shape = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v));
    svg.append(shape);
  }
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Ersetzt jedes <span data-icon="name"> im Baum durch das Symbol. */
export function paintIcons(root = document) {
  for (const host of root.querySelectorAll('[data-icon]')) {
    const size = host.dataset.iconSize;
    host.replaceChildren(icon(host.dataset.icon, size ? { size } : {}));
  }
}
