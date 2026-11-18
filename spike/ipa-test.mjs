// Text oder Lautschrift fürs Modell? Gleicher Ideen-Prompt, der Wortschatz einmal als Text,
// einmal als IPA, einmal beides. Jede Zeile wird geschnitten; gezählt wird, wie viele
// verständlich bleiben (buildCost ≤ 3) und wie viele Wörter gebaut werden mussten.
//   node ipa-test.mjs media/tier12 [text|ipa|both …]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ideaMessages, askOpenRouter, parseLines, buildCost, MAX_BUILD_COST, DEFAULT_MODEL } from '../public/slinky/ideas.js';
import { parseLexicon, pronounceSync } from '../public/slinky/g2p.js';
import { encodeWav } from '../public/slinky/engine.js';
const [dir, ...modes] = process.argv.slice(2);
const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
let resolveNext;
globalThis.self = { postMessage: m => resolveNext?.(m) };
const realFetch = globalThis.fetch;
globalThis.fetch = async url => ({ text: async () => readFileSync(new URL(`../public${url.split('?')[0]}`, import.meta.url), 'utf8') });
await import('../public/slinky/worker.js');
const send = (m, until) => new Promise(r => { resolveNext = x => { if (until(x)) r(x); }; self.onmessage({ data: m }); });
const done = t => m => m.type === t || m.type === 'error';
const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words;
await send({ type: 'build', key: 'x', lang: 'de', words: raw, post: f32(`${dir}/post.bin`),
  ...JSON.parse(readFileSync(`${dir}/post.json`)), voice16: f32(`${dir}/a16.f32`), voice48: f32(`${dir}/a48.f32`), music48: null }, done('ready'));

const ipa = w => pronounceSync(w, 'de', lex).toks.map(t => t.t + (t.stress === 1 ? 'ˈ' : '')).join('').replace(/(\S+?)ˈ/g, 'ˈ$1');
const have = new Set(raw.map(w => w.w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()));
const out = new URL('./out/ipa/', import.meta.url);
mkdirSync(out, { recursive: true });
let spent = 0;
for (const mode of modes.length ? modes : ['text', 'ipa', 'both']) {
  const msgs = ideaMessages({ words: raw, lang: 'de', count: 16 });
  const u = msgs[1].content;
  const [head, rest] = u.split('Vocabulary (most frequent first):\n');
  const [vocabLine, tail] = rest.split('\n\nWhat the speaker actually says');
  const vocab = vocabLine.split(', ');
  let vtext = vocabLine, note = '';
  if (mode === 'ipa') {
    vtext = vocab.map(ipa).join(', ');
    note = 'The vocabulary is given in IPA (how the speaker pronounces each word). Write your lines in normal German spelling.\n';
  } else if (mode === 'both') {
    vtext = vocab.map(w => `${w} /${ipa(w)}/`).join(', ');
    note = 'Each vocabulary word comes with its pronunciation in IPA – use it to find words that can be built from the speaker\'s sounds.\n';
  }
  // Im IPA-Fall auch die Beispielsätze weglassen (sonst steht der Text doch da)
  const sample = mode === 'ipa' ? '' : `\n\nWhat the speaker actually says${tail}`;
  msgs[1].content = `${head}${note}Vocabulary (most frequent first):\n${vtext}${sample}`;
  const t0 = Date.now();
  const r = await askOpenRouter({ key, model: DEFAULT_MODEL, messages: msgs, fetchFn: realFetch });
  spent += r.usage?.cost ?? 0;
  const lines = parseLines(r.content, 20);
  const rows = [];
  for (const [i, text] of lines.entries()) {
    const m = await send({ type: 'mix', id: i, text }, done('mixed'));
    if (m.type === 'error') continue;
    const built = text.split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()).filter(w => w && !have.has(w));
    rows.push({ text, cost: buildCost(m.words), built });
    writeFileSync(new URL(`${mode}-${i}.wav`, out), Buffer.from(encodeWav(m.audio)));
  }
  const ok = rows.filter(x => x.cost <= MAX_BUILD_COST);
  const builtAll = rows.flatMap(x => x.built), builtOk = rows.flatMap(x => (x.cost <= MAX_BUILD_COST ? x.built : []));
  console.log(`\n== ${mode} · ${((Date.now() - t0) / 1000).toFixed(0)} s · ${r.usage?.prompt_tokens} Token rein · $${(r.usage?.cost ?? 0).toFixed(4)}`);
  console.log(`   ${rows.length} Zeilen, ${ok.length} verständlich (≤ ${MAX_BUILD_COST}) · gebaute Wörter ${builtAll.length}, davon verständlich ${builtOk.length}`);
  for (const x of rows) console.log(`   ${x.cost <= MAX_BUILD_COST ? '✓' : '✗'} ${x.cost.toFixed(1).padStart(4)}  ${x.text}${x.built.length ? `   [gebaut: ${x.built.join(', ')}]` : ''}`);
}
console.log(`\nzusammen $${spent.toFixed(4)}`);
