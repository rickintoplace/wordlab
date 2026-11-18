export default async ({ page, log, sleep }) => {
  const ev = s => page.eval(s);
  await ev(`slinkyCut.cut('Die Beute ist Scheiße.')`);
  await ev(`(() => { slinky.bin[0].audio = new Float32Array(4800); slinky.alignVersion = 1; slinky.tl.changed(); })()`);
  await sleep(1500);
  await ev(`document.getElementById('file').dispatchEvent(new Event('change'))`);
  await sleep(800);
  await ev(`document.getElementById('analyze').click()`);
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(`!document.getElementById('studio').hidden && slinky.bin?.length > 0 && slinky.bin[0].audio.length > 4800`)) break; }
  log('nach Neuladen: Länge s', await ev(`(slinky.bin[0].audio.length / 48000).toFixed(2)`), '· Version', await ev(`slinky.alignVersion`));
};
