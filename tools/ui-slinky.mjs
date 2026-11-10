// Oberflächentest für Slinky-Cut ohne Modelle: Eine fertige Analyse (aus Node-
// Testdaten) wird direkt in die IndexedDB des Browsers gelegt, dann wird das
// Schnittfenster mit echten Maus- und Tastaturereignissen bedient.
//
//   SLINKY_DEV_DIR=<daten> node tools/serve.mjs 5173      (stellt /__dev/* bereit)
//   node tools/ui-slinky.mjs <video> <skript.mjs> [--out <ordner>]
//
// Das Skript exportiert `default async ({ page, shot, log, sleep })`.
//
// Schutz für den Rechner: Ein Wächter beendet den Browser sofort, wenn der freie
// Speicher unter 1,8 GB fällt (Chromium entzieht sich systemd-Grenzen).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [video, script] = process.argv.slice(2);
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : os.tmpdir();
const site = 'http://localhost:5173/slinky-cut';
const port = 9300 + (process.pid % 400);
const profile = fs.mkdtempSync(path.join(OUT, 'ui-profile-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const memAvail = () => Number(fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/)[1]) / 1024;
if (memAvail() < 2800) { console.log(`Zu wenig freier Speicher (${memAvail().toFixed(0)} MB) – Test abgebrochen.`); process.exit(1); }

const chrome = spawn('chromium', ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--window-size=1400,1000', '--autoplay-policy=no-user-gesture-required',
  '--js-flags=--max-old-space-size=512', 'about:blank'], { stdio: 'ignore', detached: true });
let peak = 0, minAvail = Infinity;
const cleanup = () => { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* schon weg */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* */ } };
const guard = setInterval(() => {
  const a = memAvail();
  minAvail = Math.min(minAvail, a);
  if (a < 1800) { console.log(`WÄCHTER: nur noch ${a.toFixed(0)} MB frei – Browser beendet.`); cleanup(); process.exit(2); }
}, 300);
process.on('exit', cleanup);

let targets;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) errors.push('console.' + msg.params.type + ': ' + msg.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  if (msg.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 600));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

// Maus und Tastatur wie ein Mensch
const mods = m => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
const page = {
  eval: evaluate,
  async box(sel) { const b = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; })()`); if (!b) throw new Error(`nicht gefunden: ${sel}`); return b; },
  async mouse(type, x, y, o = {}) { await send('Input.dispatchMouseEvent', { type, x, y, button: o.button ?? 'left', buttons: type === 'mouseReleased' ? 0 : o.button === 'middle' ? 4 : o.button === 'right' ? 2 : 1, clickCount: o.count ?? 1, modifiers: mods(o) }); },
  async click(sel, o = {}) { const b = await page.box(sel); const x = b.x + (o.dx ?? b.w / 2), y = b.y + (o.dy ?? b.h / 2); await page.mouse('mouseMoved', x, y, o); await page.mouse('mousePressed', x, y, o); await page.mouse('mouseReleased', x, y, o); if (o.count === 2) { await page.mouse('mousePressed', x, y, o); await page.mouse('mouseReleased', x, y, o); } await sleep(150); },
  async drag(x0, y0, x1, y1, o = {}) { await page.mouse('mouseMoved', x0, y0, o); await page.mouse('mousePressed', x0, y0, o); for (let k = 1; k <= 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * k / 8, y: y0 + (y1 - y0) * k / 8, button: o.button ?? 'left', buttons: o.button === 'middle' ? 4 : 1, modifiers: mods(o) }); await sleep(30); } await page.mouse('mouseReleased', x1, y1, o); await sleep(200); },
  async key(key, o = {}) {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const text = key === 'Enter' ? '\r' : key.length === 1 && !o.ctrl && !o.alt ? key : undefined;
    const vk = key === ' ' ? 32 : key === 'Enter' ? 13 : key === 'Delete' ? 46 : key === 'Escape' ? 27 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : code, text, windowsVirtualKeyCode: vk, modifiers: mods(o) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : code, windowsVirtualKeyCode: vk, modifiers: mods(o) });
    await sleep(150);
  },
  async type(sel, text) { await page.click(sel); await evaluate(`document.querySelector(${JSON.stringify(sel)}).value = ''`); await send('Input.insertText', { text }); await sleep(100); },
  errors,
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT, `${name}.png`);
  fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  return f;
};
const log = (...a) => console.log(...a);

await send('Runtime.enable');
await send('Page.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: site });
await sleep(1500);

// Video in das Dateifeld, dann die fertige Analyse in den Zwischenspeicher
const { result: { root } } = await send('DOM.getDocument');
const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' });
await send('DOM.setFileInputFiles', { nodeId, files: [path.resolve(video)] });
await evaluate(`document.getElementById('file').dispatchEvent(new Event('change'))`);
await sleep(800);
await evaluate(`(async () => {
  const f = document.getElementById('file').files[0];
  const key = f.name + '|' + f.size + '|' + f.lastModified + '|auto|sep';
  const get = async n => new Float32Array(await (await fetch('/__dev/' + n)).arrayBuffer());
  const meta = await (await fetch('/__dev/post.json')).json();
  const words = (await (await fetch('/__dev/words.json')).json()).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
  const entry = { lang: 'de', voice16: await get('vocals16.f32'), voice48: await get('vocals48.f32'), music48: await get('music48.f32'),
    raw: { words, post: await get('post.bin'), V: meta.V, vocab: meta.vocab }, alignVersion: -1 };
  await new Promise((res, rej) => { const q = indexedDB.open('slinky-cut', 1); q.onupgradeneeded = () => q.result.createObjectStore('analyses');
    q.onsuccess = () => { const t = q.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').put(entry, key); t.oncomplete = res; t.onerror = rej; }; q.onerror = rej; });
  document.querySelector('input[name="lang"][value="auto"]').checked = true;
  document.getElementById('separate').checked = true;
  document.getElementById('analyze').click();
})()`);
for (let i = 0; i < 120; i++) { await sleep(500); if (await evaluate(`!document.getElementById('studio').hidden && !!window.slinky`)) break; }
await sleep(1200);
log(`bereit · frei mindestens ${minAvail.toFixed(0)} MB`);

try {
  const mod = await import(path.resolve(script));
  await mod.default({ page, shot, log, sleep });
} catch (err) { log('TESTFEHLER:', err.message); }
log(errors.length ? `Fehler im Browser:\n  ${errors.join('\n  ')}` : 'keine Fehler im Browser');
log(`frei mindestens ${minAvail.toFixed(0)} MB`);
clearInterval(guard);
cleanup();
process.exit(0);
