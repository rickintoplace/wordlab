// A/B der Prosodie: A = ohne Lage/Tempo-Kosten, B = mit, C = B + Tonhöhenangleichung beim Rendern.
//   node ab-prosody.mjs media/tier12 zeilen.txt out/prosody
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseLexicon } from '../public/slinky/g2p.js';
import { W, buildSource, targetPhones, select, plan, render, encodeWav, wholeWords } from '../public/slinky/engine.js';
import { loadScorer, hear, targetTokens, per } from './score.mjs';
const [dir, file, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const lex = parseLexicon(readFileSync(new URL('../public/data/slinky/lex-de.txt', import.meta.url), 'utf8'));
// REALIGN=1: Laute neu verorten (aktueller Stand von align.js), NO_LM=1: ohne Landmarken
let { words, phones } = JSON.parse(readFileSync(`${dir}/phones.json`));
if (process.env.NO_LM) globalThis.SLINKY_NO_LM = true;
if (process.env.LM) globalThis.SLINKY_LM = process.env.LM;
if (process.env.ONSET_DB) globalThis.SLINKY_ONSET_DB = +process.env.ONSET_DB;
if (process.env.REALIGN) {
  const { alignWords } = await import('../public/slinky/align.js');
  const { pronounceSync } = await import('../public/slinky/g2p.js');
  const meta = JSON.parse(readFileSync(`${dir}/post.json`));
  const raw = JSON.parse(readFileSync(`${dir}/words.json`)).words.map(w => ({ ...w, spk: w.spk ?? 0 }));
  ({ words, phones } = alignWords({ words: raw, post: f32(`${dir}/post.bin`), V: meta.V, vocab: meta.vocab, audio16: f32(`${dir}/a16.f32`), pronounce: w => pronounceSync(w, 'de', lex).toks }));
}
const src = buildSource({ lang: 'de', words, phones, a16: f32(`${dir}/a16.f32`), a48: f32(`${dir}/a48.f32`) });
const texts = readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
const base = { ...W };
const bw = process.env.BW ? JSON.parse(process.env.BW) : {};
const variants = process.env.VARIANTS ? JSON.parse(process.env.VARIANTS) : process.env.ONLYB ? { B: { w: bw } } : { A: { w: { register: 0, tempo: 0 } }, B: { w: bw }, C: { w: bw, prosody: true } };
if (!process.env.NOPER) await loadScorer();
const tot = {}, jump = {};
for (const [i, text] of texts.entries()) {
  const row = [];
  for (const [name, v] of Object.entries(variants)) {
    Object.assign(W, base, v.w);
    const tgt = targetPhones(text, 'de', lex, src);
    const { chosen } = select(src, tgt, 250, wholeWords(src, tgt).constrain);
    const segs = plan(src, tgt, chosen);
    // Sprünge der Stimmlage zwischen aufeinanderfolgenden Stücken (Halbtöne)
    const ps = segs.map(s => chosen[s.parts[0]].p);
    let j = 0; for (let k = 1; k < ps.length; k++) if (ps[k].locF0 != null && ps[k - 1].locF0 != null) j += 12 * Math.abs(ps[k].locF0 - ps[k - 1].locF0);
    j /= Math.max(1, ps.length - 1);
    const f = `${out}/${i}-${name}.wav`;
    writeFileSync(f, Buffer.from(encodeWav(render(src, segs, { prosody: !!v.prosody }))));
    const p = process.env.NOPER ? 0 : per(targetTokens(text, 'de'), await hear(f));
    tot[name] = (tot[name] ?? 0) + p; jump[name] = (jump[name] ?? 0) + j;
    row.push(`${name} ${String(segs.length).padStart(2)} St. ${(100 * p).toFixed(0).padStart(3)} % Sprung ${j.toFixed(1)} HT`);
  }
  console.log(row.join(' | '), ' ', text);
}
console.log('Mittel:', Object.keys(variants).map(k => `${k} PER ${(100 * tot[k] / texts.length).toFixed(1)} % · Sprung ${(jump[k] / texts.length).toFixed(2)} HT`).join(' | '));
