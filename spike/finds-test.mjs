// Fundstücke testen: node finds-test.mjs media/tier12
import { readFileSync, writeFileSync } from 'node:fs';
import { findGold } from '../public/slinky/ideas.js';
const [dir] = process.argv.slice(2);
const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
const words = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
const t0 = Date.now();
const r = await findGold({ key, words, lang: 'de' });
console.log(`$${r.cost} · ${((Date.now() - t0) / 1000).toFixed(0)} s · ${r.finds.length} von ${r.asked} gefunden`);
for (const f of r.finds) console.log(`- „${f.quote}“${f.edit ? `\n    → „${f.edit}“` : ' (so wie es ist)'}   [${f.why}]`);
writeFileSync(new URL('./out/finds.json', import.meta.url), JSON.stringify(r.finds, null, 1));
