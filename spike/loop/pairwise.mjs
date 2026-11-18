// Automatischer Paarvergleich: Ein Audiomodell hört A und B desselben Satzes und sagt, welche
// Version besser klingt (beide Reihenfolgen, gegen Positionsvorlieben). Kalibriert an den
// Urteilen aus der Hörseite (out/hoertest/votes-all).
//   MODEL=google/gemini-3.8-flash node loop/pairwise.mjs [Anzahl]     (im Ordner spike)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { encodeWav } from '../../public/slinky/engine.js';

const key = readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();
const CACHE = new URL('./cache/', import.meta.url);
mkdirSync(CACHE, { recursive: true });
export const spent = { usd: 0 };

export const PROMPT = text => `You hear two versions, A and B, of the same German sentence. Both were cut together by a program from pieces of other recordings of one speaker. The intended sentence is: "${text}"
Decide which version a native German listener would prefer. Judge in this order of importance:
1. Is every sound the right one? Wrong vowel quality or length (e.g. "rott" for "rot", "Teuben" for "Tauben"), wrong, missing or swallowed consonants (e.g. "Fase" for "Hase", "dhocht" for "kocht", a stop without its burst).
2. Are syllables clipped, choppy or slurred, are there clicks?
3. Only then: intonation and stress.
Do not reward the version that merely seems to match the sentence better because you expect it; listen to the actual sounds. If you cannot hear a difference, say "same".
Reply as JSON: {"better": "A" | "B" | "same", "why": "<short, name the words>"}`;

const wav16b64 = f => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return Buffer.from(encodeWav(new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), 16000)).toString('base64');
};

/** Einmal fragen: liefert 'A' | 'B' | 'same' bezogen auf die übergebene Reihenfolge. */
export async function compare(model, text, a64, b64, extra = {}) {
  const body = { model, temperature: 0.2, usage: { include: true }, response_format: { type: 'json_object' }, ...extra,
    messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT(text) }, { type: 'text', text: 'Version A:' }, { type: 'input_audio', input_audio: { data: a64, format: 'wav' } }, { type: 'text', text: 'Version B:' }, { type: 'input_audio', input_audio: { data: b64, format: 'wav' } }] }] };
  const h = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  const file = new URL(`p-${h}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await (globalThis.__realFetch ?? fetch)('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Slinky-Cut judge' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      spent.usd += j.usage?.cost ?? 0;
      const c = (j.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?|```$/gm, '').trim();
      let r; try { r = JSON.parse(c); } catch { r = { better: c.match(/"better"\s*:\s*"(A|B|same)"/i)?.[1] ?? 'same', why: c.slice(0, 200) }; }
      r = { better: /^a$/i.test(r.better) ? 'A' : /^b$/i.test(r.better) ? 'B' : 'same', why: String(r.why ?? ''), cost: j.usage?.cost ?? 0 };
      writeFileSync(file, JSON.stringify(r));
      return r;
    } catch (e) { if (attempt === 2) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}

export const WORD_PROMPT = text => `This German audio clip was cut together by a program from pieces of other recordings of one speaker. The intended sentence is: "${text}"
Check every word of the intended sentence separately and strictly, like a phonetician. Listen to the actual sounds, not to what you expect: wrong vowel quality or length ("rott" for "rot", "Teuben" for "Tauben"), wrong, missing or swallowed consonants ("Fase" for "Hase", "dhocht" for "kocht", a stop without burst), clipped or slurred syllables, clicks.
Reply as JSON: {"words": [{"w": "<word>", "verdict": "ok" | "off" | "wrong", "heard": "<what it sounds like, in German spelling>"}]}`;

