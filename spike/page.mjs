// Hörtest-Seite: blinder Vergleich mit Noten (Schulnoten) und Kommentaren.

export function page(report, STAMP = Date.now()) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const items = report.map((t, ti) => {
    // Reihenfolge pro Satz mischen, damit der Vergleich blind bleibt
    const order = t.versions.map((v, i) => i).sort(() => Math.random() - 0.5);
    const rows = order.map((vi, k) => {
      const v = t.versions[vi];
      const detail = v.detail ? `<table>${v.detail.map(d => `<tr><td class="num">${d.at.toFixed(2)} s</td><td class="num">${(d.len * 1000).toFixed(0)} ms</td><td class="ipa">${esc(d.sounds)}</td><td>aus „${esc(d.words)}“</td></tr>`).join('')}</table>` : '';
      return `<div class="version">
        <div class="head"><span class="tag">${String.fromCharCode(65 + k)}</span><audio controls preload="auto" src="${v.file}?v=${STAMP}"></audio>
        <label>Note <select data-t="${ti}" data-v="${esc(v.file)}"><option></option>${[1, 2, 3, 4, 5].map(x => `<option>${x}</option>`).join('')}</select></label>
        <input class="note-in" data-v="${esc(v.file)}" placeholder="Was hörst du? (optional)"></div>
        <details><summary>auflösen</summary><p class="label">${esc(v.label)}${v.missing?.length ? ` · nicht im Video: ${esc(v.missing.join(' '))}` : ''}</p>${detail}</details>
      </div>`;
    }).join('');
    return `<section><h2>${esc(t.text)}</h2>${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}${rows}</section>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Hörtest Sentence Mixing</title>
<style>
  :root { color-scheme: light dark; --ink: #1d1b19; --paper: #f6f3ee; --line: #d8d2c8; --accent: #b4462b; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ece7df; --paper: #1b1a18; --line: #3a3733; --accent: #e07a5a; } }
  body { background: var(--paper); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; max-width: 52rem; margin: 0 auto; padding: 2rem 1rem 6rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; } h2 { font-size: 1.15rem; margin: 0 0 .5rem; }
  .intro { color: color-mix(in oklab, var(--ink) 70%, transparent); margin-bottom: 2rem; }
  section { border-top: 1px solid var(--line); padding: 1.25rem 0; }
  .note { margin: -.25rem 0 .75rem; font-size: .9rem; color: color-mix(in oklab, var(--ink) 70%, transparent); }
  .version { margin: .5rem 0 .75rem; } .head { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
  .tag { font-weight: 700; color: var(--accent); width: 1.2rem; } audio { height: 2.2rem; }
  details { margin: .25rem 0 0 2rem; font-size: .85rem; } summary { cursor: pointer; color: color-mix(in oklab, var(--ink) 60%, transparent); }
  table { border-collapse: collapse; margin-top: .25rem; } td { padding: .1rem .6rem .1rem 0; }
  .num { font-variant-numeric: tabular-nums; text-align: right; } .ipa { font-family: 'Charis SIL', 'Doulos SIL', serif; }
  .label { margin: .25rem 0; font-weight: 600; }
  .note-in { flex: 1 1 14rem; font: inherit; font-size: .9rem; padding: .25rem .5rem; border: 1px solid var(--line); border-radius: .3rem; background: transparent; color: inherit; }
  #export { position: fixed; bottom: 1rem; right: 1rem; padding: .6rem 1rem; background: var(--accent); color: white; border: 0; border-radius: .4rem; font: inherit; cursor: pointer; }
  pre { white-space: pre-wrap; font-size: .8rem; }
</style>
<h1>Hörtest Sentence Mixing</h1>
<p class="intro">Stand: ${new Date(STAMP).toLocaleString('de-DE')}. Pro Satz gibt es mehrere Fassungen in zufälliger Reihenfolge. Erst hören und benoten – Schulnoten: 1 = perfekt, klingt wie wirklich gesagt; 5 = deutlich zusammengeschnitten oder kaputt. Dann „auflösen“. Unten rechts lassen sich die Noten kopieren.</p>
${items}
<button id="export">Noten kopieren</button><pre id="out"></pre>
<script>
document.getElementById('export').onclick = () => {
  const notes = Object.fromEntries([...document.querySelectorAll('.note-in')].map(i => [i.dataset.v, i.value.trim()]));
  const r = [...document.querySelectorAll('select')].filter(s => s.value || notes[s.dataset.v])
    .map(s => s.dataset.v + ' ' + (s.value || '-') + (notes[s.dataset.v] ? '  # ' + notes[s.dataset.v] : '')).join('\\n');
  document.getElementById('out').textContent = r;
  navigator.clipboard?.writeText(r);
};
</script>`;
}
