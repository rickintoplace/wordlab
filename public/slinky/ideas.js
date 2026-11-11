// Satzideen per Sprachmodell (OpenRouter). Reiner Code ohne DOM, damit Seite und
// Testskripte denselben Prompt benutzen.

/** Günstig und beliebt (Nov. 2026): Eingabe kostet fast nichts, der Wortschatz ist lang. */
export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017';

const SYSTEM = `You write YouTube Poop (YTP) sentence mixes. Sentence mixing re-cuts real footage word by word so the speaker seems to say things they never said. The joke is always the contrast with how they normally sound: the more serious the speaker, the dumber the line.

What makes a good YTP line:
- one clear joke per line: a twist on the last word, an embarrassing confession, a rude insult, a bizarre demand, a solemn statement about something stupid, the narrator talking about himself or the viewer
- crude, vulgar, profane and toilet humour, cheap innuendo, swearing – said in the same calm documentary voice
- swapped roles: who does what to whom – but at most one line of this kind; find other jokes too
- near-miss words: change or add one sound of a word the speaker says to get a ruder or sillier one ("hinten" → "Hintern", "Wurzeln" → "Wurst", "pan" → "pants"). The tool builds these well, because almost all of their sounds are already there. This is one of the best YTP tricks: use it in several lines.
- real sentences: grammatical (articles, endings and word order right), so the listener understands the joke at once. Absurd content, correct form. A garbled word salad is not funny.
- no stutter loops ("die die die") – they rarely work
- timing: a dramatic pause before the punchline sells it. Write "…" where the speaker should stop for a moment before the last word or phrase ("Und dann kam die Beute … Scheiße."). The tool turns "…" into a real pause. Use it in a few lines, not in all.
- contrast: a long, serious, complicated build-up followed by something very short and stupid
Short and punchy beats long. Do not explain jokes. Every line must be different in structure and joke – not ten variations of one idea. Make at least half of them rude, gross or profane: YTP is not polite. Skip lines that are merely odd: if a line would not make a teenager laugh or groan, drop it.

Recombine, don't quote: build each line from chunks of one to three words taken exactly as they stand in the transcript ("im Wasser", "die ganze", "haben Hunger"), glued together from different places. Chunks keep their natural melody, so a line made of a few chunks sounds far more natural than one made of single words from everywhere. But never keep more than three words in a row from the original, and never keep its meaning. A line that could appear in the original is a failed line.

Pattern examples (from a cooking show, not your vocabulary):
original: "Now we add the butter slowly to the warm pan"
good: "We add the pan. Slowly. Now butter me"
good: "Slowly add the butter to my pants"  ("pants" is "pan" + s: a near-miss word)
good: "the butter is shit"  ("shit" is built from "ship" + "it")
bad: "Now we slowly add the warm butter"  (just the original)
bad: "the warm pan butter slowly the now"  (word salad)

How the tool works: words from the vocabulary list (in exactly that form, same ending) are cut out whole and sound perfect. A word that is not in the list gets stitched together from syllables and sounds of words the speaker does say. That works when those syllables exist – short words whose pieces appear in the vocabulary – and turns to mush otherwise; the tool tests every line and drops the mushy ones. So: build most of each line from the vocabulary, and add at most two words per line that are not in it, where the joke needs them (swear words are worth it). Pick such words so that their syllables occur in the vocabulary.

Keep it obvious parody: absurd, never a believable real statement. No slurs against groups of people, and nothing sexual involving children.`;

