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
  if (name === 'sun') {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '4');
    svg.append(c);
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
