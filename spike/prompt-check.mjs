// Prompts für den eigenen Chatbot erzeugen und die Antwort-Parser prüfen (ohne Browser, ohne Modell).
//   node prompt-check.mjs media/tier12   → out/chat-story-prompt.txt, out/chat-gold-prompt.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { funnyWords } from '../public/slinky/funny.js';
import { vocabulary, nearText, chatStoryPrompt, chatGoldPrompt, parseGoldReply, parseStoryReply } from '../public/slinky/ideas.js';
const [dir] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const words = raw.map(w => ({ ...w, spk: w.spk ?? 0 }));
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const meta = JSON.parse(readFileSync(`${dir}/post.json`));
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`), ...meta, voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, m => m.type === 'ready' || m.type === 'error');
const r = await send({ type: 'near', id: 1, words: vocabulary(words), targets: funnyWords('de') }, m => m.type === 'near' || m.type === 'error');
const near = nearText(r.near, words);
const sp = chatStoryPrompt({ words, lang: 'de', wish: 'Test', near, gold: [{ text: 'Die Bestien haben Hunger.' }] });
const gp = chatGoldPrompt({ words, lang: 'de', topic: '', near });
writeFileSync(new URL('./out/chat-story-prompt.txt', import.meta.url), sp);
writeFileSync(new URL('./out/chat-gold-prompt.txt', import.meta.url), gp);
console.log(`Story-Prompt ${sp.length} Zeichen, Gold-Prompt ${gp.length} Zeichen, ${r.near.length} Beinahe-Wörter`);
const q = words.slice(3, 9).map(w => w.w).join(' ');
const g = parseGoldReply(`bla\n\`\`\`json\n{"finds": [{"quote": "${q}", "edit": "", "why": "x"}, {"quote": "gibt es nicht", "edit": "", "why": "y"},]}\n\`\`\``, words);
console.log('Gold geparst:', JSON.stringify(g?.map(f => f.quote)));
const s = parseStoryReply(`\`\`\`json\n{"title": "T", "scenes": [{"kind": "orig", "quote": "${q}"}, {"kind": "new", "text": "Hallo Welt", "quote": ""}]}\n\`\`\``, words);
console.log('Story geparst:', s.scenes.length, 'Szenen,', s.lost.length, 'verloren');
console.log('Kein JSON:', parseGoldReply('nur Text', words), parseStoryReply('{"finds": []}', words));