/** Wortschatz eines Sprechers, häufige Formen zuerst. */
export function vocabulary(words, max = 1500) {
  const freq = new Map();
  for (const w of words) {
    const k = w.w.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (k) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  return [...freq].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/** Nachrichten für die Chat-Anfrage. `words` = [{w}] des gewählten Sprechers. */
export function ideaMessages({ words, lang, topic = '', count = 10 }) {
  const vocab = vocabulary(words);
  const step = Math.max(1, Math.ceil(words.length / 1200));
  const sample = words.filter((_, i) => i % step === 0).map(w => w.w).join(' ');
  const language = lang === 'de' ? 'German' : 'English';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Language: ${language}.
${topic ? `Theme or target of the jokes: ${topic}\n` : ''}Write ${count} different lines, 2 to 10 words each, mostly from the vocabulary below (at most two other words per line).
Order them funniest first. Reply as JSON: {"lines": ["…", "…"]}

Vocabulary (most frequent first):
${vocab.join(', ')}

What the speaker actually says (so you know their tone):
${sample}` },
  ];
}

/** Rückfrage, wenn Zeilen Wörter enthielten, die es nicht gibt. */
export function repairMessages(messages, content, dropped, count) {
  const list = dropped.slice(0, 12).map(d => `"${d.text}" – not in the vocabulary: ${d.missing.join(', ')}`).join('\n');
  return [...messages, { role: 'assistant', content }, { role: 'user', content: `These lines use too many words that are not in the vocabulary (at most two per line):
${list}
Write ${count} new lines (same style, funniest first), mostly from the vocabulary. Reply as JSON: {"lines": ["…"]}` }];
}

/**
 * Ideen holen; Zeilen mit mehr als zwei Wörtern, die im Video nicht vorkommen,
 * fallen weg (sind es zu wenige, einmal nachfragen). Ob die gebauten Wörter
 * taugen, zeigt erst der Schnitt (buildCost). → { lines, dropped, cost }
 */
export async function generateIdeas({ key, model = DEFAULT_MODEL, words, lang, topic = '', count = 16, want = 8, fetchFn = fetch, onStatus = () => {} }) {
  const messages = ideaMessages({ words, lang, topic, count });
  onStatus('Asking the model…');
  let { content, usage } = await askOpenRouter({ key, model, messages, fetchFn });
  let cost = usage?.cost ?? 0;
  let { ok, dropped } = usableLines(parseLines(content, 40), words, 2);
  const allDropped = [...dropped];
  if (ok.length < want && dropped.length) {
    onStatus(`Only ${ok.length} ideas fit the vocabulary – asking for more…`);
    const r = await askOpenRouter({ key, model, messages: repairMessages(messages, content, dropped, count), fetchFn });
    cost += r.usage?.cost ?? 0;
    const more = usableLines(parseLines(r.content, 40), words, 2);
    ok = [...new Set([...ok, ...more.ok])];
    allDropped.push(...more.dropped);
  }
  return { lines: ok, dropped: allDropped, cost };
}

/** Nachrichten für „diese Stelle mit KI umschreiben“: Ausgangszeile + Wortschatz. */
export function rewriteMessages({ words, lang, line, count = 10 }) {
  const vocab = vocabulary(words);
  const language = lang === 'de' ? 'German' : 'English';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Language: ${language}.
The speaker says this in the video: "${line}"
Write ${count} YTP versions of this line. Vary how far you go: a few versions change only one or two words (a ruder near-miss word, a swapped object, a twisted ending), others keep only some chunks of it and say something entirely different, or reorder its chunks. Each version needs its own joke – not the same sentence frame with different last words – and none may mean what the original means. Use words from the vocabulary below for anything new (at most two words per line that are not in it).
Order them funniest first. Reply as JSON: {"lines": ["…", "…"]}

Vocabulary (most frequent first):
${vocab.join(', ')}` },
  ];
}

/** Umschreibungen holen (wie generateIdeas, mit Rückfrage bei zu vielen fremden Wörtern). */
export async function rewriteIdeas({ key, model = DEFAULT_MODEL, words, lang, line, count = 10, want = 5, fetchFn = fetch }) {
  const messages = rewriteMessages({ words, lang, line, count });
  const { content, usage } = await askOpenRouter({ key, model, messages, fetchFn });
  let cost = usage?.cost ?? 0;
  const same = t => t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase() === line.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
  let { ok, dropped } = usableLines(parseLines(content, 30).filter(t => !same(t)), words, 2);
  if (ok.length < want && dropped.length) {
    const r = await askOpenRouter({ key, model, messages: repairMessages(messages, content, dropped, count), fetchFn });
    cost += r.usage?.cost ?? 0;
    ok = [...new Set([...ok, ...usableLines(parseLines(r.content, 30).filter(t => !same(t)), words, 2).ok])];
  }
  return { lines: ok, cost };
}

