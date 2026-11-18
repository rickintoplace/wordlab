// Satzideen per Sprachmodell (OpenRouter). Reiner Code ohne DOM, damit Seite und
// Testskripte denselben Prompt benutzen.

/**
 * Empfohlene Modelle (gemessen Nov. 2026 mit „Find gold“ auf 12 Minuten Doku): Gemini 3.8
 * Flash fand die klügsten Stellen in ~30 s; Flash-Lite antwortet sofort, aber plumper;
 * DeepSeek denkt ~2 Minuten nach.
 */
export const MODELS = [
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash · funniest · ~30 s · ~2.5 ct per search' },
  { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite · instant · ~0.3 ct · cruder' },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash · ~2 min · ~1.5 ct' },
];
export const DEFAULT_MODEL = MODELS[0].id;

const SYSTEM = `You write YouTube Poop (YTP) sentence mixes. Sentence mixing re-cuts real footage word by word so the speaker seems to say things they never said. The joke is always the contrast with how they normally sound: the more serious the speaker, the dumber the line.

What makes a good YTP line:
- one clear joke per line: a twist on the last word, an embarrassing confession, a rude insult, a bizarre demand, a solemn statement about something stupid, the narrator talking about himself or the viewer
- crude, vulgar, profane and toilet humour, cheap innuendo, swearing – said in the same calm documentary voice
- swapped roles: who does what to whom – but at most one line of this kind; find other jokes too
- near-miss words: change or add one sound of a word the speaker says to get a ruder or sillier one ("hinten" → "Hintern", "Wurzeln" → "Wurst", "pan" → "pants"). The tool builds these well, because almost all of their sounds are already there. This is one of the best YTP tricks: use it in several lines.
- real sentences: grammatical (articles, endings and word order right), so the listener understands the joke at once. Absurd content, correct form. A garbled word salad is not funny.
- no stutter loops ("die die die") – they rarely work
- timing: a dramatic pause before the punchline sells it. Write "…" where the speaker should stop for a moment before the last word or phrase ("Und dann kam die Beute … Scheiße."). The tool turns "…" into a real pause. Use it in at most two lines out of ten – most jokes work better without it.
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
// Wortschatz mit Aussprache („Wasser /ˈvasɐ/“): Im Vergleich (Nov. 2026, 3 Varianten je 16
// Zeilen) kamen so die witzigsten Zeilen, die sich trotzdem meist verständlich bauen ließen
const PRON_NOTE = 'Each vocabulary word comes with its pronunciation in IPA – use it to find words that can be built from the speaker\'s sounds.\n';
const vocabText = (vocab, pron) => (pron ? vocab.map(w => (pron[w] ? `${w} /${pron[w]}/` : w)) : vocab).join(', ');

export function ideaMessages({ words, lang, topic = '', count = 10, pron = null }) {
  const vocab = vocabulary(words);
  const step = Math.max(1, Math.ceil(words.length / 1200));
  const sample = words.filter((_, i) => i % step === 0).map(w => w.w).join(' ');
  const language = lang === 'de' ? 'German' : 'English';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Language: ${language}.
${topic ? `Theme or target of the jokes: ${topic}\n` : ''}Write ${count} different lines, 2 to 10 words each, mostly from the vocabulary below (at most two other words per line).
Order them funniest first. Reply as JSON: {"lines": ["…", "…"]}

${pron ? PRON_NOTE : ''}Vocabulary (most frequent first):
${vocabText(vocab, pron)}

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
export async function generateIdeas({ key, model = DEFAULT_MODEL, words, lang, topic = '', count = 16, want = 8, fetchFn = fetch, onStatus = () => {}, onLine = null, onPhase, pron = null }) {
  const messages = ideaMessages({ words, lang, topic, count, pron });
  onStatus('Asking the model…');
  const ok = [], allDropped = [];
  // jede Zeile sofort prüfen und (gestreamt) weitergeben
  const take = t => {
    if (typeof t !== 'string' || !t.trim() || ok.includes(t.trim())) return;
    const u = usableLines([t.trim()], words, 2);
    if (u.ok.length) { ok.push(u.ok[0]); onLine?.(u.ok[0]); } else allDropped.push(...u.dropped);
  };
  const ask = async msgs => {
    const r = await askOpenRouter({ key, model, messages: msgs, fetchFn, onItem: onLine ? take : null, onPhase });
    if (!onLine) for (const t of parseLines(r.content, 40)) take(t);
    return r;
  };
  const first = await ask(messages);
  let cost = first.usage?.cost ?? 0;
  if (ok.length < want && allDropped.length) {
    onStatus(`Only ${ok.length} ideas fit the vocabulary – asking for more…`);
    const r = await ask(repairMessages(messages, first.content, allDropped, count));
    cost += r.usage?.cost ?? 0;
  }
  return { lines: ok, dropped: allDropped, cost };
}

/** Nachrichten für „diese Stelle mit KI umschreiben“: Ausgangszeile + Wortschatz. */
export function rewriteMessages({ words, lang, line, count = 10, pron = null }) {
  const vocab = vocabulary(words);
  const language = lang === 'de' ? 'German' : 'English';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Language: ${language}.
The speaker says this in the video: "${line}"
Write ${count} YTP versions of this line. Vary how far you go: a few versions change only one or two words (a ruder near-miss word, a swapped object, a twisted ending), others keep only some chunks of it and say something entirely different, or reorder its chunks. Each version needs its own joke – not the same sentence frame with different last words – and none may mean what the original means. Use words from the vocabulary below for anything new (at most two words per line that are not in it).
Order them funniest first. Reply as JSON: {"lines": ["…", "…"]}

${pron ? PRON_NOTE : ''}Vocabulary (most frequent first):
${vocabText(vocab, pron)}` },
  ];
}

