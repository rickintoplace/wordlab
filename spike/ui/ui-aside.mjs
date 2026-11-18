// Seitenleiste mit offenem „Find gold“ und einigen Sätzen in der Liste
export default async ({ page, shot, log, sleep }) => {
  const ev = s => page.eval(s);
  for (const t of ['Die Beute ist Scheiße.', 'Der Hunger ist ein Raubtier.', 'Alles ist Beute.', 'Die Fledermaus fliegt in die Fresse.', 'Sie sind die Beute.']) await ev(`slinkyCut.cut(${JSON.stringify(t)})`);
  await ev(`(() => { localStorage.setItem('slinky-openrouter-key', 'sk-or-x'); document.getElementById('ideas-key').value = 'sk-or-x'; document.getElementById('ideas-key').dispatchEvent(new Event('change')); document.getElementById('ideas-keys').open = false; document.getElementById('ideas-btn').click(); })()`);
  await sleep(300);
  log('Knöpfe:', await ev(`[...document.querySelectorAll('#ideas button')].filter(b => !b.hidden).map(b => b.textContent.trim()).join(' | ')`), '· Hinweis:', await ev(`document.querySelector('#ideas .sc-note:last-child').textContent`));
  log('Liste Höhe px:', await ev(`Math.round(document.getElementById('bin').getBoundingClientRect().height)`), '· Seitenleiste px:', await ev(`Math.round(document.querySelector('.sc-side').getBoundingClientRect().width)`));
  await shot('aside');
};
