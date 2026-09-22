// Die Reglerkarten sind schön, aber sie stehen dem Hauptknopf im Weg. Deshalb
// liegen sie hinter einem Schalter, der sagt, was gerade eingestellt ist — so
// sieht man ohne Aufklappen, dass es da etwas zu drehen gibt.
//
// Aufgeklappt wird über grid-template-rows (0fr -> 1fr): die Breite bleibt
// dabei erhalten, und die Regler, die ihre Füllspur in Pixeln messen, messen
// auch zugeklappt richtig.
import { icon } from './icons.js';

/**
 * @param {{ key: string, summary: () => string[] }} opts
 *   `key` merkt sich je Seite, ob offen; `summary` liefert die Kurzfassung.
 */
export function mountSettings({ key, summary }) {
  const button = document.querySelector('.settings-toggle');
  const panel = document.querySelector('.settings-panel');
  const chips = button.querySelector('.settings-summary');
  button.querySelector('.settings-icon').append(icon('sliders-horizontal', { size: '16px' }));

  // Die Karten laufen gestaffelt ein.
  panel.querySelectorAll('.slider-card, .options > :not(.cards, .advanced)').forEach((el, k) => el.style.setProperty('--k', k));

  const storageKey = `wordlab-settings-${key}`;
  let open = false;
  try { open = localStorage.getItem(storageKey) === 'open'; } catch { /* ohne Speicher zu */ }

  const apply = (animate) => {
    button.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('open', open);
    panel.inert = !open;
    // Schatten der Karten dürfen erst nach dem Aufklappen über den Rand.
    panel.classList.remove('settled');
    if (open) {
      if (!animate) panel.classList.add('settled');
      else panel.addEventListener('transitionend', function done(e) {
        if (e.target !== panel) return;
        panel.removeEventListener('transitionend', done);
        if (open) panel.classList.add('settled');
      });
    }
  };

  button.addEventListener('click', () => {
    open = !open;
    try { localStorage.setItem(storageKey, open ? 'open' : 'closed'); } catch { /* egal */ }
    apply(true);
    if (open) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
  });

  const refresh = () => {
    chips.replaceChildren(...summary().map((text, k) => {
      const chip = document.createElement('span');
      chip.className = 'chip-mini';
      chip.style.setProperty('--dot', `var(--settings-dot-${k % 4})`);
      chip.textContent = text;
      return chip;
    }));
  };

  apply(false);
  refresh();
  return { refresh };
}
