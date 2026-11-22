// Lippen bei ausgetauschten Wörtern: Satz schneiden, ein Wort umschreiben, auf die Spur, L drücken
export default async ({ page, log, sleep }) => {
  const ev = s => page.eval(s);
  const r = await ev(`slinkyCut.cut('Die Bestien haben Hunger.')`);
  log('geschnitten', JSON.stringify(r));
  const t = await ev(`slinkyCut.rewrite(${JSON.stringify(r.id)}, 1, 'Forschenden')`);
  log('umgeschrieben:', t);
  await ev(`slinkyCut.place(${JSON.stringify(r.id)}, 200, 'a1')`);
  await sleep(300);
  const id = await ev(`slinky.tl.clips.find(c => c.type === 'take' && c.at >= 199).id`);
  await ev(`slinky.tl.select(${JSON.stringify(id)})`);
  log('Stücke:', await ev(`JSON.stringify(slinky.tl.get(${JSON.stringify(id)}).take.pieces?.map(p => [+p.at.toFixed(2), +p.len.toFixed(2)]))`), '· Wörter:', await ev(`JSON.stringify(slinky.tl.get(${JSON.stringify(id)}).take.words.map(w => [w.w, +w.start.toFixed(2), +w.end.toFixed(2)]))`));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))`);
  await sleep(300);
  log('Lippen:', await ev(`JSON.stringify(slinky.tl.clips.filter(c => c.ref === ${JSON.stringify(id)}).map(c => [+(c.at - 200).toFixed(2), +c.len.toFixed(2), c.track]))`));
  log('Spuren:', await ev(`JSON.stringify(slinky.tl.tracks.map(t => [t.id, t.kind, t.name]))`));
};
