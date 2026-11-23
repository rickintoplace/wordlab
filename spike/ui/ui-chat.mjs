// Geschichte über den eigenen Chatbot: Feld öffnen, Prompt kopieren, Antwort einfügen, Rückmeldung kopieren.
// Die Zwischenablage wird abgefangen (headless); die „Antwort“ ist fest und enthält Geplauder,
// ein fast wörtliches Zitat (Endung falsch) und eines, das es nicht gibt.
export default async ({ page, shot, log, sleep }) => {
  const ev = s => page.eval(s);
  await ev(`(() => { window.__errs = []; addEventListener('error', e => __errs.push(e.message)); addEventListener('unhandledrejection', e => __errs.push(String(e.reason)));
    window.__copied = []; navigator.clipboard.writeText = async t => { __copied.push(t); }; })()`);
  await ev(`localStorage.removeItem('slinky-openrouter-key'); document.getElementById('ideas-key').value = ''; document.getElementById('ideas-btn').click()`);
  await sleep(300);
  await page.click('#story-go');
  await sleep(400);
  log('Feld offen:', await ev(`!document.getElementById('story').hidden`), '· Wege:', await ev(`[...document.querySelectorAll('.sc-story-way h3')].map(h => h.textContent).join(' | ')`));
  await ev(`(() => { const t = document.getElementById('story-wish'); t.value = 'Die Forscher sind eigentlich hungrig'; t.dispatchEvent(new Event('input')); })()`);
  await ev(`[...document.querySelectorAll('#story button')].find(b => b.textContent.includes('Copy prompt')).click()`);
  await sleep(300);
  log('kopiert:', await ev(`__copied.length + ' Text(e), ' + (__copied[0]?.length ?? 0) + ' Zeichen; Wunsch drin: ' + __copied[0]?.includes('eigentlich hungrig') + '; Transkript drin: ' + /\\n1\\. /.test(__copied[0] ?? '')`), '· Status:', await ev(`document.getElementById('story-status').textContent`));
  await shot('chat-start');
  const reply = `Gern! Ich habe mehrere Ideen durchgespielt …\n\n**Die hungrigen Forscher**\n\n\`\`\`json\n${JSON.stringify({ title: 'Die hungrigen Forscher', premise: 'Die Forscher wollen den Dino eigentlich essen.', outline: 'Erst Forschung, dann Hunger.', scenes: [
    { kind: 'orig', quote: 'Eine neue Generation von Forschenden hat mittlerweile jedoch entdeckt, dass dies nur die halbe Wahrheit ist.', text: '', gold: '', beat: 'Setup' },
    { kind: 'edit', quote: 'Das Besondere, diesen Knochen gehören keinem Giganten.', text: 'Das Besondere, diese Knochen gehören keinem Forscher.', gold: '', beat: 'Wendung' },
    { kind: 'new', quote: 'Die Nosaurier gelten als die ultimativen Bestien', text: 'Die Bestien haben Hunger.', gold: '', beat: 'Pointe' },
    { kind: 'orig', quote: 'diese Quote gibt es nicht', text: '', gold: '', beat: 'fällt weg' },
  ] }, null, 2)}\n\`\`\``;
  await ev(`(() => { const t = document.getElementById('story-reply'); t.value = ${JSON.stringify(reply)}; t.dispatchEvent(new Event('input')); })()`);
  for (let i = 0; i < 60 && (await ev(`!document.querySelector('.sc-story-improve') || [...document.querySelectorAll('.sc-story-scene')].some(x => x.classList.contains('pending'))`)); i++) await sleep(250);
  await sleep(400);
  log('Szenen:', await ev(`[...document.querySelectorAll('.sc-story-scene')].map(li => li.querySelector('.sc-story-top').textContent.trim().replace(/\\s+/g, ' ') + ' → ' + (li.querySelector('.sc-bin-line')?.textContent.trim() ?? '…')).join('\\n   ')`));
  log('Status:', await ev(`document.getElementById('story-status').textContent`), '· Verbessern offen:', await ev(`document.querySelector('.sc-story-improve')?.open`), '· nicht gefunden:', await ev(`document.querySelector('.sc-story-improve .sc-note')?.textContent`));
  log('Knopf je Szene ohne Schlüssel:', await ev(`document.querySelectorAll('.sc-story-acts .sc-mini').length + ' (nur Verschieben erwartet: 2 je Szene)'`));
  await ev(`(() => { const t = document.getElementById('story-note'); t.value = 'Szene 3 ist zu brav'; t.dispatchEvent(new Event('input')); })()`);
  await ev(`[...document.querySelectorAll('#story button')].find(b => b.textContent.includes('Copy feedback')).click()`);
  await sleep(300);
  const fb = await ev(`__copied.at(-1)`);
  log('Rückmeldung:\n' + fb.split('```json')[0]);
  log('enthält Fassung als JSON:', /```json\n\{"title"/.test(fb), '· ohne ganzen Auftrag (selber Chat):', !fb.includes('Transcript (numbered'));
  await ev(`document.getElementById('story').scrollIntoView()`);
  await sleep(300);
  await shot('chat-scenes');
  // Neue Fassung über das Verbessern-Feld
  const q2 = await ev(`slinky.words.slice(20, 26).map(w => w.w).join(' ')`);
  const reply2 = '```json\n' + JSON.stringify({ title: 'Die hungrigen Forscher 2', premise: 'Neu.', outline: 'Neu.', scenes: [{ kind: 'orig', quote: q2, text: '', gold: '', beat: 'Neu' }] }) + '\n```';
  await ev(`(() => { const t = document.getElementById('story-reply'); t.value = ${JSON.stringify(reply2)}; t.dispatchEvent(new Event('input')); })()`);
  for (let i = 0; i < 40 && (await ev(`slinky.story.pitch?.title !== 'Die hungrigen Forscher 2' || slinky.story.scenes.some(s => s.pending)`)); i++) await sleep(250);
  await sleep(300);
  log('Status:', await ev(`document.getElementById('story-status').textContent`));
  log('zweite Fassung:', await ev(`slinky.story.pitch.title + ': ' + slinky.story.scenes.length + ' Szene(n), Einträge mit story: ' + slinky.bin.filter(b => b.story).length`));
  log('Fehler:', await ev(`JSON.stringify(__errs)`));
};
