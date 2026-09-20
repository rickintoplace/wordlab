/*
 * Hell/Dunkel-Umschalter — dieselbe Mechanik wie auf rickinto.place, damit sich
 * die Seiten gleich anfühlen: gespeicherte Wahl schlägt Systemeinstellung, und
 * ohne Wahl folgt die Seite dem System. Das Attribut selbst setzt schon ein
 * Schnipsel im <head>, bevor irgendetwas gezeichnet wird; hier hängt nur noch
 * der Knopf dran.
 *
 * Der Schlüssel ist derselbe wie auf der Hauptseite. Geteilt wird er trotzdem
 * nicht: localStorage gilt je Herkunft, und eine Subdomain ist eine eigene.
 */
import { icon, paintIcons } from './icons.js';

const KEY = 'rickintoplace-theme';
const root = document.documentElement;

const system = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const stored = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
};

function apply(theme) {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f6f7f8' : '#131517');
}

function mount(host) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-switch';
  button.setAttribute('role', 'switch');

  const knob = document.createElement('span');
  knob.className = 'knob';
  knob.append(icon('moon', { size: '15px' }), icon('sun', { size: '15px' }));
  button.append(knob);

  const paint = theme => {
    const light = theme === 'light';
    button.setAttribute('aria-checked', String(light));
    button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    button.title = button.getAttribute('aria-label');
  };

  const set = (theme, remember) => {
    apply(theme);
    paint(theme);
    if (remember) { try { localStorage.setItem(KEY, theme); } catch { /* egal */ } }
  };

  paint(root.dataset.theme === 'light' ? 'light' : 'dark');
  button.addEventListener('click', () => set(root.dataset.theme === 'light' ? 'dark' : 'light', true));

  // Ohne eigene Wahl folgt die Seite weiter dem System; ein Wechsel in einem
  // anderen Tab zieht sofort mit.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!stored()) set(system(), false);
  });
  addEventListener('storage', e => {
    if (e.key === KEY) set(e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : system(), false);
  });

  host.replaceWith(button);
}

paintIcons();
const slot = document.querySelector('[data-theme-switch]');
if (slot) mount(slot);
