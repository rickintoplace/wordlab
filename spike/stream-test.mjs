// Streaming testen: node stream-test.mjs media/tier12 "Satz"
import { readFileSync } from 'node:fs';
import { rewriteIdeas } from '../public/slinky/ideas.js';
const [dir, line] = process.argv.slice(2);
const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
const words = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const t0 = Date.now(), at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
const r = await rewriteIdeas({ key, words, lang: 'de', line, effort: process.env.EFFORT || null, onLine: l => console.log(at(), 's ', l), onPhase: p => console.log(at(), 's  [' + p + ']') });
console.log(at(), `s fertig · $${r.cost} · ${r.lines.length} Zeilen`);
