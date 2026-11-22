// Drehbuch testen: node story-test.mjs media/tier12 [Idee-Nr]   (MODEL=…, LENGTH=short|medium|long)
// Holt Ideen, schreibt das Drehbuch zur gewählten Idee und schneidet jede Szene (Baukosten).
import { readFileSync, writeFileSync } from 'node:fs';
import { storyPitches, writeStory, fixScenes, reviseStory, buildCost, MAX_BUILD_COST, keptWords } from '../public/slinky/ideas.js';
import { splitWords } from '../public/slinky/engine.js';
const [dir, pick = '1'] = process.argv.slice(2);
const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
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

const model = process.env.MODEL || undefined, t0 = Date.now(), sec = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const P = await storyPitches({ key, model, words, lang: 'de', fetchFn: realFetch });
console.log(`Ideen (${sec()}, $${P.cost.toFixed(4)}):`);
P.pitches.forEach((p, i) => console.log(`${i + 1}. ${p.title} – ${p.premise}  [${p.why}]`));
const pitch = P.pitches[+pick - 1];
const S = await writeStory({ key, model, words, lang: 'de', pitch, length: process.env.LENGTH ?? 'medium', fetchFn: realFetch });
console.log(`\nDrehbuch „${pitch.title}“ (${sec()}, $${S.cost.toFixed(4)}):\nAblauf: ${S.outline}`);
const weak = [];
for (const [k, s] of S.scenes.entries()) {
  let cost = 0;
  if (s.kind === 'edit' || s.kind === 'new') {
    const force = { words: {}, pins: {}, avoid: {}, pauses: {} };
    if (s.kind === 'edit') for (const [j, q] of keptWords(s.idx.map(i => words[i].w), splitWords(s.text))) force.words[j] = s.idx[q];
    const r = await send({ type: 'mix', id: k, text: s.text, force }, m => m.type === 'mixed' || m.type === 'error');
    cost = r.type === 'error' ? 9 : buildCost(r.words);
    if (cost > MAX_BUILD_COST) weak.push({ n: k + 1, text: s.text, why: `words built from single sounds: ${r.words.filter(w => w.quality === 'sounds').map(w => w.w).join(', ')}` });
  }
  console.log(`${String(k + 1).padStart(2)} ${s.kind.padEnd(4)} ${cost ? cost.toFixed(1) : '   '} ${s.text ? `„${s.text}“` : `„${s.quote}“`}${s.kind !== 'orig' && s.quote ? `   ⟵ ${s.kind === 'new' ? 'Bild' : 'aus'}: „${s.quote}“` : ''}   [${s.beat}]`);
}
// Zweiter Durchgang: wie ein Zuschauer anhören lassen und neu schreiben (REVISE=1)
const cutAll = async scenes => {
  const out = [];
  for (const [k, s] of scenes.entries()) {
    let mushy = [], cost = 0;
    if (s.kind === 'edit' || s.kind === 'new') {
      const force = { words: {}, pins: {}, avoid: {}, pauses: {} };
      if (s.kind === 'edit') for (const [j, q] of keptWords(s.idx.map(i => words[i].w), splitWords(s.text))) force.words[j] = s.idx[q];
      const r = await send({ type: 'mix', id: k, text: s.text, force }, m => m.type === 'mixed' || m.type === 'error');
      cost = r.type === 'error' ? 9 : buildCost(r.words);
      if (cost > MAX_BUILD_COST) mushy = r.words.filter(w => w.quality === 'sounds').map(w => w.w);
    }
    out.push({ kind: s.kind, text: s.text || s.quote || '(gold)', mushy, cost });
  }
  return out;
};
if (process.env.REVISE) {
  const heard = await cutAll(S.scenes);
  const R = await reviseStory({ key, model, words, messages: S.messages, content: S.content, heard, fetchFn: realFetch, onScene: () => {} });
  console.log(`\nÜberarbeitet (${sec()}, $${R.cost.toFixed(4)})\nKritik: ${R.critique}\nAblauf: ${R.outline}`);
  const h2 = await cutAll(R.scenes);
  R.scenes.forEach((s, k) => console.log(`${String(k + 1).padStart(2)} ${s.kind.padEnd(4)} ${h2[k].cost ? h2[k].cost.toFixed(1) : '   '} „${h2[k].text}“${s.kind !== 'orig' && s.quote ? `   ⟵ ${s.kind === 'new' ? 'Bild' : 'aus'}: „${s.quote}“` : ''}   [${s.beat}]`));
}
if (process.env.FIX) weak.push({ n: +process.env.FIX, text: S.scenes[+process.env.FIX - 1]?.text || S.scenes[+process.env.FIX - 1]?.quote, why: 'the editor wants another version here' });
if (weak.length) {
  const F = await fixScenes({ key, model, words, messages: S.messages, content: S.content, weak, fetchFn: realFetch });
  console.log(`\nErsatz (${sec()}, $${F.cost.toFixed(4)}):`);
  for (const { n, scene } of F.scenes) console.log(`${n} → ${scene.kind} „${scene.text || scene.quote}“${scene.kind === 'new' && scene.quote ? `  Bild: „${scene.quote}“` : ''}`);
}
writeFileSync(new URL('./out/story.json', import.meta.url), JSON.stringify({ pitches: P.pitches, scenes: S.scenes }, null, 1));
