// Slinky-Cut: eine schwere Analysestufe pro Worker. Die Seite startet für jede
// Stufe einen frischen Worker und beendet ihn danach – nur so gibt der Browser
// den WASM-Speicher der Modelle wieder frei (ein WASM-Heap schrumpft nie).
//
//   {task:'separate', a44:[L,R], a48} → {voice48, voice16, music48}
//   {task:'transcribe', a16, lang}    → {words, lang}   (lang 'auto': erkennt de/en)
//   {task:'speakers', a16, words}     → {spk}           (Sprecher-Nummer pro Wort, 0 = am meisten)
//   {task:'phonemes', a16}            → {post, V, vocab}

import { pipeline, AutoModel, AutoModelForCTC, AutoFeatureExtractor, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

env.allowLocalModels = false;
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.mjs';
const SEP_MODEL = 'https://huggingface.co/StemSplitio/htdemucs-ft-vocals-onnx/resolve/main/htdemucs_ft_vocals_fp16weights.onnx';
const ASR_MODEL = 'onnx-community/whisper-small_timestamped';
const PHONE_MODEL = 'qnighy/wav2vec2-xlsr-53-espeak-cv-ft-ONNX';
const SPEAKER_MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);
const progress = (step, frac, detail = '') => post({ type: 'progress', step, frac, detail });
// Mehrere Dateien laden parallel (z. B. Encoder und Decoder): ein gemeinsamer Balken
const downloads = (step, what) => {
  const files = new Map();
  return p => {
    if (p.status !== 'progress' || !(p.total > 1e5)) return;
    files.set(p.file, p);
    let got = 0, total = 0;
    for (const f of files.values()) { got += f.loaded; total += f.total; }
    if (total > 1e6) progress(step, got / total, `downloading ${what} (${(got / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB)`);
  };
};

self.onmessage = async ({ data: m }) => {
  try {
    if (m.task === 'separate') {
      const r = await separateVoice(m.a44, m.a48);
      post({ type: 'result', ...r }, [r.voice48.buffer, r.voice16.buffer, r.music48.buffer]);
    } else if (m.task === 'transcribe') {
      post({ type: 'result', ...await transcribe(m.a16, m.lang) });
    } else if (m.task === 'speakers') {
      post({ type: 'result', spk: await speakers(m.a16, m.words) });
    } else if (m.task === 'phonemes') {
      const r = await posteriors(m.a16);
      post({ type: 'result', ...r }, [r.post.buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: err?.message ?? String(err), stack: err?.stack });
  }
};

// ---------- 1. Stimme/Musik trennen ----------
async function separateVoice(a44, a48) {
  const ort = await import(ORT_URL);
  ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 4);
  progress('separate', 0, 'downloading separation model (166 MB)');
  const buf = await fetchWithProgress(SEP_MODEL, f => progress('separate', f * 0.999, 'downloading separation model (166 MB)'));
  const sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled', enableCpuMemArena: false, enableMemPattern: false });
  const SR = 44100, SEG = Math.round(7.8 * SR), OVER = SEG >> 2, STRIDE = SEG - OVER;
  const [L, R] = a44, N = L.length;
  const win = new Float32Array(SEG).fill(1);
  for (let i = 0; i < OVER; i++) { win[i] = i / OVER; win[SEG - 1 - i] = i / OVER; }
  const voc = new Float32Array(N), wsum = new Float32Array(N);
  const chunks = Math.ceil(N / STRIDE), t0 = performance.now();
  for (let c = 0; c < chunks; c++) {
    const start = c * STRIDE, end = Math.min(start + SEG, N), len = end - start;
    const x = new Float32Array(2 * SEG);
    x.set(L.subarray(start, end), 0); x.set(R.subarray(start, end), SEG);
    const { stems } = await sess.run({ mix: new ort.Tensor('float32', x, [1, 2, SEG]) });
    const s = stems.data, V = 3;                              // Index 3 = Stimme
    for (let i = 0; i < len; i++) {
      voc[start + i] += (s[(V * 2) * SEG + i] + s[(V * 2 + 1) * SEG + i]) / 2 * win[i];
      wsum[start + i] += win[i];
    }
    const el = (performance.now() - t0) / 1000, done = (c + 1) / chunks;
    progress('separate', done, `${fmt(el / done - el)} left`);
  }
  await sess.release?.();
  for (let i = 0; i < N; i++) voc[i] /= Math.max(wsum[i], 1e-8);
  // auf 48 kHz und 16 kHz bringen; Musik = Mischung − Stimme
  const voice48 = resample(voc, SR, 48000), voice16 = resample(voc, SR, 16000);
  const music48 = new Float32Array(a48.length);
  for (let i = 0; i < music48.length; i++) music48[i] = a48[i] - (voice48[i] ?? 0);
  return { voice48, voice16, music48 };
}

