// Headless-Chromium-Steuerung über das DevTools-Protokoll — ohne Abhängigkeiten.
//   node tools/shot.mjs <url> <out.png> [--eval "js"] [--wait ms]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, out] = process.argv.slice(2);
const arg = f => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const wait = Number(arg('--wait')) || 1500;
const port = 9222 + (process.pid % 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-'));

// --gpu schaltet WebGPU über SwiftShader frei (Software-Rendering, langsam,
// aber es prüft, ob der WebGPU-Pfad überhaupt trägt).
const gpuFlags = process.argv.includes('--gpu')
  ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan,UseSkiaRenderer']
  : ['--disable-gpu'];

const chrome = spawn('chromium', ['--headless', '--no-sandbox', ...gpuFlags, '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${arg('--size') ?? '900,1400'}`, 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
  catch { await sleep(100); }
}

const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));

let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled')
    logs.push(`${msg.params.type}: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}`);
  if (msg.method === 'Runtime.exceptionThrown')
    logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description
      ?? msg.params.exceptionDetails.text));
});
const send = (method, params = {}) =>
  new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

await send('Runtime.enable');
await send('Page.enable');
if (process.argv.includes('--light'))
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.navigate', { url });
await sleep(wait);

if (arg('--eval')) {
  const r = await send('Runtime.evaluate', { expression: arg('--eval'), awaitPromise: true, returnByValue: true });
  if (r.result?.value !== undefined) console.log('eval →', JSON.stringify(r.result.value));
  if (r.exceptionDetails) console.log('eval EXCEPTION:', r.exceptionDetails.exception?.description);
  await sleep(Number(arg('--after')) || 1500);
}

// --mouse "x,y[,down]" bewegt den echten Zeiger, damit :hover und :active greifen.
if (arg('--mouse')) {
  const [x, y, down] = arg('--mouse').split(',').map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  if (down) {
    await send('Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  }
  await sleep(Number(arg('--settle')) || 700);
}

// --probe wird NACH den Mausereignissen ausgewertet (zum Prüfen von :hover/:active).
if (arg('--probe')) {
  const r = await send('Runtime.evaluate',
    { expression: arg('--probe'), awaitPromise: true, returnByValue: true });
  console.log('probe →', JSON.stringify(r.result?.value));
  if (r.exceptionDetails) console.log('probe EXCEPTION:', r.exceptionDetails.exception?.description);
}

const shot = await send('Page.captureScreenshot', { captureBeyondViewport: true });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(logs.length ? logs.join('\n') : '(keine Konsolenausgaben)');
ws.close();
chrome.kill();
chrome.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
