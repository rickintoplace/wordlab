// Weg über den eigenen Chatbot testen: Prompt wie kopiert an ein Modell, Antwort wie eingefügt parsen und schneiden.
//   node chat-test.mjs media/tier12   (MODEL=…, WISH=…, LENGTH=…, REPLY=Datei statt Modell)
import { readFileSync, writeFileSync } from 'node:fs';
import { chatStoryPrompt, parseStoryReply, askOpenRouter, buildCost, keptWords } from '../public/slinky/ideas.js';
import { splitWords } from '../public/slinky/engine.js';
const [dir] = process.argv.slice(2);
const words = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const realFetch = globalThis.fetch;
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
await send({ type: 'build', key: 'x', lang: 'de', words: JSON.parse(readFileSync(`${dir}/words.json`)).words, post: f32(`${dir}/post.bin`), ...meta, voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');

const prompt = chatStoryPrompt({ words, lang: 'de', wish: process.env.WISH ?? '', length: process.env.LENGTH ?? 'medium' });
writeFileSync(new URL('./out/chat-prompt.txt', import.meta.url), prompt);
let content;
if (process.env.REPLY) content = readFileSync(process.env.REPLY, 'utf8');
else {
  const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
  const t0 = Date.now();
  const r = await askOpenRouter({ key, model: process.env.MODEL || 'google/gemini-3.8-flash', messages: [{ role: 'user', content: prompt }], fetchFn: realFetch });
  content = r.content;
  writeFileSync(new URL('./out/chat-reply.txt', import.meta.url), content);
  console.log(`Antwort ${content.length} Zeichen, ${((Date.now() - t0) / 1000).toFixed(0)} s, $${(r.usage?.cost ?? 0).toFixed(4)}`);
}
const s = parseStoryReply(content, words, []);
if (!s) { console.log('KEIN Drehbuch gefunden'); process.exit(1); }
console.log(`„${s.title}“: ${s.premise}\nAblauf: ${s.outline}\nnicht gefunden: ${s.lost.map(l => l.scene).join(' | ') || '–'}`);
for (const [k, sc] of s.scenes.entries()) {
  let cost = 0;
  if (sc.kind === 'edit' || sc.kind === 'new') {
    const force = { words: {}, pins: {}, avoid: {}, pauses: {} };
    if (sc.kind === 'edit') for (const [j, q] of keptWords(sc.idx.map(i => words[i].w), splitWords(sc.text))) force.words[j] = sc.idx[q];
    const m = await send({ type: 'mix', id: k, text: sc.text, force }, x => x.type === 'mixed' || x.type === 'error');
    cost = m.type === 'error' ? 9 : buildCost(m.words);
  }
  console.log(`${String(k + 1).padStart(2)} ${sc.kind.padEnd(4)} ${cost ? cost.toFixed(1) : '   '} „${sc.text || sc.quote}“${sc.kind === 'edit' ? `  ⟵ „${sc.quote}“` : ''}   [${sc.beat}]`);
}