/** Lineare Abtastratenwandlung mit einfachem Tiefpass (Mittelung) beim Verkleinern. */
function resample(x, from, to) {
  const n = Math.floor(x.length * to / from), y = new Float32Array(n), r = from / to;
  const w = Math.max(1, Math.round(r));
  for (let i = 0; i < n; i++) {
    const p = i * r, k = Math.floor(p);
    if (w > 1) { let s = 0; for (let j = 0; j < w; j++) s += x[k + j] ?? 0; y[i] = s / w; }
    else { const f = p - k; y[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f; }
  }
  return y;
}

async function fetchWithProgress(url, onProgress) {
  const c = await caches.open('slinky-models');
  let res = await c.match(url);
  if (!res) {
    const net = await fetch(url);
    if (!net.ok) throw new Error(`${url}: HTTP ${net.status}`);
    const total = Number(net.headers.get('content-length')) || 0, reader = net.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (total) onProgress(got / total);
    }
    const blob = new Blob(parts);
    await c.put(url, new Response(blob)).catch(() => {});
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ---------- 2. Transkript ----------
// Whisper sieht höchstens 30 s. Die Fenster enden in der leisesten Stelle (so
// schneidet kein Wort durch), Fenster ohne Sprache werden übersprungen – auf
// Stille erfindet Whisper sonst Sätze („Untertitel im Auftrag des ZDF“).
function windows(a16) {
  const SR = 16000, HOP = 160, n = Math.floor(a16.length / HOP), E = new Float32Array(n);
  for (let f = 0; f < n; f++) { let e = 0; for (let i = 0; i < HOP; i++) e += a16[f * HOP + i] ** 2; E[f] = 10 * Math.log10(e / HOP + 1e-10); }
  const sorted = Float32Array.from(E).sort(), loud = sorted[Math.floor(n * 0.95)];
  const smooth = f => { let s = 0, k = 0; for (let d = -10; d <= 10; d++) if (E[f + d] != null) { s += E[f + d]; k++; } return s / k; };
  const out = [];
  for (let s = 0; s < n;) {
    let e = Math.min(n, s + 2850);
    if (e < n) {
      let best = Infinity, cut = e;
      for (let f = s + 1800; f < e - 10; f++) { const v = smooth(f); if (v < best) { best = v; cut = f; } }
      e = cut;
    }
    let speech = 0;
    for (let f = s; f < e; f++) if (E[f] > loud - 30) speech++;
    if (speech >= 30) out.push([s * HOP, e * HOP]);            // mindestens 0,3 s Sprache
    s = e;
  }
  return out;
}

async function transcribe(a16, lang) {
  const asr = await pipeline('automatic-speech-recognition', ASR_MODEL, {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'wasm',
    progress_callback: downloads('transcribe', 'speech recognition model'),
  });
  const SR = 16000, wins = windows(a16), out = [];
  // Sprache erkennen: Whisper sagt nach dem Starttoken zuerst die Sprache voraus
  let detected = null;
  if (lang === 'auto') {
    const longest = wins.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a), wins[0] ?? [0, Math.min(a16.length, 30 * SR)]);
    const { input_features } = await asr.processor(a16.subarray(longest[0], longest[1]));
    const gc = asr.model.generation_config;
    const { logits } = await asr.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]) });
    const de = logits.data[gc.lang_to_id['<|de|>']], en = logits.data[gc.lang_to_id['<|en|>']];
    const best = Object.entries(gc.lang_to_id).reduce((a, b) => (logits.data[b[1]] > logits.data[a[1]] ? b : a));
    lang = de > en ? 'de' : 'en';
    detected = { lang, other: /<\|(de|en)\|>/.test(best[0]) ? null : best[0].slice(2, -2) };
    post({ type: 'lang', ...detected });
  }
  const total = wins.reduce((a, [s, e]) => a + e - s, 0);
  let done = 0;
  const t0 = performance.now();
  for (const [s, e] of wins) {
    // 1 s Stille dahinter: sonst lässt Whisper die letzten Wörter eines Fensters gern weg
    const chunk = new Float32Array(e - s + SR);
    chunk.set(a16.subarray(s, e));
    const r = await asr(chunk, { language: lang === 'de' ? 'german' : 'english', task: 'transcribe', return_timestamps: 'word' });
    const off = s / SR, len = (e - s) / SR;
    for (const c of r.chunks ?? []) {
      const ws = c.timestamp[0] ?? 0, we = c.timestamp[1] ?? ws;
      if (!c.text.trim() || ws > len + 0.2) continue;            // Zeitstempel außerhalb des Fensters: erfunden
      out.push({ w: c.text.trim(), s: off + ws, e: off + Math.min(len, Math.max(we, ws + 0.05)) });
    }
    done += e - s;
    const el = (performance.now() - t0) / 1000;
    progress('transcribe', done / total, `${fmt(el / (done / total) - el)} left`);
  }
  await asr.dispose?.();
  return { words: out, lang };
}

