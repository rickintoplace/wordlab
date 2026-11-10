// Ende-zu-Ende-Test für Slinky-Cut im echten (headless) Chromium über das
// DevTools-Protokoll: Datei laden, analysieren, einen Satz schneiden.
//
//   node tools/e2e-slinky.mjs <video> <sprache auto|en|de> "<satz>" [--separate] [--port 5173] [--profile <ordner>]
//
// Mit --profile bleibt das Browserprofil (und damit die fertige Analyse) erhalten.
//
// Läuft am besten mit Speicherdeckel:
//   systemd-run --user --scope -p MemoryMax=3000M -p MemorySwapMax=0 node tools/e2e-slinky.mjs …
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [video, lang, sentence] = process.argv.slice(2);
const separate = process.argv.includes('--separate');
const portArg = process.argv.indexOf('--port');
const site = `http://localhost:${portArg > 0 ? process.argv[portArg + 1] : 5173}/slinky-cut`;
const port = 9222 + (process.pid % 500);
const profArg = process.argv.indexOf('--profile');
const keepProfile = profArg > 0;
const profile = keepProfile ? path.resolve(process.argv[profArg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-'));
const OUT = process.env.E2E_OUT ?? os.tmpdir();
const chrome = spawn('chromium', ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--window-size=1280,1000', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') console.log('  console.' + msg.params.type + ':', msg.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  if (msg.method === 'Runtime.exceptionThrown') console.log('  EXCEPTION:', msg.params.exceptionDetails.exception?.description?.slice(0, 500));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('DOM.enable');
await send('Page.navigate', { url: site });
await sleep(2000);
const { result: { root } } = await send('DOM.getDocument');
const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' });
await send('DOM.setFileInputFiles', { nodeId, files: [path.resolve(video)] });
await evaluate(`document.getElementById('file').dispatchEvent(new Event('change'))`);
await sleep(1500);
await evaluate(`document.querySelector('input[name="lang"][value="${lang}"]').checked = true; document.getElementById('separate').checked = ${separate}; document.getElementById('separate').dispatchEvent(new Event('change')); document.getElementById('estimate').textContent`).then(t => console.log('Schätzung:', t));
const t0 = Date.now();
await evaluate(`document.getElementById('analyze').click()`);

let last = '';
for (;;) {
  await sleep(5000);
  const s = await evaluate(`({
    steps: [...document.querySelectorAll('#steps li')].map(li => li.dataset.step + ':' + (li.dataset.state ?? '-') + ' ' + li.querySelector('.bar i').style.width + ' ' + li.querySelector('.detail').textContent).join(' | '),
    ready: !document.getElementById('studio').hidden,
    error: document.getElementById('error').hidden ? '' : document.getElementById('error').textContent })`);
  if (s.steps !== last) { console.log(`${Math.round((Date.now() - t0) / 1000)} s`, s.steps); last = s.steps; }
  if (s.error) { console.log('FEHLER:', s.error); break; }
  if (s.ready) { console.log(`bereit nach ${Math.round((Date.now() - t0) / 1000)} s`); break; }
  if (Date.now() - t0 > 40 * 60e3) { console.log('Zeitüberschreitung'); break; }
}

if (await evaluate(`!document.getElementById('studio').hidden`)) {
  await sleep(800);
  await evaluate(`document.getElementById('text').value = ${JSON.stringify(sentence)}; document.getElementById('say').requestSubmit()`);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const take = await evaluate(`(() => { const t = document.querySelector('.tl-clip[data-type="take"]'); if (!t) return null;
      return { words: [...t.querySelectorAll('.tl-word')].map(q => q.textContent + '[' + q.className.split(' ')[2] + ']').join(' '), w: t.style.width, left: t.style.left }; })()`);
    if (take) { console.log('Take:', take); break; }
  }
  // ein Wort anklicken → Alternativen
  await evaluate(`(() => { const w = document.querySelectorAll('.tl-clip[data-type="take"] .tl-word')[1]; if (!w) return;
    const r = w.getBoundingClientRect(); for (const t of ['pointerdown', 'pointerup']) w.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + 5, clientY: r.top + 5, pointerId: 1, button: 0 })); })()`);
  await sleep(2500);
  console.log('Alternativen:', await evaluate(`[...document.querySelectorAll('.sc-alts li')].map(li => li.textContent.trim()).join(' | ')`));
  await evaluate(`document.getElementById('find').value = 'ga'; document.getElementById('find').dispatchEvent(new Event('input'))`);
  await sleep(1200);
  console.log('Suche:', await evaluate(`[...document.querySelectorAll('#results li')].slice(0, 6).map(li => li.textContent.trim()).join(' | ')`));
  // Werkzeuge: teilen, rückgängig, Lippen
  const count = () => evaluate(`[...document.querySelectorAll('.tl-clip')].map(c => c.dataset.type).join(',')`);
  const key = k => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k.key)}, ctrlKey: ${!!k.ctrl}, shiftKey: ${!!k.shift}, bubbles: true }))`);
  await evaluate(`document.activeElement.blur()`);
  console.log('Clips:', await count());
  console.log('Kopf:', await evaluate(`slinky.tl.playhead + ' gewählt ' + slinky.tl.selected + ' ' + JSON.stringify(slinky.tl.clips.map(c => [c.type, +c.at.toFixed(2), +c.len.toFixed(2)]))`));
  await key({ key: 's' }); console.log('nach S:', await count());
  await key({ key: 'z', ctrl: true }); console.log('nach Strg+Z:', await count());
  await evaluate(`[...document.querySelectorAll('.sc-act')].find(b => b.textContent.includes('Show lips'))?.click()`);
  await sleep(300);
  console.log('nach Lippen:', await count());
  await key({ key: ' ' }); await sleep(1500);
  console.log('Abspielen:', await evaluate(`document.getElementById('t-time').textContent`));
  await key({ key: ' ' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).then(r => fs.writeFileSync(path.join(OUT, 'e2e.png'), Buffer.from(r.result.data, 'base64')));
  console.log('Bild:', path.join(OUT, 'e2e.png'));
}
chrome.kill();
await sleep(500);
if (!keepProfile) try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium räumt noch */ }
process.exit(0);
