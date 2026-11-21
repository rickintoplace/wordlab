// Farbvarianten nebeneinander: großes Logo, „Cut it“, Pillen-Knopf, Abspielknopf, Link – je Variante und Thema
export default async ({ page, shot, log, sleep }) => {
  const ev = s => page.eval(s);
  await ev(`(() => {
    const box = document.createElement('div');
    box.id = 'probe';
    box.style.cssText = 'position:fixed;inset:0;z-index:99;background:var(--bg);display:flex;align-items:center;gap:36px;padding:40px;';
    const logo = document.querySelector('.sc-mark').cloneNode(true);
    logo.querySelector('svg').style.cssText = 'width:190px;height:190px;translate:0 -11%';
    logo.style.margin = '0';
    const col = document.createElement('div');
    col.style.cssText = 'display:grid;gap:22px;justify-items:start;font-size:16px;color:var(--fg)';
    const h = document.createElement('div'); h.innerHTML = '<span style="font-size:42px;font-weight:800;letter-spacing:-.03em">Slinky-Cut</span>';
    const cut = document.querySelector('.sc-go').cloneNode(true);
    const pill = document.getElementById('finds-go').cloneNode(true); pill.removeAttribute('id'); pill.hidden = false;
    const play = document.querySelector('.sc-tplay')?.cloneNode(true);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:18px;align-items:center';
    row.append(cut, pill); if (play) row.append(play);
    const link = document.createElement('p'); link.style.margin = '0';
    link.innerHTML = 'Baut auf <button class="sc-ref">#31–47</button> auf · <span class="sc-tag sc-kind-edit">Edit</span> · Wiedergabe <span style="display:inline-block;width:60px;height:3px;background:var(--sc-accent);vertical-align:middle"></span>';
    col.append(h, row, link);
    box.append(logo, col);
    document.body.append(box);
  })()`);
  for (const v of ['a', 'b', 'c', 'd']) for (const theme of ['dark', 'light']) {
    await ev(`(() => { document.body.dataset.accent = '${v}'; document.documentElement.style.colorScheme = '${theme}'; document.documentElement.dataset.theme = '${theme}'; })()`);
    await sleep(300);
    await shot(`farbe-${v}-${theme}`);
  }
  log('fertig');
};
