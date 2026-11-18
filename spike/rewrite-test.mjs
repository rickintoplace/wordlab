// KI-Umschreibung einer Stelle testen: node rewrite-test.mjs media/tier12 "Satz"
import { readFileSync } from 'node:fs';
import { rewriteIdeas } from '../public/slinky/ideas.js';
const [dir, line] = process.argv.slice(2);
const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
const words = JSON.parse(readFileSync(`${dir}/words.json`)).words;
const r = await rewriteIdeas({ key, words, lang: 'de', line });
console.log(`$${r.cost}`);
for (const l of r.lines) console.log(' ', l);
