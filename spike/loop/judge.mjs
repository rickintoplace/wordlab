// Blinder Hörer für die Feedback-Schleife: Gemini Flash-Lite schreibt auf, was es hört (ohne den
// gemeinten Satz), mehrmals; Wertung = Anteil der Zielwörter, die genau so gehört werden.
// Ergebnisse werden je Ton (Hash) zwischengespeichert – gleiche Clips kosten nichts.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeWav } from '../../public/slinky/engine.js';

const key = readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
export const MODEL = 'google/gemini-3.5-flash-lite';
const CACHE = new URL('./cache/', import.meta.url);
mkdirSync(CACHE, { recursive: true });
const PROMPT = `Transcribe this German audio clip exactly as it sounds, letter-faithful in German spelling. It was cut together from pieces of other words, so it may contain non-words, wrong or missing sounds, wrong vowel length or clipped syllables – write what is really audible, do not guess real words.
Reply as JSON: {"heard": "…"}`;
export const cost = { spent: 0 };

/** 48-kHz-Ton → 16-kHz-WAV (Base64), einfache Mittelung über 3 Samples. */
function wav16(a48) {
  const n = Math.floor(a48.length / 3), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (a48[3 * i] + a48[3 * i + 1] + a48[3 * i + 2]) / 3;
  return Buffer.from(encodeWav(x, 16000)).toString('base64');
}

async function ask(b64, seed) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await (globalThis.__realFetch ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Slinky-Cut judge' },
        body: JSON.stringify({ model: MODEL, temperature: 0.6, seed, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT }, { type: 'input_audio', input_audio: { data: b64, format: 'wav' } }] }] }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      const j = await res.json();
      cost.spent += j.usage?.cost ?? 0;
      const c = j.choices?.[0]?.message?.content ?? '';
      try { return String(JSON.parse(c.replace(/^```(?:json)?|```$/gm, '').trim()).heard ?? ''); } catch { return c.slice(0, 200); }
    } catch (e) { if (attempt === 2) throw e; await new Promise(r => setTimeout(r, 1500)); }
  }
}

const norm = s => s.toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Wörter des Ziels, die (in Reihenfolge) genau gehört wurden, und Buchstaben-Ähnlichkeit. */
export function score(target, heard) {
  const a = norm(target), b = norm(heard);
  const L = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const words = a.length ? L[0][0] / a.length : 0;
  const lev = (x, y) => {
    const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  };
  const A = a.join(' '), B = b.join(' ');
  const chars = 1 - lev(A, B) / Math.max(1, A.length, B.length);
  return { words, chars };
}

/** Clip anhören lassen (n-mal, zwischengespeichert). → { heard: [..], words, chars } */
export async function judge(a48, target, n = 3) {
  const b64 = wav16(a48);
  const h = createHash('sha1').update(b64).digest('hex').slice(0, 16);
  const file = new URL(`${h}.json`, CACHE);
  const cached = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const heard = cached.slice(0, n);
  for (let k = heard.length; k < n; k++) heard.push(await ask(b64, 17 + k));
  if (heard.length > cached.length) writeFileSync(file, JSON.stringify(heard));
  const s = heard.map(x => score(target, x));
  return { heard, words: s.reduce((x, y) => x + y.words, 0) / n, chars: s.reduce((x, y) => x + y.chars, 0) / n };
}