// ---------- 2b. Sprecher ----------
// Atemgruppen (Wörter ohne längere Pause dazwischen) bekommen je eine
// Stimm-Einbettung (WeSpeaker ResNet34); ähnliche Gruppen werden zusammengefasst.
async function speakers(a16, words) {
  const SR = 16000;
  const groups = [];
  let cur = null;
  words.forEach((w, i) => {
    const prev = cur && words[cur.idx.at(-1)];
    if (!cur || w.s - prev.e > 0.25 || /[.!?]$/.test(prev.w) || w.e - cur.s > 8) { cur = { s: w.s, e: w.e, idx: [i] }; groups.push(cur); }
    else { cur.e = w.e; cur.idx.push(i); }
  });
  const spk = new Array(words.length).fill(0);
  if (groups.length < 2) return spk;
  const model = await AutoModel.from_pretrained(SPEAKER_MODEL, { dtype: 'fp32', device: 'wasm', progress_callback: downloads('speakers', 'voice model'),
    session_options: { enableCpuMemArena: false, enableMemPattern: false } });
  const fe = await AutoFeatureExtractor.from_pretrained(SPEAKER_MODEL);
  // Immer gleich lange Stücke (2 s): Wechselnde Eingabegrößen lassen den
  // WASM-Speicher von ONNX Runtime bei jedem Aufruf weiter wachsen.
  const WIN = 2 * SR, embs = [];
  for (let g = 0; g < groups.length; g++) {
    const x = a16.subarray(Math.round(groups[g].s * SR), Math.round(groups[g].e * SR));
    if (x.length < 0.5 * SR) { embs.push(null); continue; }
    const sum = new Float32Array(256);
    for (let o = 0; o < x.length; o += WIN) {
      if (o > 0 && x.length - o < 0.7 * SR) break;               // kurzer Rest: zählt nicht
      const w = new Float32Array(WIN);
      for (let i = 0; i < WIN; i++) w[i] = x[o + (i % Math.min(WIN, x.length - o))];   // zu kurz: wiederholen
      const out = await model(await fe(w));
      const v = Object.values(out)[0].data, n = Math.hypot(...v) || 1;
      for (let i = 0; i < Math.min(256, v.length); i++) sum[i] += v[i] / n;
    }
    const n = Math.hypot(...sum) || 1;
    embs.push(sum.map(y => y / n));
    progress('speakers', (g + 1) / groups.length, '');
  }
  await model.dispose?.();
  const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const long = (i) => groups[i].e - groups[i].s >= 1.2;
  // 1. lange Gruppen agglomerativ (mittlerer Kosinus-Abstand < 0,5)
  let cl = embs.map((e, i) => (e && long(i) ? { m: [i] } : null)).filter(Boolean);
  const dist = (A, B) => { let s = 0; for (const i of A.m) for (const j of B.m) s += 1 - cos(embs[i], embs[j]); return s / (A.m.length * B.m.length); };
  for (;;) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const d = dist(cl[i], cl[j]); if (d < best) { best = d; bi = i; bj = j; } }
    if (best > 0.5 || bi < 0) break;
    cl[bi].m.push(...cl[bj].m); cl.splice(bj, 1);
  }
  const secs = c => c.m.reduce((a, i) => a + groups[i].e - groups[i].s, 0);
  // 2. Winzlinge (unter 3 s Sprechzeit) dem nächsten großen Sprecher zuschlagen
  const big = cl.filter(c => secs(c) >= 3);
  if (!big.length) return spk;
  for (const c of cl) if (!big.includes(c)) {
    const near = big.reduce((a, b) => (dist(c, b) < dist(c, a) ? b : a));
    near.m.push(...c.m);
  }
  big.sort((a, b) => secs(b) - secs(a));
  const lab = new Map();
  big.forEach((c, k) => c.m.forEach(i => lab.set(i, k)));
  // 3. kurze Gruppen: zum nächsten Sprecher; ohne Einbettung: wie die Nachbargruppe
  groups.forEach((g, i) => {
    if (lab.has(i)) return;
    if (embs[i]) lab.set(i, big.reduce((a, b, k) => (dist({ m: [i] }, b) < dist({ m: [i] }, big[a]) ? k : a), 0));
  });
  groups.forEach((g, i) => { if (!lab.has(i)) lab.set(i, lab.get(i - 1) ?? lab.get(i + 1) ?? 0); });
  groups.forEach((g, i) => g.idx.forEach(w => { spk[w] = lab.get(i); }));
  return spk;
}