/** Umschreibungen holen (wie generateIdeas, mit Rückfrage bei zu vielen fremden Wörtern). */
export async function rewriteIdeas({ key, model = DEFAULT_MODEL, words, lang, line, count = 10, want = 5, fetchFn = fetch, onLine = null, onPhase, effort = null, pron = null }) {
  const messages = rewriteMessages({ words, lang, line, count, pron });
  const norm = t => t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
  const ok = [], dropped = [];
  const take = t => {
    if (typeof t !== 'string' || !t.trim() || norm(t) === norm(line) || ok.includes(t.trim())) return;
    const u = usableLines([t.trim()], words, 2);
    if (u.ok.length) { ok.push(u.ok[0]); onLine?.(u.ok[0]); } else dropped.push(...u.dropped);
  };
  const ask = async msgs => {
    const r = await askOpenRouter({ key, model, messages: msgs, fetchFn, onItem: onLine ? take : null, onPhase, effort });
    if (!onLine) for (const t of parseLines(r.content, 30)) take(t);
    return r;
  };
  const first = await ask(messages);
  let cost = first.usage?.cost ?? 0;
  if (ok.length < want && dropped.length) cost += (await ask(repairMessages(messages, first.content, dropped, count))).usage?.cost ?? 0;
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
export async function findGold({ key, model = DEFAULT_MODEL, words, lang, topic = '', count = 12, fetchFn = fetch, onFind = null, onPhase }) {
  const { text } = transcriptSentences(words);
  const language = lang === 'de' ? 'German' : 'English';
  const messages = [
    { role: 'system', content: FINDS },
    { role: 'user', content: `Language: ${language}.${topic ? `\nTheme or target of the jokes: ${topic}` : ''}
Find ${count} passages. Reply as JSON: {"finds": [{"quote": "…", "edit": "…", "why": "…"}]}

Transcript:
${text}` },
  ];
  const finds = [];
  let asked = 0;
  const take = f => {
    asked++;
    if (!f || typeof f.quote !== 'string') return;
    const idx = locateQuote(words, f.quote);
    if (!idx) return;
    const quote = idx.map(i => words[i].w).join(' ');
    const edit = typeof f.edit === 'string' && f.edit.trim() && f.edit.trim() !== f.quote.trim() ? f.edit.trim() : '';
    if (finds.some(x => x.quote === quote && x.edit === edit)) return;
    const x = { quote, edit, why: String(f.why ?? '').slice(0, 80), idx };
    finds.push(x);
    onFind?.(x);
  };
  const { content, usage } = await askOpenRouter({ key, model, messages, fetchFn, onItem: onFind ? take : null, onPhase });
  if (!onFind) {
    let raw = [];
    try { raw = JSON.parse(content.replace(/^```(?:json)?|```$/gm, '').trim()).finds ?? []; } catch { raw = []; }
    for (const f of raw) take(f);
  }
  return { finds, cost: usage?.cost ?? 0, asked };
}

// ---------------------------------------------------------------- Drehbuch
// Eine kleine YTP-Geschichte aus dem Material: erst Ideen (Prämissen), dann Szenen. Leicht zu
// bauen heißt: fast alles ist Originalton oder ein kleiner Eingriff darin – dann passen Bild
// und Melodie von selbst. Neue Sätze nennen die Stelle, deren Bild dazu passt.
const STORY = `You help with YouTube Poop (YTP) sentence mixing. You get the transcript of a video, split into numbered sentences, and maybe a list of "gold" clips the editor already likes. You plan a short YTP that tells one coherent, absurd story with the footage.

What makes a good YTP story:
- one clear premise that twists what the video is really about (its real subjects, places and events), told in the calm original voice: the more serious the footage, the dumber the story
- a running gag that comes back and escalates, and a punchline at the end
- contrast: real, serious passages as setup, then the twist
- rude, crude and toilet humour are welcome; YTP is not polite
- coherent: heard in order, the scenes tell one story, like a narrator would – each scene follows from the one before (same subject, cause and effect, a callback), not a list of separate jokes. Every scene serves the premise.
- stay in one or two sequences of the video (the same animal, place or event) and mostly follow their original order: then topic and picture stay together and the viewer can follow
- actually funny, not a theme stuck onto the footage: every scene has its own joke or sets up a later one. The best trick: a harmless original sentence becomes funny because of what came before (the new context turns it into innuendo, an insult or an absurd confirmation). Escalate, and let the last scene surprise. Boring is failure – no generic "the animals are lazy / hungry / grumpy" stories.

The picture cannot be changed – it can only be cut, reordered and reinterpreted. Every idea must work with what is really visible in the passages it uses: the narrator claims that something else is going on in the same shots. Never require animals, people, objects, places or actions that are not in the video (no "the penguin opens a restaurant" when no restaurant is shown, no "the lion kisses the antelope" when that is not filmed).

Example of the level we want (a cooking show, not your material). Premise: the chef is secretly in love with the onion.
orig "Now we take a fresh onion." – edit "Now we take a fresh onion … home." – orig "Gently stroke it with the knife." (now it sounds tender) – edit "I love the onion more than my wife." – orig "It needs a little more heat." (now innuendo) – edit "The onion is dead. Add salt."

It must be easy to build: the editor can only use what the speaker really says, and the picture comes with the sound. So:
- most scenes are original passages as they are ("orig") or with a tiny edit ("edit": one to three words swapped, dropped or added, or cut short). Then picture, lips and melody fit by themselves.
- the narration tells what is on screen at that moment. Build the story around passages whose picture (what the narrator talks about there) carries the joke.
- completely new lines ("new") only where the story needs them, at most a quarter of the scenes, 2 to 10 words, made of words exactly as they appear in the transcript (at most one other word). Glue chunks of one to three words from the transcript; real grammatical sentences.
- every "new" line names a passage whose picture fits it (what should be seen while it is said).
- use a gold clip only if it fits this story's subject and the scene before and after it; usually one or two, never just to use them all.
- a dramatic pause "…" in at most one scene, right before the final punchline word.

The transcript was made by speech recognition and has spelling mistakes; in the video the words sound normal, so a misspelling is never a joke.
Keep it obvious parody. No slurs against groups of people, nothing sexual involving children.`;

const goldText = gold => (gold?.length ? `\nGold clips the editor likes (use by number where they fit):\n${gold.map((g, i) => `G${i + 1}: "${g.text}"${g.note ? ` (${g.note.slice(0, 80)})` : ''}`).join('\n')}\n` : '');
export const STORY_LENGTHS = { short: [5, 7], medium: [8, 12], long: [13, 18] };

/** Ideen für eine Geschichte. → { pitches: [{title, premise, why}], cost } */
export async function storyPitches({ key, model = DEFAULT_MODEL, words, lang, topic = '', gold = [], count = 4, fetchFn = fetch, onPitch = null, onPhase }) {
  const { text } = transcriptSentences(words);
  const language = lang === 'de' ? 'German' : 'English';
  const messages = [
    { role: 'system', content: STORY },
    { role: 'user', content: `Language of the video: ${language}. Write titles and premises in ${language} too.${topic ? `\nThe editor's wish: ${topic}` : ''}
Suggest ${count} different story ideas for a YTP of about one minute. Each needs a different kind of joke; at least two are rude. Each must be easy to build from this footage (mostly original passages and tiny edits).
- "title": at most 6 words
- "premise": one or two sentences: what happens, the running gag and the punchline
- "why": at most 20 words: which passages it uses (name sentences as #12 or #12–15, gold clips as G2), what is seen there and how the story reinterprets it
Reply as JSON: {"pitches": [{"title": "…", "premise": "…", "why": "…"}]}
${goldText(gold)}
Transcript:
${text}` },
  ];
  const pitches = [];
  const take = p => { if (p && typeof p.premise === 'string') { const x = { title: String(p.title ?? '').slice(0, 80), premise: p.premise.slice(0, 400), why: String(p.why ?? '').slice(0, 160) }; pitches.push(x); onPitch?.(x); } };
  const { content, usage } = await askOpenRouter({ key, model, messages, fetchFn, onItem: onPitch ? take : null, onPhase });
  if (!onPitch) { try { for (const p of JSON.parse(content.replace(/^```(?:json)?|```$/gm, '').trim()).pitches ?? []) take(p); } catch { /* nichts */ } }
  return { pitches, cost: usage?.cost ?? 0 };
}

/** Rohe Szene des Modells → geprüfte Szene (Zitat im Transkript gefunden, Text bereinigt) oder null. */
export function normScene(x, words, gold = []) {
  if (!x || typeof x !== 'object') return null;
  const kind = ['orig', 'edit', 'gold', 'new'].includes(x.kind) ? x.kind : null;
  if (!kind) return null;
  const beat = String(x.beat ?? '').slice(0, 60);
  if (kind === 'gold') {
    const n = parseInt(String(x.gold ?? '').replace(/\D/g, ''), 10);
    return gold[n - 1] ? { kind, gold: n - 1, beat } : null;
  }
  const quote = typeof x.quote === 'string' ? x.quote.trim() : '';
  const idx = quote ? locateQuote(words, quote) : null;
  const text = typeof x.text === 'string' ? x.text.trim() : '';
  if (kind === 'orig') return idx ? { kind, idx, quote: idx.map(i => words[i].w).join(' '), beat } : null;
  if (!text) return null;
  // Bearbeitung ohne auffindbares Zitat: als neuer Satz (ohne eigenes Bild)
  if (kind === 'edit') return idx ? { kind, idx, quote: idx.map(i => words[i].w).join(' '), text, beat } : { kind: 'new', idx: null, quote: '', text, beat };
  return { kind, idx, quote: idx ? idx.map(i => words[i].w).join(' ') : '', text, beat };
}

/**
 * Drehbuch zu einer Idee. Szenen kommen gestreamt (onScene) und schon geprüft.
 * → { scenes, messages, content, cost }  (messages/content für Nachbesserungen)
 */
export async function writeStory({ key, model = DEFAULT_MODEL, words, lang, pitch, gold = [], length = 'medium', fetchFn = fetch, onScene = null, onPhase }) {
  const messages = storyMessages({ words, lang, pitch, gold, length });
  const scenes = [];
  const take = x => { const s = normScene(x, words, gold); if (s) { scenes.push(s); onScene?.(s, scenes.length - 1); } };
  const r = await askOpenRouter({ key, model, messages, fetchFn, onItem: onScene ? take : null, onPhase });
  let j = {};
  try { j = JSON.parse(r.content.replace(/^```(?:json)?|```$/gm, '').trim()); } catch { j = {}; }
  if (!onScene) for (const x of j.scenes ?? []) take(x);
  const outline = typeof j.outline === 'string' ? j.outline.slice(0, 800) : '';
  return { scenes, outline, messages, content: r.content, cost: r.usage?.cost ?? 0 };
}

/** Szene → so, wie das Modell sie schreibt (für den Verlauf bei Nachbesserungen). */
export const rawScene = (s, gold = []) => ({ kind: s.kind, quote: s.quote ?? '', text: s.text ?? '', gold: s.kind === 'gold' ? String((s.gold ?? 0) + 1) : '', beat: s.beat ?? '' });

/** Die Anfrage für ein Drehbuch (auch, um später einzelne Szenen nachzubessern). */
export function storyMessages({ words, lang, pitch, gold = [], length = 'medium' }) {
  const { text } = transcriptSentences(words);
  const language = lang === 'de' ? 'German' : 'English';
  const [a, b] = STORY_LENGTHS[length] ?? STORY_LENGTHS.medium;
  return [
    { role: 'system', content: STORY },
    { role: 'user', content: `Language: ${language}.
Story: ${pitch.title ? `"${pitch.title}" – ` : ''}${pitch.premise}
Write the script: ${a} to ${b} scenes in order. About a third are original passages as setup and context; most of the rest are tiny edits; few new lines.
First write "outline": three to five short sentences telling the whole story in order, so that it makes sense as one story. Then the scenes, which tell exactly this outline.
Each scene:
- "kind": "orig" | "edit" | "gold" | "new"
- "quote": orig: the passage exactly as it stands in the transcript (consecutive words of one sentence, 3 to 25 words, letter by letter); edit: the passage being edited (same rules); new: a passage whose picture fits this line (same rules); gold: ""
- "text": edit and new: what the speaker should say; orig and gold: ""
- "gold": gold: its number (e.g. 2); otherwise ""
- "beat": at most 6 words: what the scene does in the story (setup, running gag, escalation, punchline …)
Reply as JSON: {"outline": "…", "scenes": [{"kind": "…", "quote": "…", "text": "…", "gold": "…", "beat": "…"}]}
${goldText(gold)}
Transcript:
${text}` },
  ];
}

/**
 * Ersatz für Szenen, die sich nicht sauber schneiden lassen (oder die der Nutzer neu will).
 * weak = [{n (1-basiert), text, why}] → { scenes: [{n, scene}], cost }
 */
export async function fixScenes({ key, model = DEFAULT_MODEL, words, gold = [], messages, content, weak, fetchFn = fetch, onPhase }) {
  const list = weak.map(w => `Scene ${w.n}${w.text ? ` ("${w.text}")` : ''}: ${w.why}`).join('\n');
  const msgs = [...messages, { role: 'assistant', content }, { role: 'user', content: `Replace these scenes. Keep each scene's role in the story and its joke – do not fall back to the plain original. Make it easier to build: other words for the same joke (a near-miss word of one the speaker says, words exactly as in the transcript), or a tiny edit of a different passage with a fitting picture. If the editor wants another version, write a different joke for the same spot:
${list}
Reply as JSON: {"scenes": [{"replace": <scene number>, "kind": "…", "quote": "…", "text": "…", "gold": "…", "beat": "…"}]}` }];
  const r = await askOpenRouter({ key, model, messages: msgs, fetchFn, onPhase });
  let raw = [];
  try { raw = JSON.parse(r.content.replace(/^```(?:json)?|```$/gm, '').trim()).scenes ?? []; } catch { raw = []; }
  const out = [];
  for (const x of raw) { const n = parseInt(x?.replace, 10), s = normScene(x, words, gold); if (n && s) out.push({ n, scene: s }); }
  return { scenes: out, cost: r.usage?.cost ?? 0 };
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

/**
 * pickIdeas für gestreamte Ergebnisse: Was verständlich bleibt, wird sofort angenommen
 * (bis `keep`), der Rest wartet; finish() füllt mit den saubersten Übrigen auf.
 */
export function streamPick(keep, accept, max = MAX_BUILD_COST) {
  const rest = [];
  let n = 0;
  return {
    offer(x) { if (n < keep && x.cost <= max) { n++; accept(x); } else rest.push(x); },
    finish() { for (const x of rest.sort((a, b) => a.cost - b.cost).slice(0, keep - n)) { n++; accept(x); } return n; },
    get count() { return n; },
  };
}

/**
 * Liest die Elemente des ersten JSON-Arrays einer Antwort, sobald sie vollständig
 * angekommen sind ({"lines": ["…", "…"]} → "…", "…"). push(text) → neue Elemente.
 */
export class ArrayItems {
  constructor() { this.buf = ''; this.i = 0; this.inArr = false; this.depth = 0; this.str = false; this.esc = false; this.start = -1; }
  push(text) {
    this.buf += text;
    const out = [];
    for (; this.i < this.buf.length; this.i++) {
      const c = this.buf[this.i];
      if (this.str) {
        if (this.esc) this.esc = false;
        else if (c === '\\') this.esc = true;
        else if (c === '"') { this.str = false; if (this.inArr && this.depth === 1) out.push(this.take()); }
        continue;
      }
      if (c === '"') { this.str = true; if (this.inArr && this.depth === 1) this.start = this.i; continue; }
      if (!this.inArr) { if (c === '[') { this.inArr = true; this.depth = 1; } continue; }
      if (c === '{' || c === '[') { if (this.depth === 1) this.start = this.i; this.depth++; }
      else if (c === '}' || c === ']') {
        this.depth--;
        if (this.depth === 1) out.push(this.take());
        else if (this.depth === 0) this.inArr = false;
      }
    }
    return out.filter(x => x !== undefined);
  }
  take() {
    const raw = this.buf.slice(this.start, this.i + 1);
    this.start = -1;
    try { return JSON.parse(raw); } catch { return undefined; }
  }
}

/**
 * Eine Anfrage an OpenRouter; gibt Text und Kosten zurück. Mit `onItem` wird gestreamt:
 * Jedes fertige Element des Antwort-Arrays kommt sofort an (Zeile bzw. Fundstück).
 * `onPhase('thinking' | 'writing')` meldet, ob das Modell noch nachdenkt.
 */
export async function askOpenRouter({ key, model = DEFAULT_MODEL, messages, effort = null, fetchFn = fetch, onItem = null, onPhase = () => {}, signal }) {
  const stream = !!onItem;
  const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Slinky-Cut' },
    body: JSON.stringify({ model, messages, temperature: 1.0, response_format: { type: 'json_object' }, ...(effort === 'none' ? { reasoning: { enabled: false } } : effort ? { reasoning: { effort } } : {}),
      ...(stream ? { stream: true, usage: { include: true } } : {}) }),
  });
  if (!res.ok) {
    const t = await res.text();
    // Schlüssel gelöscht, falsch kopiert oder ohne Guthaben: sagen, was zu tun ist
    if (res.status === 401) throw Object.assign(new Error('OpenRouter does not know this key (deleted or mistyped?). Paste a current key under “OpenRouter key and model”.'), { code: 'key' });
    if (res.status === 402) throw Object.assign(new Error('This OpenRouter key has no credit left. Add credit at openrouter.ai or use another key.'), { code: 'key' });
    throw new Error(`OpenRouter: ${res.status} ${t.slice(0, 160)}`);
  }
  const items = new ArrayItems();
  // Antwort kam doch am Stück (kein Stream): alle Elemente auf einmal melden
  if (!stream || !/event-stream/.test(res.headers.get('content-type') ?? '') || !res.body) {
    const j = await res.json();
    const content = j.choices?.[0]?.message?.content ?? '';
    if (stream) { onPhase('writing'); for (const x of items.push(content)) onItem(x); }
    return { content, usage: j.usage ?? null, model: j.model ?? model };
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let content = '', usage = null, used = model, rest = '', phase = '';
  const set = p => { if (p !== phase) { phase = p; onPhase(p); } };
  set('thinking');
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += dec.decode(value, { stream: true });
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;              // „: OPENROUTER PROCESSING“ u. Ä.
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(`OpenRouter: ${j.error.message ?? 'error'}`);
      if (j.usage) usage = j.usage;
      if (j.model) used = j.model;
      const d = j.choices?.[0]?.delta;
      if (d?.content) { set('writing'); content += d.content; for (const x of items.push(d.content)) onItem(x); }
      else if (d?.reasoning) set('thinking');
    }
  }
  return { content, usage, model: used };
}
