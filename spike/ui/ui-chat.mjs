// Weg „Your chatbot“: Find gold und Write a story kopieren sofort einen Prompt, die eingefügte Antwort
// wird geschnitten. Zwischenablage abgefangen (headless); Antworten fest, mit Geplauder, einem fast
// wörtlichen und einem erfundenen Zitat.
export default async ({ page, shot, log, sleep }) => {
  const ev = s => page.eval(s);
  await ev(`(() => { window.__errs = []; addEventListener('error', e => __errs.push(e.message)); addEventListener('unhandledrejection', e => __errs.push(String(e.reason)));
    window.__copied = []; navigator.clipboard.writeText = async t => { __copied.push(t); }; })()`);
  await ev(`document.getElementById('ideas-btn').click(); document.querySelector('input[name="ai-route"][value="chat"]').click()`);
  await sleep(300);
  log('Weg:', await ev(`document.querySelector('input[name="ai-route"]:checked').value`), '· Schlüsselfeld versteckt:', await ev(`document.getElementById('ideas-keys').hidden`));
  await ev(`(() => { const t = document.getElementById('ideas-topic'); t.value = 'Die Forscher sind eigentlich hungrig'; })()`);
  await shot('chat-aside');

  // ---- Find gold
  await page.click('#finds-go');
  for (let i = 0; i < 20 && !(await ev(`__copied.length`)); i++) await sleep(200);
  const gp = await ev(`__copied[0] ?? ''`);
  log('Gold-Prompt:', gp.length, 'Zeichen · Einfügefeld:', await ev(`!document.getElementById('gold-paste').hidden`), '· Status:', await ev(`document.getElementById('ideas-status').textContent`));
  log('Beinahe-Wörter im Prompt:\n' + (gp.match(/Near-miss words[\s\S]*?\n\n/)?.[0] ?? '(keine)').split('\n').slice(0, 12).join('\n'));
  const q1 = await ev(`slinky.words.slice(20, 27).map(w => w.w).join(' ')`);
  const goldReply = 'Hier meine Funde:\n```json\n' + JSON.stringify({ finds: [
    { quote: q1, edit: '', why: 'klingt schräg' },
    { quote: 'Das Besondere, diese Knochen gehören keinem Giganten.', edit: 'Das Besondere, diese Knochen gehören keinem Forscher.', why: 'Knochen' },
    { quote: 'gibt es nicht', edit: '', why: 'x' }] }) + '\n```';
  const goldBefore = await ev(`slinky.bin.filter(b => b.gold).length`);
  await ev(`(() => { const t = document.getElementById('gold-reply'); t.value = ${JSON.stringify(goldReply)}; t.dispatchEvent(new Event('input')); })()`);
  for (let i = 0; i < 40 && (await ev(`slinky.bin.filter(b => b.gold).length`)) < goldBefore + 2; i++) await sleep(250);
  await sleep(300);
  log('Gold dazu:', (await ev(`slinky.bin.filter(b => b.gold).length`)) - goldBefore, '· Status:', await ev(`document.getElementById('ideas-status').textContent`));

  // ---- Write a story
  await page.click('#story-go');
  for (let i = 0; i < 20 && (await ev(`__copied.length`)) < 2; i++) await sleep(200);
  const sp = await ev(`__copied[1] ?? ''`);
  log('Story-Prompt:', sp.length, 'Zeichen; Wunsch drin:', sp.includes('eigentlich hungrig'), '· Tricks drin:', sp.includes('Collect jokes, not premises'), '· Beinahe-Wörter drin:', sp.includes('Near-miss words'), '· Gold drin:', /G1: /.test(sp));
  log('Feld:', await ev(`document.querySelector('#story h2').textContent`), '· Status:', await ev(`document.getElementById('story-status').textContent`));
  await ev(`document.getElementById('story').scrollIntoView()`);
  await sleep(200);
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
  log('Status:', await ev(`document.getElementById('story-status').textContent`), '· Verbessern offen:', await ev(`document.querySelector('.sc-story-improve')?.open`));
  await ev(`(() => { const t = document.getElementById('story-note'); t.value = 'Szene 3 ist zu brav'; t.dispatchEvent(new Event('input')); })()`);
  await ev(`[...document.querySelectorAll('#story button')].find(b => b.textContent.includes('Copy feedback')).click()`);
  await sleep(400);
  const fb = await ev(`__copied.at(-1)`);
  log('Rückmeldung (Anfang):\n' + fb.split('```json')[0].split('\n').slice(0, 6).join('\n'));
  await ev(`document.getElementById('story').scrollIntoView()`);
  await sleep(300);
  await shot('chat-scenes');
  // „New story“ zeigt das Einfügefeld, „Back to the script“ wieder die Szenen
  await ev(`[...document.querySelectorAll('#story button')].find(b => b.textContent.includes('New story')).click()`);
  await sleep(200);
  log('New story:', await ev(`!!document.getElementById('story-reply') && !document.querySelector('.sc-story-scene')`));
  await ev(`[...document.querySelectorAll('#story button')].find(b => b.textContent.includes('Back to the script')).click()`);
  await sleep(200);
  log('zurück:', await ev(`document.querySelectorAll('.sc-story-scene').length`), 'Szenen');
  log('Fehler:', await ev(`JSON.stringify(__errs)`));
};
