// Aussprache-Güte (GOP) je Ziellaut: Das Phonemmodell (wav2vec2-xlsr-espeak) hört den Clip,
// die Ziellaute werden per CTC hineingezwungen; je Laut zählt, wie weit seine Wahrscheinlichkeit
// unter der des besten Konkurrenten liegt (0 = klar dieser Laut, −5 = klar ein anderer).
// Findet „Fase“ statt „Hase“, „rott“ statt „rot“, fehlende Plosive – lokal und gratis.
//   node loop/gop.mjs        (im Ordner spike; Kalibrierungs-Set, vergleicht mit noten.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AutoModelForCTC, AutoFeatureExtractor, env } from '@huggingface/transformers';
import { espeak, tokenize, phoneVocab } from '../g2p.mjs';

env.cacheDir = new URL('../models/', import.meta.url).pathname;
const MODEL = 'qnighy/wav2vec2-xlsr-53-espeak-cv-ft-ONNX';
let model, fe, vocab, pv, index;
export async function loadGop() {
  model = await AutoModelForCTC.from_pretrained(MODEL, { dtype: 'q4', device: 'cpu' });
  fe = await AutoFeatureExtractor.from_pretrained(MODEL);
  vocab = JSON.parse(readFileSync(new URL('../media/dino/post.json', import.meta.url))).vocab;
  pv = phoneVocab(vocab);
  index = new Map(vocab.map((t, i) => [t, i]));
}

/** Ziellaute je Wort (espeak, Tokens im Vokabular des Modells). */
export function targetWords(text, lang = 'de') {
  const words = text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  return espeak(words, lang).map((ipa, i) => ({ w: words[i], toks: tokenize(ipa, pv).map(x => x.t).filter(t => index.has(t)) }));
}

/** a16: Float32 16 kHz. → { words: [{w, gop: [..], min}], mean, min, bad, heard } */
export async function gop(a16, text, lang = 'de') {
  const { input_values } = await fe(a16);
  const { logits } = await model({ input_values });
  const [, T, V] = logits.dims, L = logits.data;
  // log-softmax
  const lp = new Float32Array(T * V), best = new Float32Array(T);
  for (let f = 0; f < T; f++) {
    let m = -Infinity; for (let v = 0; v < V; v++) m = Math.max(m, L[f * V + v]);
    let s = 0; for (let v = 0; v < V; v++) s += Math.exp(L[f * V + v] - m);
    const z = m + Math.log(s);
    let b = -Infinity; for (let v = 0; v < V; v++) { lp[f * V + v] = L[f * V + v] - z; if (v && lp[f * V + v] > b) b = lp[f * V + v]; }
    best[f] = b;
  }
  const tw = targetWords(text, lang), toks = tw.flatMap((w, wi) => w.toks.map(t => ({ t, wi, id: index.get(t) })));
  // CTC-Viterbi: Zustände blank, t0, blank, t1, …
  const S = 2 * toks.length + 1, NEG = -1e9;
  const D = new Float32Array(T * S).fill(NEG), B = new Int8Array(T * S);
  const em = (f, s) => lp[f * V + (s % 2 === 0 ? 0 : toks[(s - 1) >> 1].id)];
  D[0] = em(0, 0); if (S > 1) D[1] = em(0, 1);
  for (let f = 1; f < T; f++) for (let s = 0; s < S; s++) {
    let v = D[(f - 1) * S + s], k = 0;
    if (s > 0 && D[(f - 1) * S + s - 1] > v) { v = D[(f - 1) * S + s - 1]; k = 1; }
    if (s > 1 && s % 2 === 1 && toks[(s - 1) >> 1].id !== toks[(s - 3) >> 1]?.id && D[(f - 1) * S + s - 2] > v) { v = D[(f - 1) * S + s - 2]; k = 2; }
    D[f * S + s] = v + em(f, s); B[f * S + s] = k;
  }
  let s = D[(T - 1) * S + S - 1] > D[(T - 1) * S + S - 2] ? S - 1 : S - 2;
  const frames = toks.map(() => []);
  for (let f = T - 1; f >= 0; f--) { if (s % 2 === 1) frames[(s - 1) >> 1].push(f); s -= B[f * S + s]; }
  // GOP je Laut: bester Frame des Lauts (CTC feuert spitz), Abstand zum besten anderen Laut
  const g = toks.map((tk, i) => Math.max(...frames[i].map(f => lp[f * V + tk.id] - best[f])));
  const words = tw.map((w, wi) => { const x = g.filter((_, i) => toks[i].wi === wi); return { w: w.w, toks: w.toks, gop: x.map(v => +v.toFixed(1)), min: x.length ? Math.min(...x) : 0 }; });
  // was frei gehört wird
  const heard = []; let prev = -1;
  for (let f = 0; f < T; f++) { let b = 0; for (let v = 1; v < V; v++) if (lp[f * V + v] > lp[f * V + b]) b = v; if (b !== prev && b) heard.push(vocab[b]); prev = b; }
  return { words, mean: g.reduce((a, x) => a + x, 0) / Math.max(1, g.length), min: Math.min(...g), bad: g.filter(x => x < -3).length, badShare: g.filter(x => x < -3).length / Math.max(1, g.length), worstWord: Math.min(...words.map(w => w.min)), heard: heard.join(' ') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const K = new URL('../out/kalibrierung/', import.meta.url);
  const key = JSON.parse(readFileSync(new URL('key.json', K)));
  const read16 = f => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };
  await loadGop();
  const rows = [];
  for (const k of key) {
    const r = await gop(read16(new URL(`${String(k.n).padStart(2, '0')}.wav`, K).pathname), k.text);
    rows.push({ n: k.n, ...r });
    console.log(String(k.n).padStart(2), `mittel ${r.mean.toFixed(2)} min ${r.min.toFixed(1)} schlecht ${r.bad}`, r.words.map(w => `${w.w}[${w.toks.map((t, i) => `${t}${w.gop[i] < -3 ? '✗' : ''}`).join('')}]`).join(' '));
  }
  writeFileSync(new URL('gop.json', K), JSON.stringify(rows, null, 1));
  const notes = new URL('noten.json', K);
  if (existsSync(notes)) {
    const N = JSON.parse(readFileSync(notes));
    const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let q = i; q <= j; q++) r[idx[q][1]] = (i + j) / 2; i = j + 1; } return r; };
    const spear = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length, ma = ra.reduce((x, y) => x + y) / n, mb = rb.reduce((x, y) => x + y) / n; let s2 = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s2 += (ra[i] - ma) * (rb[i] - mb); sa += (ra[i] - ma) ** 2; sb += (rb[i] - mb) ** 2; } return s2 / Math.sqrt(sa * sb + 1e-12); };
    const have = rows.filter(r => N[r.n] != null), gr = have.map(r => +N[r.n]);
    console.log(`\nRangkorrelation mit den Noten (n=${have.length}; − = niedriger GOP ↔ schlechtere Note):`);
    for (const m of ['mean', 'min', 'bad', 'badShare', 'worstWord']) console.log(`  ${m.padEnd(10)} ${spear(have.map(r => r[m]), gr).toFixed(2)}`);
  }
}
