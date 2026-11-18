export default async ({ page, shot, log, sleep }) => {
  const ev = s => page.eval(s);
  await ev(`(() => { window.__errs = []; addEventListener('error', e => __errs.push(e.message)); })()`);
  await ev(`document.getElementById('ideas-btn').click(); document.getElementById('ideas-keys').open = true`);
  await sleep(300);
  log('Auswahl:', await ev(`[...document.querySelectorAll('#ideas-pick option')].map(o => o.textContent + (o.selected ? ' ✓' : '')).join(' | ')`), '· Modell:', await ev(`document.getElementById('ideas-model').value`), '· Freitext sichtbar:', await ev(`!document.getElementById('ideas-other').hidden`));
  await ev(`(() => { const p = document.getElementById('ideas-pick'); p.value = ''; p.dispatchEvent(new Event('change')); })()`);
  for (let i = 0; i < 20 && !(await ev(`document.getElementById('ideas-models').childElementCount`)); i++) await sleep(300);
  log('Other: Freitext sichtbar', await ev(`!document.getElementById('ideas-other').hidden`), '· Vorschläge', await ev(`document.getElementById('ideas-models').childElementCount`), '·', await ev(`[...document.querySelectorAll('#ideas-models option')].slice(0, 4).map(o => o.value + ' (' + o.label + ')').join(' | ')`));
  await ev(`(() => { const i = document.getElementById('ideas-model'); i.value = 'google/gemini-3.5-flash-lite'; i.dispatchEvent(new Event('change')); })()`);
  log('getippt → Auswahl:', await ev(`document.getElementById('ideas-pick').value`), '· Freitext versteckt:', await ev(`document.getElementById('ideas-other').hidden`));
  await shot('models');
  log('Fehler:', await ev(`JSON.stringify(__errs)`));
};