// ---------------------------------------------------------------- Fundstücke
const FINDS = `You help with YouTube Poop (YTP) sentence mixing. You get the transcript of a video, split into numbered sentences. Find passages that are already funny on their own, or become funny with a tiny edit – the kind of material a YTP editor "pans for gold" for. Funny-as-is clips are rare: return at most two of them, and only if they are really funny when heard. Most finds need a small edit.

The transcript was made by speech recognition and has spelling mistakes ("Schminne" for "Spinne", "ungeftig" for "ungiftig"). In the video these words sound normal, so a misspelling is never a joke – the listener only hears the sound. Judge every find by how it sounds, not how it is spelled. Likewise, a pause alone does not make a sentence funny; the words must change or the cut must reveal something.

Look for:
- accidental double meanings and innuendo when the passage is cut out of its context
- passages that sound absurd, rude or embarrassing on their own
- a sentence that turns funny if it stops early (cut right after a word that changes its meaning)
- a sentence that turns funny if one or two words are swapped, dropped or added (prefer words the speaker says elsewhere; a near-miss word like "hinten" → "Hintern" also works)
- two passages that are funny right after each other are NOT what we want here: one passage per find
- variety: every find needs its own kind of joke. Never use the same new word in more than two finds (not "Löwe" in every second edit), and do not just swap one animal for another.
- YTP is not polite: at least half of the finds should be rude, crude, gross or innuendo – the calm documentary voice makes it funny.

Rules:
- "quote": the passage exactly as it stands in the transcript, consecutive words from one sentence, 2 to 20 words. Copy it letter by letter.
- "edit": the minimally changed version (the fewer changes, the better – keep the speaker's own words and melody), or "" if the quote is funny as it is. It must differ in words from the quote (cut short, swapped, dropped or added words). A "…" for a dramatic pause before the punchline may be added to such an edit.
- "why": at most 8 words.
Order funniest first. Keep it obvious parody. No slurs against groups of people, nothing sexual involving children.`;

/** Transkript in nummerierte Sätze (an Satzzeichen und längeren Pausen). → { text, sentences: [[Wortindex…]] } */
export function transcriptSentences(words, maxWords = 9000) {
  const sentences = [];
  let cur = [];
  words.forEach((w, i) => {
    if (i >= maxWords) return;
    const prev = words[i - 1];
    if (cur.length && (/[.!?]$/.test(prev.w) || w.s - prev.e > 1.2 || w.spk !== prev.spk)) { sentences.push(cur); cur = []; }
    cur.push(i);
  });
  if (cur.length) sentences.push(cur);
  return { text: sentences.map((s, k) => `${k + 1}. ${s.map(i => words[i].w).join(' ')}`).join('\n'), sentences };
}

/** Wortfolge `quote` im Transkript finden (Schreibung ohne Satzzeichen, groß/klein egal). → [Wortindex…] oder null */
export function locateQuote(words, quote) {
  const key = w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const q = quote.split(/\s+/).map(key).filter(Boolean);
  if (q.length < 2) return null;
  const ks = words.map(w => key(w.w));
  for (let i = 0; i + q.length <= ks.length; i++) {
    let k = 0;
    while (k < q.length && ks[i + k] === q[k]) k++;
    if (k === q.length) return Array.from({ length: q.length }, (_, j) => i + j);
  }
  return null;
}

/**
 * Fundstücke holen: Stellen, die schon lustig sind oder mit kleinem Eingriff werden.
 * `words` = [{w, s, e, spk}] (ein Sprecher oder alle). → { finds: [{quote, edit, why, idx}], cost }
 */
