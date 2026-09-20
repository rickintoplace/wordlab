/*
 * Hell/Dunkel-Umschalter — derselbe Knopf wie auf rickinto.place, aber eine
 * andere Voreinstellung: wordlab ist dunkel, bis jemand etwas anderes wählt.
 * Die vier Lautfarben und die Regler sind auf den dunklen Grund hin entworfen,
 * und die Seite soll überall gleich aussehen. Die Systemvorgabe zählt deshalb
 * nicht; hell ist eine Entscheidung, keine Erbschaft.
 *
 * Das Attribut setzt schon ein Schnipsel im <head>, bevor irgendetwas
 * gezeichnet wird; hier hängt nur noch der Knopf dran.
 *
 * Der Schlüssel ist derselbe wie auf der Hauptseite. Geteilt wird er trotzdem
 * nicht: localStorage gilt je Herkunft, und eine Subdomain ist eine eigene.
 */
import { icon, paintIcons } from './icons.js';

const KEY = 'rickintoplace-theme';
const root = document.documentElement;

const DEFAULT = 'dark';

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

  paint(root.dataset.theme === 'light' ? 'light' : DEFAULT);
  button.addEventListener('click', () => set(root.dataset.theme === 'light' ? 'dark' : 'light', true));

  // Ein Wechsel in einem anderen Tab zieht sofort mit; gelöschte Wahl fällt
  // auf die Voreinstellung zurück, nicht auf das System.
  addEventListener('storage', e => {
    if (e.key === KEY) set(e.newValue === 'light' ? 'light' : DEFAULT, false);
  });

  host.replaceWith(button);
}

paintIcons();
const slot = document.querySelector('[data-theme-switch]');
if (slot) mount(slot);
