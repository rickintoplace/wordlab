// Kandidaten für ein Qualitätsmaß (nicht nur Verständlichkeit): Messwerte an den Schnitten
// und ein Audiomodell, das Natürlichkeit benotet. Welche davon mit dem Ohr übereinstimmen,
// klärt loop/kalib.mjs anhand der Noten aus dem Hörtest.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeWav } from '../../public/slinky/engine.js';

const SR = 48000;
const db = (x, a, b) => { let e = 1e-10; a = Math.max(0, a); b = Math.min(x.length, b); for (let i = a; i < b; i++) e += x[i] * x[i]; return 10 * Math.log10(e / Math.max(1, b - a)); };

/** Grundfrequenz (Hz) per Autokorrelation in einem 40-ms-Fenster, 0 = stimmlos. */
function f0(x, c) {
  const n = 1920, a = Math.max(0, c - n / 2), lo = Math.round(SR / 400), hi = Math.round(SR / 70);
  if (a + n + hi > x.length) return 0;
  let e0 = 0; for (let i = 0; i < n; i++) e0 += x[a + i] * x[a + i];
  if (e0 < 1e-5 * n) return 0;
  let best = 0, lag = 0;
  for (let L = lo; L <= hi; L += 2) {
    let s = 0, e1 = 0; for (let i = 0; i < n; i += 2) { s += x[a + i] * x[a + i + L]; e1 += x[a + i + L] * x[a + i + L]; }
    const r = s / Math.sqrt(e0 / 2 * e1 + 1e-12);
    if (r > best) { best = r; lag = L; }
  }
  return best > 0.6 ? SR / lag : 0;
}

/** Grobes Spektrum (Log-Energie in 16 Bändern bis 8 kHz) eines 20-ms-Fensters. */
function bands(x, c) {
  const n = 960, a = c - n / 2, out = new Float64Array(16);
  if (a < 0 || a + n > x.length) return null;
  // Goertzel-artige Bandenergie: DFT an je 4 Frequenzen pro Band
  for (let b = 0; b < 16; b++) {
    let e = 1e-10;
    for (let k = 0; k < 4; k++) {
      const f = (b * 500 + k * 125 + 62) / SR * 2 * Math.PI;
      let re = 0, im = 0;
      for (let i = 0; i < n; i += 2) { const w = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); re += w * Math.cos(f * i); im += w * Math.sin(f * i); }
      e += re * re + im * im;
    }
    out[b] = 10 * Math.log10(e);
  }
  return out;
}

/**
 * Messwerte an den Schnitten. pieces: [{at (s im Ausgang), len}] wie aus describe().
 * Pegel- und Tonhöhensprung je Schnitt, Spektralsprung im Verhältnis zur normalen
 * Änderung innerhalb der Stücke; dazu Stücke pro Sekunde.
 */
export function joinMetrics(audio, pieces) {
  const dur = audio.length / SR, joins = [];
  for (let k = 1; k < pieces.length; k++) {
    const t = Math.round(pieces[k].at * SR), prevEnd = Math.round((pieces[k - 1].at + pieces[k - 1].len) * SR);
    if (t - prevEnd > 0.03 * SR) continue; // Pause dazwischen
    const before = db(audio, t - 960, t), after = db(audio, t, t + 960);
    if (Math.max(before, after) < -50) continue; // in der Stille
    const fa = f0(audio, t - 1200), fb = f0(audio, t + 1200);
    const sa = bands(audio, t - 600), sb = bands(audio, t + 600);
    let spec = 0; if (sa && sb) { for (let b = 0; b < 16; b++) spec += (sa[b] - sb[b]) ** 2; spec = Math.sqrt(spec / 16); }
    joins.push({ t: t / SR, level: Math.abs(before - after), pitch: fa && fb ? Math.abs(12 * Math.log2(fa / fb)) : null, spec });
  }
  // Bezug: Spektraländerung über 20 ms mitten in den Stücken
  const ref = [];
  for (const p of pieces) for (let t = p.at + 0.03; t < p.at + p.len - 0.03; t += 0.04) {
    const c = Math.round(t * SR), sa = bands(audio, c - 600), sb = bands(audio, c + 600);
    if (!sa || !sb || db(audio, c - 480, c + 480) < -50) continue;
    let s = 0; for (let b = 0; b < 16; b++) s += (sa[b] - sb[b]) ** 2; ref.push(Math.sqrt(s / 16));
  }
  const med = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const max = a => Math.max(0, ...a.filter(v => v != null));
  const mean = a => { const s = a.filter(v => v != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : 0; };
  const refSpec = med(ref) || 1;
  const P = joins.map(j => j.pitch);
  return {
    joinsPerSec: joins.length / Math.max(0.3, dur),
    levelMean: mean(joins.map(j => j.level)), levelMax: max(joins.map(j => j.level)),
    pitchMean: mean(P), pitchMax: max(P), pitchBig: P.filter(v => v != null && v > 2).length / Math.max(0.3, dur),
    specMean: mean(joins.map(j => j.spec)) / refSpec, specMax: max(joins.map(j => j.spec)) / refSpec,
    joins,
  };
}

// ---------- Audiomodell benotet Natürlichkeit ----------
const key = readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
const CACHE = new URL('./cache/', import.meta.url);
mkdirSync(CACHE, { recursive: true });
export const spent = { usd: 0 };
const PROMPT = `You are a strict listening judge for German speech that was cut together from pieces of other recordings of the same speaker. Rate how natural it sounds as if the speaker had really said it in one go.
Grade like a German school grade: 1 = sounds completely natural, 2 = good, small flaw, 3 = clearly edited but fine, 4 = several obvious problems, 5 = bad, 6 = barely speech.
Listen for: audible cuts or clicks, choppy rhythm or tempo jumps, jumps in pitch, loudness or room sound, clipped, swallowed or doubled sounds, wrong vowel length, wrong stress, robotic or slurred parts.
Reply as JSON: {"grade": <number>, "problems": "<short list, quote the affected words as heard>"}`;

export async function rate(a48, model, seed = 1) {
  const n = Math.floor(a48.length / 3), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (a48[3 * i] + a48[3 * i + 1] + a48[3 * i + 2]) / 3;
  const b64 = Buffer.from(encodeWav(x, 16000)).toString('base64');
  const h = createHash('sha1').update(model + seed + PROMPT + b64).digest('hex').slice(0, 16);
  const file = new URL(`q-${h}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await (globalThis.__realFetch ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Slinky-Cut judge' },
        body: JSON.stringify({ model, temperature: 0.3, seed, usage: { include: true }, response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'input_audio', input_audio: { data: b64, format: 'wav' } }] }] }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const j = await res.json();
      spent.usd += j.usage?.cost ?? 0;
      const c = (j.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?|```$/gm, '').trim();
      let r; try { r = JSON.parse(c); } catch { r = { grade: +(c.match(/"grade"\s*:\s*([\d.]+)/)?.[1] ?? NaN), problems: c.slice(0, 200) }; }
      r = { grade: +r.grade, problems: String(r.problems ?? '') };
      writeFileSync(file, JSON.stringify(r));
      return r;
    } catch (e) { if (attempt === 2) throw e; await new Promise(r => setTimeout(r, 1500)); }
  }
}
