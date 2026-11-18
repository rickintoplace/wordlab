// Ein Sprachmodell mit Audio-Eingang hört geschnittene Sätze an (über OpenRouter).
//   node judge-audio.mjs modell liste.json      liste: [{file, text, truth?}]
// Ausgabe je Clip: was es hört, welche Wörter falsch klingen, Note 1–5 (Schulnote).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^OPENROUTER[-_]KEY=(.+)$/m)[1].trim();

const PROMPT = text => `You are a strict phonetics listener for a German sentence-mixing tool. The clip was cut together from pieces of other words, so it may contain wrong sounds, missing or extra sounds, wrong vowel length, clipped syllables or odd stress.
The clip is meant to say: "${text}"

1. "heard": write down exactly what is audible, letter-faithful in German spelling. Do NOT correct it towards the intended sentence – if it sounds like "Fase" instead of "Hase", write "Fase"; if a sound is missing, leave it out; if a vowel is too short or too long, show it ("Blasse", "Baaase").
2. "problems": for every word that does not sound right: {"word": intended word, "sounds_like": what it sounds like, "issue": short description (e.g. "h sounds like f", "t missing", "vowel too short", "extra p before f", "stress on 2nd syllable")}. Empty list if everything sounds right.
3. "grade": overall intelligibility and naturalness as a German school grade, 1 = perfect, 5 = unintelligible.
Reply as JSON: {"heard": "…", "problems": [...], "grade": n}`;

// Blind: ohne den gemeinten Satz (sonst „hört“ das Modell, was es erwartet)
const BLIND = `Transcribe this German audio clip exactly as it sounds, letter-faithful in German spelling. It was cut together from pieces of other words, so it may contain non-words, wrong or missing sounds, wrong vowel length or clipped syllables – write what is really audible, do not guess real words. Mark clearly long vowels by doubling (e.g. "Baase") only if they are unusually long.
Reply as JSON: {"heard": "…"}`;

const BLIND_IPA = `Transcribe this German audio clip exactly as it sounds. It was cut together from pieces of other words, so it may contain non-words, wrong or missing sounds, wrong vowel length, clipped syllables or odd stress – write what is really audible, do not guess real words.
Give it twice: letter-faithful in German spelling, and as a narrow IPA transcription (with vowel length ː and stress ˈ).
Reply as JSON: {"heard": "…", "ipa": "…"}`;

/** WAV-Datei → 16 kHz mono WAV als Base64 (klein, reicht für Sprache). */
function wav16(file) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'wav', '-'], { maxBuffer: 1 << 26 }).toString('base64');
}

export async function judgeClip(model, file, text) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Slinky-Cut judge' },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [
      { type: 'text', text: process.env.IPA ? BLIND_IPA : process.env.BLIND ? BLIND : PROMPT(text) },
      { type: 'input_audio', input_audio: { data: wav16(file), format: 'wav' } },
    ] }] }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content ?? '';
  let out;
  try { out = JSON.parse(content.replace(/^```(?:json)?|```$/gm, '').trim()); } catch { out = { heard: content.slice(0, 120), problems: [], grade: null }; }
  return { ...out, cost: j.usage?.cost ?? 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [model, list] = process.argv.slice(2);
  const clips = JSON.parse(readFileSync(list, 'utf8'));
  let cost = 0;
  const t0 = Date.now();
  for (const c of clips) {
    const r = await judgeClip(model, c.file, c.text).catch(e => ({ heard: 'FEHLER ' + e.message, problems: [], grade: null, cost: 0 }));
    cost += r.cost;
    console.log(`${String(r.grade ?? '?').padStart(2)}  ${c.text}  →  „${r.heard}“${r.ipa ? `  [${r.ipa}]` : ''}${c.truth ? `\n      Ohr: ${c.truth}` : ''}`);
    for (const p of r.problems ?? []) console.log(`      · ${p.word}: ${p.sounds_like ?? ''} (${p.issue ?? ''})`);
  }
  console.log(`${model}: ${clips.length} Clips, ${((Date.now() - t0) / 1000).toFixed(0)} s, $${cost.toFixed(5)}`);
}