/** Einzeln, je Wort: Fehlerpunkte (ok 0, off 1, wrong 2) – keine Reihenfolge, keine Positionsvorliebe. */
export async function wordFaults(model, text, a64, extra = {}) {
  const body = { model, temperature: 0.2, usage: { include: true }, response_format: { type: 'json_object' }, ...extra,
    messages: [{ role: 'user', content: [{ type: 'text', text: WORD_PROMPT(text) }, { type: 'input_audio', input_audio: { data: a64, format: 'wav' } }] }] };
  const h = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  const file = new URL(`w-${h}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await (globalThis.__realFetch ?? fetch)('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Slinky-Cut judge' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      spent.usd += j.usage?.cost ?? 0;
      const c = (j.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?|```$/gm, '').trim();
      let words = []; try { words = JSON.parse(c).words ?? []; } catch {}
      const r = { faults: words.reduce((a, w) => a + (w.verdict === 'wrong' ? 2 : w.verdict === 'off' ? 1 : 0), 0), words };
      writeFileSync(file, JSON.stringify(r));
      return r;
    } catch (e) { if (attempt === 2) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}

/** Beide Reihenfolgen; Ergebnis −1 … 1 (positiv = X besser). */
export async function prefer(model, text, x64, y64, extra) {
  if (process.env.MODE === 'word') {
    const [x, y] = await Promise.all([wordFaults(model, text, x64, extra), wordFaults(model, text, y64, extra)]);
    const f = r => r.words.filter(w => w.verdict !== 'ok').map(w => `${w.w}→${w.heard}`).join(',');
    return { score: Math.sign(y.faults - x.faults), why: [f(x), f(y)] };
  }
  const [r1, r2] = await Promise.all([compare(model, text, x64, y64, extra), compare(model, text, y64, x64, extra)]);
  const v = r => (r === 'A' ? 1 : r === 'B' ? -1 : 0);
  return { score: (v(r1.better) - v(r2.better)) / 2, why: [r1.why, r2.why] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const MODEL = process.env.MODEL ?? 'google/gemini-3.8-flash';
  const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
  const limit = +(process.argv[2] ?? 999), PAR = +(process.env.PAR ?? 4);
  const H = new URL('../out/hoertest/', import.meta.url);
  const vdir = new URL('votes-all/votes/', H);
  const votes = readdirSync(vdir).map(f => JSON.parse(readFileSync(new URL(f, vdir), 'utf8'))).filter(v => v.choice !== 'same');
  const rounds = {};
  const items = votes.map(v => {
    const r = (rounds[v.round] ??= JSON.parse(readFileSync(new URL(`${v.round}.json`, H))));
    const it = r.items.find(x => x.id === v.item);
    return { ...it, human: v.choice === 'a' ? 1 : -1 };   // + = A besser
  }).sort((a, b) => a.id.localeCompare(b.id)).filter((_, i) => i % Math.max(1, Math.floor(votes.length / limit)) === 0).slice(0, limit);
  let agree = 0, decided = 0, n = 0, next = 0;
  const rows = [];
  await Promise.all(Array.from({ length: PAR }, async () => {
    while (next < items.length) {
      const it = items[next++];
      const p = await prefer(MODEL, it.text, wav16b64(new URL(it.a, H).pathname), wav16b64(new URL(it.b, H).pathname), extra);
      n++;
      if (p.score !== 0) { decided++; if (Math.sign(p.score) === it.human) agree++; }
      rows.push({ id: it.id, text: it.text, human: it.human, model: p.score, why: p.why });
    }
  }));
  for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) console.log(`${r.human > 0 ? 'A' : 'B'} ${r.model > 0 ? 'A' : r.model < 0 ? 'B' : '='}${r.model !== 0 && Math.sign(r.model) !== r.human ? ' ✗' : r.model ? ' ✓' : '  '} ${r.text.slice(0, 40).padEnd(40)} ${r.why.join(' / ').slice(0, 150)}`);
  console.log(`\n${MODEL}: ${n} Paare · entschieden ${decided} · davon wie du ${agree} (${(100 * agree / Math.max(1, decided)).toFixed(0)} %) · Kosten $${spent.usd.toFixed(4)}`);
  writeFileSync(new URL(`../out/hoertest/pairwise-${MODEL.replace(/\W+/g, '_')}.json`, import.meta.url), JSON.stringify(rows, null, 1));
}
