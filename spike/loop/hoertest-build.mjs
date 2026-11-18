// Hörseite bauen: alle Runden (out/hoertest/r*.json) blind einbetten (ohne Variantennamen)
// → out/hoertest/index.html und out/hoertest/files.json (Karte für den Artifact-Upload).
//   node loop/hoertest-build.mjs     (im Ordner spike)
//   Auswertung: node loop/hoertest-eval.mjs votes.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const H = new URL('../out/hoertest/', import.meta.url);
const rounds = readdirSync(H).filter(f => /^r\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))).map(f => JSON.parse(readFileSync(new URL(f, H))));
const blind = rounds.map(r => ({ id: r.id, title: r.title, items: r.items.map(({ id, text, focus, a, b }) => ({ id, text, focus, a, b })) }));
const page = readFileSync(new URL('./hoertest.html', import.meta.url), 'utf8').replace('/*ROUNDS*/[]', JSON.stringify(blind));
writeFileSync(new URL('index.html', H), page);
const files = Object.fromEntries(rounds.flatMap(r => r.items.flatMap(it => [it.a, it.b])).map(f => [f, new URL(f, H).pathname]));
writeFileSync(new URL('files.json', H), JSON.stringify(files, null, 1));
console.log(`${rounds.length} Runden, ${Object.keys(files).length} Dateien`);