export async function findGold({ key, model = DEFAULT_MODEL, words, lang, topic = '', count = 12, fetchFn = fetch }) {
  const { text } = transcriptSentences(words);
  const language = lang === 'de' ? 'German' : 'English';
  const messages = [
    { role: 'system', content: FINDS },
    { role: 'user', content: `Language: ${language}.${topic ? `\nTheme or target of the jokes: ${topic}` : ''}
Find ${count} passages. Reply as JSON: {"finds": [{"quote": "…", "edit": "…", "why": "…"}]}

Transcript:
${text}` },
  ];
  const { content, usage } = await askOpenRouter({ key, model, messages, fetchFn });
  let raw = [];
  try { raw = JSON.parse(content.replace(/^```(?:json)?|```$/gm, '').trim()).finds ?? []; } catch { raw = []; }
  const finds = [];
  for (const f of raw) {
    if (!f || typeof f.quote !== 'string') continue;
    const idx = locateQuote(words, f.quote);
    if (!idx) continue;
    const quote = idx.map(i => words[i].w).join(' ');
    const edit = typeof f.edit === 'string' && f.edit.trim() && f.edit.trim() !== f.quote.trim() ? f.edit.trim() : '';
    if (!finds.some(x => x.quote === quote && x.edit === edit)) finds.push({ quote, edit, why: String(f.why ?? '').slice(0, 80), idx });
  }
  return { finds, cost: usage?.cost ?? 0, asked: raw.length };
}

/**
 * Welche Wörter der Bearbeitung sind unverändert aus dem Zitat? (längste gemeinsame
 * Teilfolge nach Schreibung) → Map: Wortposition in edit → Position im Zitat
 */
export function keptWords(quoteWords, editWords) {
  const key = w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const a = quoteWords.map(key), b = editWords.map(key);
  const L = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    L[i][j] = a[i] && a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const map = new Map();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] && a[i] === b[j]) { map.set(j, i); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return map;
}

/** Antwort des Modells → Zeilen (JSON, sonst eine Zeile pro Satz). */
export function parseLines(content, count = 10) {
  let lines = [];
  try { lines = JSON.parse(content.replace(/^```(?:json)?|```$/gm, '').trim()).lines ?? []; }
  catch { lines = content.split('\n').map(l => l.replace(/^[\s\d.\-*"“]+|["”,]+$/g, '').trim()).filter(l => l.split(/\s+/).length >= 2); }
  return [...new Set(lines.filter(l => typeof l === 'string' && l.trim()).map(l => l.trim()))].slice(0, count);
}

/**
 * Zeilen mit höchstens `maxMissing` Wörtern, die im Video nicht vorkommen
 * (die müssen gebaut werden). → { ok: [text], dropped: [{text, missing}] }
 */
export function usableLines(lines, words, maxMissing = 0) {
  const key = w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const have = new Set(words.map(w => key(w.w)));
  const ok = [], dropped = [];
  for (const text of lines) {
    const missing = text.split(/\s+/).map(key).filter(k => k && !have.has(k));
    if (missing.length <= maxMissing) ok.push(text); else dropped.push({ text, missing });
  }
  return { ok, dropped };
}

/**
 * Wie gut lässt sich die Zeile schneiden? Das am schlechtesten gebaute Wort zählt
 * (mittlere Schnittkosten je Halblaut: gut gebaut ≈ 2–3, Matsch ≥ 3,5; ganze Wörter
 * aus dem Video zählen nicht). Niedriger ist besser.
 */
export const buildCost = words => Math.max(0, ...words.filter(w => w.quality !== 'whole').map(w => w.cost ?? 5));
export const MAX_BUILD_COST = 3.0;

/**
 * Welche Ideen behalten? Was verständlich bleibt (buildCost ≤ max), in der
 * Reihenfolge des Modells (lustigste zuerst); fehlt etwas, die am saubersten
 * geschnittenen Übrigen. `scored` = [{text, cost, …}] in Modellreihenfolge.
 */
export function pickIdeas(scored, keep = 5, max = MAX_BUILD_COST) {
  const good = scored.filter(x => x.cost <= max).slice(0, keep);
  const rest = scored.filter(x => !good.includes(x)).sort((a, b) => a.cost - b.cost);
  return [...good, ...rest.slice(0, keep - good.length)];
}

/** Eine Anfrage an OpenRouter; gibt Text und Kosten zurück. */
export async function askOpenRouter({ key, model = DEFAULT_MODEL, messages, effort = null, fetchFn = fetch }) {
  const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Slinky-Cut' },
    body: JSON.stringify({ model, messages, temperature: 1.0, response_format: { type: 'json_object' }, ...(effort ? { reasoning: { effort } } : {}) }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`OpenRouter: ${res.status} ${t.slice(0, 160)}`); }
  const j = await res.json();
  return { content: j.choices?.[0]?.message?.content ?? '', usage: j.usage ?? null, model: j.model ?? model };
}
