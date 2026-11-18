// Sprecher-Zuordnung: Atemgruppen → WeSpeaker-Einbettung → agglomerative Häufung.
//   node diar.mjs media/terra3
import { readFileSync } from 'node:fs';
import { AutoModel, AutoFeatureExtractor, Tensor } from '@huggingface/transformers';
const dir = process.argv[2], TH = Number(process.argv[3] ?? 0.5);
const f32 = f => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const a16 = f32(`${dir}/a16.f32`);
const { words } = JSON.parse(readFileSync(`${dir}/phones.json`));
const M = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const t0 = performance.now();
const model = await AutoModel.from_pretrained(M, { dtype: 'fp32' });
const fe = await AutoFeatureExtractor.from_pretrained(M);
// Gruppen
const groups = []; let cur = null;
words.forEach((w, i) => {
  if (w.as == null) return;
  const prev = cur && words[cur.idx.at(-1)];
  if (!cur || w.as - prev.ae > 0.25 || /[.!?]$/.test(prev.w) || w.ae - cur.s > 8) { cur = { s: w.as, e: w.ae, idx: [i] }; groups.push(cur); }
  else { cur.e = w.ae; cur.idx.push(i); }
});
const embs = [];
for (const g of groups) {
  const x = a16.subarray(Math.round(g.s * 16000), Math.round(g.e * 16000));
  if (x.length < 0.5 * 16000) { embs.push(null); continue; }
  const inp = await fe(x);
  const out = await model(inp);
  const v = Object.values(out)[0].data, n = Math.hypot(...v);
  embs.push(Float32Array.from(v, y => y / n));
}
console.error(`Einbettungen: ${((performance.now() - t0) / 1000).toFixed(1)} s für ${groups.length} Gruppen`);
// agglomerativ, durchschnittliche Verknüpfung, Kosinus-Abstand
let cl = embs.map((e, i) => (e ? { m: [i], c: e } : null)).filter(Boolean);
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const dist = (A, B) => { let s = 0; for (const i of A.m) for (const j of B.m) s += 1 - cos(embs[i], embs[j]); return s / (A.m.length * B.m.length); };
for (;;) {
  let best = Infinity, bi = -1, bj = -1;
  for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const d = dist(cl[i], cl[j]); if (d < best) { best = d; bi = i; bj = j; } }
  if (best > TH || bi < 0) break;
  cl[bi].m.push(...cl[bj].m); cl.splice(bj, 1);
}
cl.sort((a, b) => b.m.length - a.m.length);
const lab = new Map(); cl.forEach((c, k) => c.m.forEach(i => lab.set(i, k)));
groups.forEach((g, i) => console.log(`${g.s.toFixed(1).padStart(6)} ${lab.has(i) ? 'ABCDEFGH'[lab.get(i)] : '?'}  ${g.idx.map(k => words[k].w).join(' ')}`));
