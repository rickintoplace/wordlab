// Reiter „Story“: Ideen → Drehbuch → auf die Zeitleiste. OpenRouter wird im Browser durch feste
// Antworten ersetzt (kostet nichts); Schneiden und Platzieren laufen echt.
export default async ({ page, shot, log, sleep }) => {
  const ev = s => page.eval(s);
  if (process.env.KEY401) {
    await ev(`(() => { const real = window.fetch; window.fetch = async (u, o) => String(u).includes('openrouter.ai/api/v1/chat') ? new Response('{"error":{"message":"User not found.","code":401}}', { status: 401 }) : real(u, o);
      localStorage.setItem('slinky-openrouter-key', 'sk-or-old'); document.getElementById('ideas-key').value = 'sk-or-old'; document.getElementById('ideas-key').dispatchEvent(new Event('change')); document.getElementById('ideas-keys').open = false; document.getElementById('ideas-btn').click(); })()`);
    await sleep(200);
    await ev(`document.getElementById('story-go').click()`);
    await sleep(800);
    log('401:', await ev(`document.getElementById('ideas-status').textContent`), '· Schlüsselfeld offen:', await ev(`document.getElementById('ideas-keys').open`), '· Knopf wieder frei:', await ev(`!document.getElementById('story-go').disabled`));
    return;
  }
  await ev(`(() => { window.__errs = []; addEventListener('error', e => __errs.push(e.message)); addEventListener('unhandledrejection', e => __errs.push(String(e.reason))); })()`);
  // ein Gold-Eintrag zum Einbauen
  await ev(`slinkyCut.cut('Die Bestien haben Hunger.')`);
  await ev(`(() => { const b = slinky.bin[0]; slinky.bin.unshift({ ...b, id: 'g1', gold: true, note: 'test' }); })()`);
  await ev(`(() => {
    const answers = {
      pitches: { pitches: [
        { title: 'Die Knochen-Diät', premise: 'Die Forscher finden heraus, dass Dinosaurier nur Knochen essen.', why: 'Knochenfund #3–4 und G1' },
        { title: 'Halbe Wahrheit', premise: 'Alles im Film ist nur die halbe Wahrheit.', why: 'Forschende, Wahrheit' } ] },
      scenes: { outline: 'Erst Forschung (#2), dann Knochen.', scenes: [
        { kind: 'orig', quote: 'Eine neue Generation von Forschenden hat mittlerweile jedoch entdeckt, dass dies nur die halbe Wahrheit ist.', text: '', gold: '', beat: 'Setup' },
        { kind: 'edit', quote: 'Das Besondere, diese Knochen gehören keinem Giganten.', text: 'Das Besondere, diese … Knochen gehören keinem Giganten.', gold: '', beat: 'Wendung' },
        { kind: 'gold', quote: '', text: '', gold: '1', beat: 'Running Gag' },
        { kind: 'new', quote: 'Die Nosaurier gelten als die ultimativen Bestien', text: 'Die Bestien sind wirklich klein.', gold: '', beat: 'Pointe' },
        { kind: 'orig', quote: 'diese Quote gibt es nicht', text: '', gold: '', beat: 'fällt weg' } ] },
      fix: { scenes: [ { replace: 2, kind: 'orig', quote: 'Er ist wirklich klein, ein sehr junges Exemplar.', text: '', gold: '', beat: 'Ersatz' } ] },
    };
    const real = window.fetch;
    window.__asked = [];
    window.fetch = async (url, o) => {
      if (!String(url).includes('openrouter.ai/api/v1/chat')) return real(url, o);
      const body = JSON.parse(o.body), last = body.messages.at(-1).content;
      const kind = /Replace these scenes/.test(last) ? 'fix' : /Write the script/.test(last) ? 'scenes' : 'pitches';
      __asked.push(kind);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answers[kind]) } }], usage: { cost: 0 } }), { headers: { 'content-type': 'application/json' } });
    };
    localStorage.setItem('slinky-openrouter-key', 'sk-or-x');
    document.getElementById('ideas-key').value = 'sk-or-x';
    document.getElementById('ideas-key').dispatchEvent(new Event('change'));
    document.getElementById('ideas-btn').click();
    document.querySelector('input[name="ai-route"][value="api"]').click();
  })()`);
  await sleep(300);
  await page.click('#story-go');
  for (let i = 0; i < 30 && !(await ev(`document.querySelectorAll('.sc-story-pitch').length`)); i++) await sleep(200);
  log('Status:', await ev(`document.getElementById('story-status')?.textContent`), '· Anfragen:', await ev(`__asked.join()`), '· Fehler:', await ev(`JSON.stringify(__errs)`));
  log('Ideen:', await ev(`[...document.querySelectorAll('.sc-story-pitch b')].map(b => b.textContent).join(' | ')`), '· Feld sichtbar:', await ev(`!document.getElementById('story').hidden`));
  await shot('story-ideas');
  log('Verweise:', await ev(`[...document.querySelectorAll('.sc-story-pitch .sc-ref')].map(b => b.textContent).join(' ')`));
  await ev(`document.querySelector('.sc-story-pitch .sc-ref[data-s]').click()`);
  await sleep(400);
  log('Sprung: Zeitleiste bei', await ev(`slinky.tl.playhead.toFixed(2)`), '· markiert:', await ev(`document.getElementById('tsel').textContent.slice(0, 80)`));
  await ev(`document.querySelector('.sc-story-pitch .sc-act').click()`);
  for (let i = 0; i < 60 && (await ev(`!document.querySelector('#story .sc-story-bar .pill-button') || document.querySelector('#story .sc-story-bar .pill-button').disabled`)); i++) await sleep(250);
  await sleep(500);
  log('Szenen:', await ev(`[...document.querySelectorAll('.sc-story-scene')].map(li => li.querySelector('.sc-story-top').textContent.trim().replace(/\\s+/g, ' ') + ' → ' + (li.querySelector('.sc-bin-line')?.textContent.trim() ?? '…')).join('\\n   ')`));
  log('Anfragen:', await ev(`__asked.join(', ')`), '· Status:', await ev(`document.getElementById('ideas-status').textContent`));
  await ev(`document.getElementById('story').scrollIntoView()`);
  await sleep(300);
  await shot('story-scenes');
  // nach unten verschieben, dann platzieren
  await ev(`document.querySelectorAll('.sc-story-scene .sc-flip')[0].click()`);
  await sleep(200);
  log('Bearbeitung mit „…“:', await ev(`slinky.bin.find(b => b.story && /…/.test(b.text))?.words.map(w => w.w).join(' ')`));
  log('Seitenleiste: Scrollbereiche', await ev(`[...document.querySelectorAll('.sc-side *')].filter(x => { const c = getComputedStyle(x); return /auto|scroll/.test(c.overflowY) && x.scrollHeight > x.clientHeight; }).length`), '· Reiter sticky:', await ev(`getComputedStyle(document.getElementById('bintabs')).position`));
  log('nach Verschieben:', await ev(`slinky.story.scenes.map(s => s.kind).join(' ')`));
  const before = await ev(`slinky.tl.clips.length`);
  await ev(`document.querySelector('#story .sc-story-bar .pill-button').click()`);
  await sleep(600);
  log('Clips vorher/nachher:', before, await ev(`slinky.tl.clips.length`), '· Bereich:', await ev(`JSON.stringify(slinky.tl.range)`), '· Bild-Clips der Szenen:', await ev(`slinky.tl.clips.filter(c => c.type === 'lips' && c.at >= slinky.tl.range.a).length`));
  log('Bild lückenlos:', await ev(`(() => { const { a, b } = slinky.tl.range; const L = slinky.tl.clips.filter(c => c.type === 'lips' && c.at >= a - 0.01).sort((x, y) => x.at - y.at); let t = a, gap = 0; for (const c of L) { gap += Math.max(0, c.at - t); t = Math.max(t, c.at + c.len); } gap += Math.max(0, b - t); return 'Lücken ' + gap.toFixed(2) + ' s, ' + L.length + ' Bilder'; })()`));
  log('Sätze-Reiter zeigt Szenen nicht:', await ev(`slinky.bin.filter(b => b.story).length`), 'Szenen-Einträge,', await ev(`(document.querySelector('[data-tab="cut"] span').textContent)`), 'im Reiter Sätze');
  await shot('story-placed');
  log('Fehler:', await ev(`JSON.stringify(__errs)`));
};