// ---------- 3. Phoneme ----------
async function posteriors(a16) {
  const model = await AutoModelForCTC.from_pretrained(PHONE_MODEL, { dtype: 'q4', device: 'wasm', progress_callback: downloads('phonemes', 'sound model') });
  const fe = await AutoFeatureExtractor.from_pretrained(PHONE_MODEL);
  const vocabMap = await (await fetch(`https://huggingface.co/${PHONE_MODEL}/raw/main/vocab.json`)).json();
  const vocab = Object.entries(vocabMap).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  const SR = 16000, HOP = 320, CHUNK = 20 * SR, PAD = SR, V = vocab.length;
  const frames = Math.floor(a16.length / HOP), P = new Float32Array(frames * V).fill(-1e9);
  const t0 = performance.now();
  for (let start = 0; start < a16.length; start += CHUNK) {
    const a = Math.max(0, start - PAD), b = Math.min(a16.length, start + CHUNK + PAD);
    const { input_values } = await fe(a16.subarray(a, b));
    const { logits } = await model({ input_values });
    const [, T] = logits.dims, L = logits.data;
    for (let f = 0; f < T; f++) {
      const g = Math.round((a + f * HOP) / HOP);
      if (g * HOP < start || g * HOP >= start + CHUNK || g >= frames) continue;
      let max = -Infinity;
      for (let v = 0; v < V; v++) max = Math.max(max, L[f * V + v]);
      let sum = 0;
      for (let v = 0; v < V; v++) sum += Math.exp(L[f * V + v] - max);
      const lse = max + Math.log(sum);
      for (let v = 0; v < V; v++) P[g * V + v] = L[f * V + v] - lse;
    }
    const done = Math.min(1, (start + CHUNK) / a16.length), el = (performance.now() - t0) / 1000;
    progress('phonemes', done, `${fmt(el / done - el)} left`);
  }
  await model.dispose?.();
  return { post: P, V, vocab };
}

const fmt = s => (!isFinite(s) ? '…' : s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);
