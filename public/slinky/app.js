// Slinky-Cut, Oberfläche: Datei laden → analysieren lassen → im Schnittfenster
// Sätze, Wörter, Silben und Laute auf die Zeitleiste legen, anhören, ausgeben.
// Die Rechenarbeit machen stages.js (Modelle) und worker.js (Verorten, Schneiden).

import { paintIcons, icon } from '../icons.js';
import { encodeWav } from './engine.js';
import { Timeline, clock, reserveIds } from './timeline.js';
import { endOf, speedOf, srcSpan, timeOf, toggleCrossfades, migrate, keptSpan } from './project.js';
import { Player } from './player.js';
import * as cache from './cache.js';
import { pack, unpack, estimateMB } from './projfile.js';
import { DEFAULT_MODEL, MODELS, generateIdeas, rewriteIdeas, findGold, keptWords, buildCost, streamPick, vocabulary, storyPitches, writeStory, fixScenes, storyMessages, rawScene, MAX_BUILD_COST } from './ideas.js';

paintIcons();
const $ = id => document.getElementById(id);
const els = {
  drop: $('drop'), file: $('file'), loaded: $('loaded'), video: $('video'), filename: $('filename'),
  separate: $('separate'), analyze: $('analyze'), other: $('other'), estimate: $('estimate'),
  steps: $('steps'), studio: $('studio'), say: $('say'), text: $('text'),
  transcript: $('transcript'), wordcount: $('wordcount'), error: $('error'), source: $('source'),
  canvas: $('screen-cv'), badge: $('pv-badge'), screen: $('screen'),
  play: $('t-play'), time: $('t-time'), zoom: $('t-zoom'),
  voicePick: $('voice-pick'), voiceSel: $('voice'), inspector: $('inspector'),
  find: $('find'), results: $('results'), timeline: $('timeline'), bin: $('bin'),
  exportBtn: $('t-export'), exportMenu: $('export-menu'),
};

// Kleine Geräte warnen: Die Modelle brauchen Speicher und einen schnellen Prozessor
if ((navigator.deviceMemory && navigator.deviceMemory < 4) || matchMedia('(max-width: 700px), (pointer: coarse)').matches) $('device-hint').hidden = false;

const SR = 48000;
let file = null, worker = null, key = null;
let S = null;            // Studio-Zustand: { words, speakers, voice, music, lang, tl, player }
const lang = () => document.querySelector('input[name="lang"]:checked').value;

// ---------------------------------------------------------------- Datei
els.file.addEventListener('change', () => els.file.files[0] && load(els.file.files[0]));
for (const ev of ['dragenter', 'dragover']) els.drop.addEventListener(ev, e => { e.preventDefault(); els.drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) els.drop.addEventListener(ev, () => els.drop.classList.remove('over'));
els.drop.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) load(f); });
els.other.addEventListener('click', () => els.file.click());

function load(f) {
  file = f;
  worker?.terminate(); worker = null;
  S?.player.stop(); S?.player.hold.remove(); S = null;
  for (const el of document.querySelectorAll('.sc-setup > *')) el.hidden = false;
  els.analyze.hidden = false;
  els.studio.hidden = true; els.steps.hidden = true; els.loaded.classList.remove('slim');
  document.body.classList.remove('sc-editing');
  for (const li of els.steps.querySelectorAll('li')) { delete li.dataset.state; delete li.dataset.keep; li.querySelector('.bar i').style.width = '0'; li.querySelector('.detail').textContent = ''; }
  const url = URL.createObjectURL(f);
  els.video.src = url;
  els.filename.textContent = f.name;
  els.drop.hidden = true;
  els.loaded.hidden = false;
  els.analyze.disabled = false;
  els.video.onloadedmetadata = () => estimate();
}

// Grobe Schätzung für den Browser (gemessen auf einem Desktop-Prozessor ohne Grafikkarte)
function estimate() {
  const min = (els.video.duration || 0) / 60;
  if (!min) { els.estimate.textContent = ''; return; }
  const without = min * 2.6 + 1, withSep = without + min * 1.5;
  const r = x => (x < 1.5 ? 'about a minute' : `about ${Math.round(x)} minutes`);
  els.estimate.textContent = `${clock(els.video.duration, false)} of video: ${r(els.separate.checked ? withSep : without)} the first time${els.separate.checked ? ` (${r(without)} without separation)` : ''}.`;
}
els.separate.addEventListener('change', estimate);

// ---------------------------------------------------------------- Analyse
els.analyze.addEventListener('click', async () => {
  els.analyze.disabled = true;
  els.steps.hidden = false;
  els.error.hidden = true;
  const separate = els.separate.checked;
  let lg = lang();
  key = `${file.name}|${file.size}|${file.lastModified}|${lg}|${separate ? 'sep' : 'mix'}`;
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onerror = e => fail(e.message || 'The analysis stopped.');
  try {
    // Schon einmal analysiert? Dann kommt alles aus dem Zwischenspeicher.
    const hit = await ask(worker, { type: 'lookup', key }, m => m.type === 'missing' || m.type === 'ready');
    if (hit.type === 'ready') {
      for (const s of ['decode', 'separate', 'transcribe', 'speakers', 'phonemes', 'align', 'prepare']) setStage(s, 'cached');
      worker.onmessage = onWorker;
      ready(hit);
      return;
    }
    setStage('decode', 'running');
    const { a16, a48, a44 } = await decode(file, separate);
    setStage('decode', 'done');

    // Jede schwere Stufe in einem frischen Worker, der danach beendet wird (Speicher!)
    let voice16 = a16, voice48 = a48, music48 = null;
    if (separate) {
      const r = await runStage('separate', { task: 'separate', a44, a48 }, [...a44.map(x => x.buffer)]);
      ({ voice16, voice48, music48 } = r);
    } else setStage('separate', 'skipped');
    const tr = await runStage('transcribe', { task: 'transcribe', a16: voice16.slice(), lang: lg });
    lg = tr.lang;
    const words = tr.words;
    const { spk } = await runStage('speakers', { task: 'speakers', a16: voice16.slice(), words });
    words.forEach((w, i) => { w.spk = spk[i] ?? 0; });
    const ph = await runStage('phonemes', { task: 'phonemes', a16: voice16.slice() });

    worker.onmessage = onWorker;
    worker.postMessage({ type: 'build', key, lang: lg, words, post: ph.post, V: ph.V, vocab: ph.vocab, voice16, voice48, music48 },
      [ph.post.buffer, voice16.buffer, voice48.buffer, ...(music48 ? [music48.buffer] : [])]);
  } catch (err) { fail(err.message); }
});

/** Eine Nachricht schicken und auf die passende Antwort warten (Fortschritt läuft weiter durch). */
function ask(w, msg, done, transfer = []) {
  return new Promise((resolve, reject) => {
    w.onmessage = ({ data: m }) => {
      if (m.type === 'error') reject(new Error(m.message));
      else if (done(m)) resolve(m);
      else onWorker({ data: m });
    };
    w.postMessage(msg, transfer);
  });
}

async function runStage(step, msg, transfer = []) {
  setStage(step, 'running');
  const w = new Worker(new URL('./stages.js', import.meta.url), { type: 'module' });
  w.onerror = e => fail(e.message || `The step “${step}” stopped.`);
  try {
    const r = await ask(w, msg, m => m.type === 'result', transfer);
    setStage(step, 'done');
    return r;
  } finally { w.terminate(); }
}

/** Datei → Mono 16 kHz (Modelle), Mono 48 kHz (Schnitt), Stereo 44,1 kHz (Trennung). */
async function decode(f, needStereo) {
  const ac = new AudioContext({ sampleRate: 48000 });
  const buf = await ac.decodeAudioData(await f.arrayBuffer());
  ac.close();
  const render = async (rate, channels) => {
    const off = new OfflineAudioContext(channels, Math.ceil(buf.duration * rate), rate);
    const node = off.createBufferSource();
    node.buffer = buf;
    node.connect(off.destination);
    node.start();
    return off.startRendering();
  };
  const mono48 = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono48[i] += ch[i] / buf.numberOfChannels;
  }
  const a16 = (await render(16000, 1)).getChannelData(0).slice();
  let a44 = null;
  if (needStereo) {
    const st = await render(44100, 2);
    a44 = [st.getChannelData(0).slice(), st.getChannelData(1).slice()];
  }
  return { a16, a48: mono48, a44 };
}

function setStage(step, state, frac) {
  const li = els.steps.querySelector(`[data-step="${step}"]`);
  if (!li) return;
  li.dataset.state = state;
  const bar = li.querySelector('.bar i');
  if (state === 'done' || state === 'cached') bar.style.width = '100%';
  if (state === 'skipped') li.querySelector('.detail').textContent = 'skipped';
  if (state === 'cached') li.querySelector('.detail').textContent = 'from cache';
  if (state === 'done') li.querySelector('.detail').textContent = li.dataset.keep ?? '';
  if (frac != null) bar.style.width = `${Math.round(frac * 100)}%`;
}

const pending = new Map();      // id → resolve (Antworten des Workers)
let reqId = 1;
function request(msg) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}

function onWorker({ data: m }) {
  if (m.type === 'stage') setStage(m.step, m.state);
  else if (m.type === 'progress') {
    setStage(m.step, 'running', m.frac);
    els.steps.querySelector(`[data-step="${m.step}"] .detail`).textContent = m.detail;
  } else if (m.type === 'lang') {
    const li = els.steps.querySelector('[data-step="transcribe"]');
    li.dataset.keep = `${{ de: 'German', en: 'English' }[m.lang]} detected`;
    showLangNote(m);
  } else if (m.type === 'ready') ready(m);
  else if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
  } else if (m.type === 'error') fail(m.message);
}

function showLangNote(m) {
  if (!m.other) return;
  els.estimate.textContent = `This sounds like “${m.other}”. Slinky-Cut knows English and German, so it treats it as ${m.lang === 'de' ? 'German' : 'English'}.`;
}

// ---------------------------------------------------------------- Studio
async function ready(m) {
  if (S) { S.player.stop(); S.player.hold.remove(); }      // neu aufgebaut (weitere Quelle)
  els.steps.hidden = true;
  for (const el of document.querySelectorAll('.sc-setup > :not(.sc-filename):not(.sc-row)')) el.hidden = true;
  els.analyze.hidden = true;
  els.estimate.hidden = false;
  els.estimate.textContent = `${m.words.length} words, ${m.lang === 'de' ? 'German' : 'English'}${m.speakers.length > 1 ? `, ${m.speakers.length} voices` : ''}${m.hasMusic ? ', voice and music separated' : ''}.`;
  els.loaded.classList.add('slim');
  $('proj-save').hidden = false; $('src-add').hidden = false;
  els.video.pause();
  document.body.classList.add('sc-editing');
  els.studio.hidden = false;

  const duration = els.video.duration || m.voice.length / SR;
  const sources = m.sources ?? [{ name: file.name, size: file.size, offset: 0, duration }];
  const total = Math.max(...sources.map(x => x.offset + x.duration), duration);
  const tl = new Timeline(els.timeline, {
    samples: c => (c.type === 'take' ? c.take.audio : c.type === 'music' ? m.music : c.type === 'orig' || c.type === 'snip' ? m.voice : null),
    words: m.words,
    sourceLength: c => (c.type === 'take' ? c.take.audio.length / SR : c.type === 'video' || c.type === 'lips' ? total
      : (c.type === 'music' ? m.music : m.voice).length / SR),
  });
  tl.minLength = duration;
  const player = new Player({ timeline: tl, voice: m.voice, music: m.music, url: els.video.src, canvas: els.canvas, badge: els.badge });
  S = { ...m, duration, sources, tl, player, bin: [], binSel: null };
  syncMedia();
  window.slinky = S;               // zum Nachsehen in der Konsole

  // Gespeichertes Projekt fortsetzen, sonst: Video, Originalstimme und Musik als je ein Clip
  const saved = await cache.get(`project|${key}`).catch(() => null);
  S.bin = saved?.bin ?? [];
  S.story = saved?.story ?? null;
  S.alignVersion = m.alignVersion;
  // Sind die Laute inzwischen anders verortet, klingen die Sätze der Liste noch nach dem alten
  // Stand: im Hintergrund neu schneiden (gleicher Text, gleiche Wahl je Wort)
  if (S.bin.length && saved?.binAv !== m.alignVersion) recutBin();
  S.binTab = 'cut';
  renderBin();
  const voiceLen = Math.min(duration, m.voice.length / SR);
  if (saved?.clips?.length) {
    const p = migrate(saved);
    tl.tracks = p.tracks; tl.clips = p.clips; reserveIds(p.clips);
    // Ältere Projekte: die unberührte Originalstimme in Sätze aufteilen
    const whole = tl.clips.find(c => c.type === 'orig' && c.at === 0 && c.src === 0 && Math.abs(c.len - voiceLen) < 0.05);
    if (whole) { tl.clips = tl.clips.filter(c => c !== whole); for (const c of phraseClips(m, voiceLen, whole.track)) tl.add(c, { overwrite: false }); }
  } else {
    tl.add({ track: 'v1', type: 'video', at: 0, len: duration, src: 0, label: file.name });
    for (const c of phraseClips(m, voiceLen, 'a1')) tl.add(c, { overwrite: false });
    if (m.music) tl.add({ track: 'a2', type: 'music', at: 0, len: Math.min(duration, m.music.length / SR), src: 0, label: 'Music' });
  }
  tl.build();
  if (saved?.range) { tl.setRange(saved.range.a, saved.range.b); exportScope = 'range'; }
  requestAnimationFrame(() => { tl.fit(); syncZoomSlider(); player.sync(0); });

  tl.addEventListener('select', e => inspect(e.detail));
  tl.addEventListener('srcword', e => editSourceWord(e.detail));
  tl.addEventListener('word', e => { const { clip, ...rest } = e.detail; pickAlternative({ ...rest, ...forClip(clip) }); });
  tl.addEventListener('seek', () => { player.stop(); player.sync(tl.playhead); showTime(tl.playhead); closePop(); });
  tl.addEventListener('preview', () => player.sync(tl.playhead));
  tl.addEventListener('change', () => {
    if (player.playing && player.node) player.play(player.clock(), { until: player.until });   // neu mischen: Stumm/Löschen wirkt sofort
    else player.sync(tl.playhead);
    save(); inspect(tl.selection());
  });
  tl.addEventListener('zoom', syncZoomSlider);
  // Getrimmt: Lippen neu anlegen (gehört zum selben Rückgängig-Schritt)
  tl.addEventListener('trimmed', e => {
    const cs = e.detail.map(id => tl.get(id)).filter(c => c && !c.ref && hasLips(c));
    if (cs.length) { lips(cs, true); tl.history.pop(); }
  });
  // Wer einen Bereich markiert, will meist genau den ausgeben
  tl.addEventListener('range', () => { exportScope = tl.range ? 'range' : 'all'; save(); syncExportScope(); });
  tl.addEventListener('playfrom', () => player.play(tl.playhead));
  tl.addEventListener('menu', e => contextMenu(e.detail));
  tl.addEventListener('addtrack', e => addTrackMenu(e.detail));
  player.addEventListener('time', e => showTime(e.detail));
  player.addEventListener('state', () => els.play.replaceChildren(icon(player.playing ? 'pause' : 'play', { size: '18px' })));

  // Stimmen
  els.voicePick.hidden = m.speakers.length < 2;
  els.voiceSel.replaceChildren(...m.speakers.map((s, k) => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `Voice ${k + 1}${k === 0 ? ' (most)' : ''} · ${clock(s.seconds, false)}`;
    return o;
  }));

  // Transkript: Klick hört rein, Doppelklick legt das Wort an den Abspielkopf
  els.wordcount.textContent = `(${m.words.length} words)`;
  els.transcript.replaceChildren(...m.words.map(w => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sc-word';
    b.dataset.spk = w.spk;
    b.textContent = w.w;
    b.title = 'Click to listen, Shift-click to select up to here, double-click to place it at the playhead';
    b.addEventListener('click', e => {
      const i = m.words.indexOf(w);
      if (e.shiftKey && tAnchor != null) { selectTranscript(tAnchor, i); return; }
      tAnchor = i; selectTranscript(null);
      player.listen(m.voice, w.s - 0.02, w.e + 0.03);
    });
    b.addEventListener('dblclick', () => insertSnip({ label: w.w.replace(/[^\p{L}\p{N}'-]/gu, ''), s: w.s, e: w.e }));
    return b;
  }));
  inspect([]);
  els.text.focus();
  if (addedSource) {
    srcBox(`<p>“${esc(addedSource)}” is part of this project now: new sentences can use its words and sounds. Its voice and picture are under <b>+ Audio</b> and <b>+ Video</b> at the left of the timeline.</p>`, true);
    addedSource = null;
  }
}

/**
 * Die Originalstimme als einzelne Sätze: geschnitten an Pausen ab 0,6 s und an
 * Sprecherwechseln. Mit getrennter Stimme bleiben die Pausen leer (dort ist ohnehin
 * kaum etwas), sonst wird in ihrer Mitte geschnitten, damit nichts vom Hintergrund fehlt.
 */
function phraseClips(m, len, track, from = 0) {
  const ws = m.words.filter(w => w.e > w.s && w.s >= from - 0.05 && w.e <= from + len + 0.05);
  if (!ws.length) return [{ track, type: 'orig', at: 0, len, src: 0, label: m.hasMusic ? 'Original voice' : 'Original sound' }];
  const groups = [];
  for (const w of ws) {
    const g = groups.at(-1);
    if (g && w.s - g.e < 0.6 && w.spk === g.spk) { g.e = w.e; g.words.push(w.w); }
    else groups.push({ s: w.s, e: w.e, spk: w.spk, words: [w.w] });
  }
  const PAD = 0.18, out = [];
  groups.forEach((g, i) => {
    const prev = groups[i - 1], next = groups[i + 1];
    let a, b;
    const end = from + len;
    if (m.hasMusic) { a = Math.max(from, g.s - PAD, prev ? (prev.e + g.s) / 2 : from); b = Math.min(end, g.e + PAD, next ? (g.e + next.s) / 2 : end); }
    else { a = prev ? (prev.e + g.s) / 2 : from; b = next ? (g.e + next.s) / 2 : end; }
    const text = g.words.join(' ');
    out.push({ track, type: 'orig', at: a - from, len: b - a, src: a, label: (m.speakers.length > 1 ? `V${m.speakers.findIndex(x => x.id === g.spk) + 1}: ` : '') + text });
  });
  return out;
}

function showTime(t) { els.time.textContent = clock(t); }

// Zoom-Regler: logarithmisch zwischen „alles sichtbar“ und 1500 px/s
function zoomRange() { const min = Math.max(2, (S.tl.scroll.clientWidth - 20) / S.tl.length()); return [min, 1500]; }
function syncZoomSlider() { const [a, b] = zoomRange(); els.zoom.value = String(Math.round(100 * Math.log(S.tl.pps / a) / Math.log(b / a))); }
els.zoom.addEventListener('input', () => { const [a, b] = zoomRange(); S.tl.zoom(a * (b / a) ** (els.zoom.value / 100)); });

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => cache.put(`project|${key}`, projectState()).catch(() => {}), 800);
}
const projectState = () => ({ tracks: S.tl.tracks, clips: S.tl.clips, bin: S.bin, story: S.story, range: S.tl.range, binAv: S.alignVersion });

/** Zielspur für neuen Ton: die Tonspur des gewählten Clips, sonst „Voice“. */
function voiceTrack() {
  const c = S.tl.selection()[0];
  return c && S.tl.kindOf(c) === 'audio' && c.type !== 'music' ? c.track : 'a1';
}
/** Spur für Lippen-Schnipsel: die oberste Bildspur. */
const lipsTrack = () => S.tl.tracks.find(t => t.kind === 'video')?.id ?? 'v2';

// ---------------------------------------------------------------- Sätze schneiden → Ablage
// Ein geschnittener Satz landet erst in der Ablage unter dem Eingabefeld. Von dort:
// anhören, Wörter und Silben tauschen, an den Abspielkopf setzen, kopieren oder
// auf eine Tonspur ziehen.
els.say.addEventListener('submit', async e => {
  e.preventDefault();
  const text = els.text.value.trim();
  if (!text || !S) return;
  const go = els.say.querySelector('.sc-go');
  go.disabled = true;
  try {
    const r = await request({ type: 'mix', text, speaker: speaker() });
    const b = { id: newId(), text, audio: r.audio, words: r.words, pieces: r.pieces, speaker: speaker(), force: r.force, rev: 0 };
    S.bin.unshift(b);
    S.binTab = 'cut';
    renderBin();
    selectBin(b.id);
    save();
    S.player.listen(b.audio);
  } catch (err) { fail(err.message); } finally { go.disabled = false; }
});

// Zwei Listen in einer: „Sentences“ (alles Geschnittene, Ideen) und „Gold“ (was man
// behalten will: Fundstücke, gesammelte Stellen, gemerkte Sätze und Wörter). Gold-Einträge
// sind eigene Kopien (gold: true); ☆ legt eine an, Ziehen auf den Reiter auch.
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const goldKey = x => (x.snip ? `s|${x.snip.s.toFixed(3)}|${x.snip.e.toFixed(3)}` : `t|${x.text}|${x.audio.length}`);
const inGold = x => S.bin.some(g => g.gold && goldKey(g) === goldKey(x));
/** Eine Kopie in die Gold-Liste (nichts doppelt). */
function saveGold(item) {
  if (!item || inGold(item)) { pulseGold(); return null; }
  const g = { ...item, id: newId(), gold: true };
  S.bin.unshift(g);
  renderBin(); save(); pulseGold();
  return g;
}
function pulseGold() {
  const t = $('bintabs').querySelector('[data-tab="gold"]');
  t.classList.remove('pulse'); void t.offsetWidth; t.classList.add('pulse');
}
/** Ein Wort eines Satzes als eigener Eintrag (sein Ton, seine Stücke). */
function wordItem(b, wi) {
  const w = b.words[wi], dur = b.audio.length / SR;
  const a = Math.max(0, w.start - 0.012), e = Math.min(dur, w.end + 0.02);
  const audio = b.audio.slice(Math.round(a * SR), Math.round(e * SR)), F = Math.round(0.003 * SR);
  for (let i = 0; i < Math.min(F, audio.length); i++) { audio[i] *= i / F; audio[audio.length - 1 - i] *= i / F; }
  const sh = y => ({ ...y, start: y.start - a, end: y.end - a });
  const pieces = (b.pieces ?? []).filter(p => p.at < e && p.at + p.len > a).map(p => {
    const s0 = Math.max(a, p.at), s1 = Math.min(e, p.at + p.len);
    return { ...p, start: p.start + (s0 - p.at), end: p.start + (s1 - p.at), at: s0 - a, len: s1 - s0 };
  });
  return { id: newId(), text: w.w.replace(/[^\p{L}\p{N}'-]/gu, '') || w.w, audio, words: [{ ...sh(w), syls: (w.syls ?? []).map(sh) }],
    pieces, speaker: b.speaker, force: {}, rev: 0, word: true, ai: b.ai, note: `From “${b.text}”` };
}
/** Ein Stück Originalstimme (Fundstück der Suche) als Eintrag. */
function snipItem({ label, s, e }) {
  return { id: newId(), text: label, audio: S.voice.slice(Math.round(s * SR), Math.round(e * SR)),
    words: [{ w: label, start: 0, end: e - s, quality: 'whole', syls: [] }], pieces: [{ start: s, end: e, at: 0, len: e - s }],
    snip: { s, e }, speaker: null, rev: 0, orig: true };
}
/** Ein Wort zum Ziehen (auf eine Spur oder auf „Gold“) und mit Rechtsklick-Menü. */
function wordHandle(el, b, wi) {
  el.draggable = true;
  el.addEventListener('dragstart', ev => {
    ev.stopPropagation();
    const it = wordItem(b, wi);
    dragging = { clip: takeClip(it, 0, 'a1'), item: it };
    ev.dataTransfer.setData('text/plain', it.text);
    ev.dataTransfer.effectAllowed = 'copy';
  });
  el.addEventListener('dragend', ev => { ev.stopPropagation(); dragging = null; S.tl.ghost(null); });
  el.addEventListener('contextmenu', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const w = b.words[wi].w;
    showMenu([[`Save “${w}” in Gold`, '', () => saveGold(wordItem(b, wi))], [`Place “${w}” at the playhead`, '', () => placeTake(wordItem(b, wi), S.tl.playhead, voiceTrack())],
      ['Drag a word onto a track or onto Gold to use it alone.', '', null]], ev.clientX, ev.clientY);
  });
}

// Reiter: Sätze, Gold, Geschichte (deren Szenen sind eigene Einträge mit story: true)
const inTab = (b, tab) => (tab === 'story' ? false : !b.story && !!b.gold === (tab === 'gold'));
function renderBin() {
  const gold = S.binTab === 'gold';
  const tabs = $('bintabs');
  const any = S.bin.length || S.story;
  tabs.hidden = !any;
  for (const t of tabs.querySelectorAll('[data-tab]')) {
    t.setAttribute('aria-selected', String(t.dataset.tab === S.binTab));
    t.querySelector('span').textContent = t.dataset.tab === 'story' ? (S.story?.scenes?.length || '') : S.bin.filter(b => inTab(b, t.dataset.tab)).length || '';
  }
  els.bin.hidden = !any;
  if (S.binTab === 'story') { renderStory(); return; }
  const items = S.bin.filter(b => inTab(b, S.binTab));
  if (!items.length) {
    els.bin.innerHTML = gold
      ? '<li class="sc-hint">Nothing in Gold yet. Save sentences, words and finds with ☆ (or drag them onto “Gold”), select passages in the transcript, or let <b>Find gold</b> look for some.</li>'
      : '<li class="sc-hint">Sentences you cut and AI ideas land here.</li>';
    return;
  }
  els.bin.replaceChildren(...items.map(b => binLi(b, gold)));
}

/** Ein Eintrag der Liste: Wörter, Wellenform, Knöpfe; zum Ziehen auf eine Spur. */
function binLi(b, gold = false) {
  {
    const li = document.createElement('li');
    li.className = 'sc-bin-item' + (b.id === S.binSel ? ' on' : '');
    li.dataset.id = b.id;
    li.draggable = true;
    li.title = 'Drag onto a track, or use + to place it at the playhead';
    const play = document.createElement('button');
    play.type = 'button'; play.className = 'sc-mini'; play.setAttribute('aria-label', 'Listen');
    play.append(icon('play', { size: '13px' }));
    play.addEventListener('click', () => S.player.listen(b.audio));
    const line = document.createElement('p');
    line.className = 'sc-bin-line';
    b.words.forEach((w, wi) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `sc-chip q ${w.quality}`;
      chip.textContent = w.w;
      if (b.snip) chip.title = 'A piece of the original – drag it onto a track';
      else {
        chip.title = 'Click: other ways to say it · drag: use this word alone · right-click: save it in Gold';
        chip.addEventListener('click', ev => { ev.stopPropagation(); const r = chip.getBoundingClientRect(); pickAlternative({ ...forBin(b), wi, si: -1, x: r.left, y: r.bottom }); });
        if (b.words.length > 1) wordHandle(chip, b, wi);
      }
      line.append(chip, ' ');
    });
    const acts = document.createElement('span');
    acts.className = 'sc-bin-acts';
    const mk = (ic, title, fn, cls = '') => { const x = document.createElement('button'); x.type = 'button'; x.className = `sc-mini sc-add ${cls}`; x.title = title; x.append(icon(ic, { size: '14px' })); x.addEventListener('click', ev => { ev.stopPropagation(); fn(); }); acts.append(x); return x; };
    mk('plus', 'Place at the playhead', () => placeTake(b, S.tl.playhead, voiceTrack()));
    if (!gold) {
      const saved = inGold(b);
      mk('star', saved ? 'Saved in Gold' : 'Save in Gold (keep it)', () => saveGold(b), saved ? 'sc-star on' : 'sc-star');
    }
    mk('copy', 'Copy (then paste on the timeline with Ctrl+V)', () => { clipboard = [takeClip(b, 0, 'a1')]; });
    mk('trash', b.story ? 'Remove this scene' : gold ? 'Remove from Gold' : 'Remove from this list', () => { removeItem(b.id); });
    // Wie der Clip auf der Spur: Wellenform mit Wörtern und Silbenstrichen; ein Klick
    // auf eine Stelle öffnet die Alternativen genau für dieses Wort bzw. diese Silbe.
    const strip = document.createElement('div');
    strip.className = 'sc-bin-strip';
    const wave = document.createElement('canvas');
    drawWave(wave, b.audio);
    strip.append(wave);
    const dur = b.audio.length / SR, pct = t => `${(100 * t / dur).toFixed(2)}%`;
    b.words.forEach(w => {
      const span = document.createElement('span');
      span.className = `sc-bin-word q ${w.quality}`;
      span.style.left = pct(w.start); span.style.width = pct(Math.max(0.01, w.end - w.start));
      for (const y of (w.syls ?? []).slice(1)) span.insertAdjacentHTML('beforeend', `<i style="left:${(100 * (y.start - w.start) / Math.max(0.01, w.end - w.start)).toFixed(2)}%"></i>`);
      strip.append(span);
    });
    if (!b.snip) {
      strip.title = 'Click a word to swap it or one of its syllables';
      strip.addEventListener('click', ev => {
        ev.stopPropagation();
        const r = strip.getBoundingClientRect(), t = (ev.clientX - r.left) / r.width * dur;
        let wi = b.words.findIndex(w => t >= w.start && t < w.end);
        if (wi < 0) wi = b.words.reduce((k, w, i) => (Math.abs((w.start + w.end) / 2 - t) < Math.abs((b.words[k].start + b.words[k].end) / 2 - t) ? i : k), 0);
        pickAlternative({ ...forBin(b), wi, si: -1, x: ev.clientX, y: r.bottom });
      });
    }
    if (b.story) { /* Szenen tragen ihre Art schon in der Kopfzeile */ }
    else if (b.ai) line.insertAdjacentHTML('afterbegin', '<span class="sc-tag" title="Idea from the language model">AI</span> ');
    else if (b.orig) line.insertAdjacentHTML('afterbegin', '<span class="sc-tag sc-tag-orig" title="As they say it in the video">Orig</span> ');
    if (b.note) li.title = `${b.note}\n\n${li.title}`;
    li.append(play, line, acts, strip);
    li.addEventListener('click', () => selectBin(b.id));
    li.addEventListener('dragstart', ev => {
      dragging = { clip: takeClip(b, 0, 'a1'), item: b };
      ev.dataTransfer.setData('text/plain', b.text);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    li.addEventListener('dragend', () => { dragging = null; S.tl.ghost(null); });
    return li;
  }
}
function showBinTab(tab) {
  if (!S || S.binTab === tab) return;
  S.binTab = tab;
  renderBin();
}
$('bintabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) showBinTab(t.dataset.tab); });
// Ziehen auf „Gold“ (Reiter oder offene Gold-Liste) merkt es dort
for (const el of [$('bintabs'), els.bin]) {
  el.addEventListener('dragover', e => {
    if (!dragging?.item || dragging.item.gold) return;
    if (el === els.bin && S.binTab !== 'gold') return;
    if (el !== els.bin && !e.target.closest('[data-tab="gold"]')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    $('bintabs').querySelector('[data-tab="gold"]').classList.add('drop');
  });
  el.addEventListener('dragleave', () => $('bintabs').querySelector('[data-tab="gold"]').classList.remove('drop'));
  el.addEventListener('drop', e => {
    $('bintabs').querySelector('[data-tab="gold"]').classList.remove('drop');
    if (!dragging?.item || dragging.item.gold) return;
    e.preventDefault();
    saveGold(dragging.item);
    dragging = null;
  });
}

async function recutBin() {
  const st = S;
  for (const b of [...st.bin]) {
    if (b.snip || S !== st) continue;
    try {
      const r = await request({ type: 'mix', text: b.text, speaker: b.speaker ?? null, force: b.force ?? {} });
      if (S !== st) return;
      Object.assign(b, { audio: r.audio, words: r.words, pieces: r.pieces, force: r.force ?? b.force, rev: (b.rev ?? 0) + 1 });
    } catch { /* bleibt, wie es war */ }
  }
  if (S === st) { renderBin(); save(); }
}

function selectBin(id) {
  S.binSel = id;
  focusArea = 'bin';
  for (const li of els.bin.children) li.classList.toggle('on', li.dataset.id === id);
}

function updateBin(id, o) {
  const b = S.bin.find(x => x.id === id);
  if (!b) return;
  Object.assign(b, { audio: o.audio, words: o.words, pieces: o.segs, force: o.force, rev: b.rev + 1 }, o.text ? { text: o.text } : {});
  renderBin();
  save();
}

/** Clip-Daten eines Takes aus der Ablage. */
function takeClip(b, at, track) {
  if (b.snip) return { track, type: 'snip', at, len: b.snip.e - b.snip.s, src: b.snip.s, label: b.text, speed: 1, gain: 1 };
  return { track, type: 'take', at, len: b.audio.length / SR, src: 0, label: b.text, speed: 1, gain: 1,
    take: { text: b.text, audio: b.audio, words: b.words, pieces: b.pieces, speaker: b.speaker, force: b.force, rev: 0 } };
}

function placeTake(b, at, track) {
  const { tl } = S;
  tl.commit();
  const c = tl.add(takeClip(b, at, track));
  tl.setPlayhead(endOf(c));
  tl.changed();
  tl.select(c.id);
  reveal(c);
  S.player.play(c.at, { until: endOf(c) });
}

/** Kleine Wellenform für die Ablage. */
function drawWave(cv, data) {
  const w = 320, h = 30;
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = getComputedStyle(els.studio).getPropertyValue('--c-onset-1') || '#c80';
  let peak = 1e-3;
  for (let i = 0; i < data.length; i += 13) peak = Math.max(peak, Math.abs(data[i]));
  const step = data.length / w;
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (let i = Math.floor(x * step); i < (x + 1) * step; i += 4) m = Math.max(m, Math.abs(data[i] ?? 0));
    const y = (m / peak) * h / 2;
    g.fillRect(x, h / 2 - y, 1, Math.max(1, 2 * y));
  }
}

// ---------------------------------------------------------------- Ziehen auf die Zeitleiste
let dragging = null;          // { clip } – was gerade aus Ablage oder Suche gezogen wird
let focusArea = 'timeline';   // wohin Strg+C/V gehen
els.timeline.addEventListener('dragover', e => {
  if (!dragging || !S) return;
  const tr = S.tl.rowAt(e);
  if (tr?.kind !== 'audio') { S.tl.ghost(null); return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const at = Math.max(0, S.tl.snap(S.tl.timeAt(e), new Set()));
  S.tl.ghost({ track: tr.id, at, len: dragging.clip.len });
});
els.timeline.addEventListener('dragleave', e => { if (!els.timeline.contains(e.relatedTarget)) S?.tl.ghost(null); });
els.timeline.addEventListener('drop', e => {
  if (!dragging || !S) return;
  e.preventDefault();
  const tr = S.tl.rowAt(e);
  S.tl.ghost(null);
  if (tr?.kind !== 'audio') return;
  const { tl } = S;
  tl.commit();
  const c = tl.add({ ...dragging.clip, track: tr.id, at: Math.max(0, tl.snap(tl.timeAt(e), new Set())) });
  dragging = null;
  tl.setPlayhead(endOf(c));
  tl.changed();
  tl.select(c.id);
  focusArea = 'timeline';
});
els.timeline.addEventListener('pointerdown', () => { focusArea = 'timeline'; });

/** Einen neuen Clip gut sichtbar machen: so weit hineinzoomen, dass seine Wörter lesbar sind. */
function reveal(c) {
  const { tl } = S, w = tl.scroll.clientWidth;
  if (c.len * tl.pps < Math.min(260, w * 0.3)) tl.zoom(Math.min(w * 0.3, 400) / c.len, c.at, w * 0.15);
  else tl.setPlayhead(tl.playhead, { follow: true });
  syncZoomSlider();
}

const speaker = () => (S.speakers.length > 1 ? Number(els.voiceSel.value) : null);

/** Ein Stück Originalstimme (Wort, Silbe, Laut) am Abspielkopf einsetzen. */
function insertSnip({ label, s, e }) {
  const { tl } = S;
  tl.commit();
  const c = tl.add({ track: voiceTrack(), type: 'snip', at: tl.playhead, len: e - s, src: s, label });
  tl.setPlayhead(endOf(c), { follow: true });
  tl.changed();
  tl.select(c.id);
  S.player.sync(tl.playhead);
  return c;
}

// ---------------------------------------------------------------- Lippen
/** Zu Ton-Clips die passenden Videostellen als Lippen-Schnipsel auf die oberste Bildspur legen. */
function lips(cs, on) {
  const { tl } = S;
  tl.commit();
  const ids = new Set(cs.map(c => c.id));
  tl.clips = tl.clips.filter(x => !ids.has(x.ref));
  if (on) for (const c of cs) for (const x of lipsFor(c)) tl.add(x);
  tl.changed();
}
/** Lippen-Schnipsel (Clip-Daten) zu einem Ton-Clip. */
function lipsFor(c) {
  const res = [];
  {
    // Stücke im Ton des Clips (Quelle → Video-Zeit), nur der benutzte Teil
    const parts = c.type === 'take' ? c.take.pieces.map(p => ({ a: p.at, b: p.at + p.len, v: p.start })) : [{ a: c.src, b: c.src + srcSpan(c), v: c.src }];
    const segs = [];
    for (const p of parts) {
      const a = Math.max(p.a, Math.min(c.src, c.src + srcSpan(c))), b = Math.min(p.b, c.src + srcSpan(c));
      if (b - a < 0.02) continue;
      let t0 = timeOf(c, a), t1 = timeOf(c, b);
      if (t0 > t1) [t0, t1] = [t1, t0];
      segs.push({ t0, t1, src: p.v + (a - p.a), short: b - a < LIPS_MIN });
    }
    // Kurze Stücke (einzelne Laute, Silben) bekommen kein eigenes Bild: Das Bild davor läuft
    // weiter (wie ein J-Cut), am Anfang setzt das nächste Bild entsprechend früher ein.
    // Rückwärts bleibt jedes Stück für sich.
    const out = [];
    let lead = 0;
    for (const sg of c.reverse ? segs : segs.sort((x, y) => x.t0 - y.t0)) {
      if (!c.reverse && sg.short && out.length) { out.at(-1).t1 = sg.t1; continue; }
      if (!c.reverse && sg.short) { lead += sg.t1 - sg.t0; continue; }
      if (lead) { sg.src = Math.max(0, sg.src - lead * speedOf(c)); sg.t0 -= lead; lead = 0; }
      out.push(sg);
    }
    if (lead && !out.length) out.push({ ...segs[0], t1: segs.at(-1).t1 });   // nur kurze Stücke: eins für alle
    for (const sg of out) res.push({ track: lipsTrack(), type: 'lips', at: sg.t0, len: sg.t1 - sg.t0, src: sg.src, speed: speedOf(c), reverse: !!c.reverse, label: '', ref: c.id });
  }
  return res;
}
const hasLips = c => S.tl.clips.some(x => x.ref === c.id);
const LIPS_MIN = 0.25;          // kürzere Stücke zeigen kein eigenes Bild
/** Ton aus der Stimme des Videos: Dazu gibt es Lippen. */
const isVoiced = c => c.type === 'take' || c.type === 'snip' || c.type === 'orig';

// ---------------------------------------------------------------- Inspektor
function inspect(sel) {
  const box = els.inspector;
  box.replaceChildren();
  if (!S) return;
  if (!sel.length) {
    box.innerHTML = `<p class="sc-hint">Type a sentence and press <b>Cut it</b>: it lands in the list above. Click its words for alternatives,
      then drag it onto a track (or press +). Right-click clips on the timeline for more.</p>`;
    return;
  }
  const c = sel[0], many = sel.length > 1;
  const h = document.createElement('div');
  h.className = 'sc-insp-head';
  const title = many ? `${sel.length} clips` : { take: 'Sentence', snip: 'Snippet', orig: c.label, music: 'Music', video: 'Video', lips: 'Lips' }[c.type];
  const a = Math.min(...sel.map(x => x.at)), b = Math.max(...sel.map(endOf));
  h.innerHTML = `<strong>${esc(title)}</strong><span>${clock(a)} – ${clock(b)}</span>`;
  box.append(h);

  if (!many && c.type === 'take') {
    const line = document.createElement('p');
    line.className = 'sc-insp-line';
    c.take.words.forEach((w, wi) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sc-chip q ${w.quality}`;
      b.textContent = w.w;
      b.title = 'Alternatives for this word';
      b.addEventListener('click', () => { const r = b.getBoundingClientRect(); pickAlternative({ ...forClip(c), wi, si: -1, x: r.left, y: r.bottom }); });
      line.append(b, ' ');
    });
    box.append(line);
  }

  // Eigenschaften: Tempo, Richtung, Lautstärke (für alle gewählten gleich)
  const props = document.createElement('div');
  props.className = 'sc-props';
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const sp = speedOf(c), audioSel = sel.some(x => S.tl.kindOf(x) === 'audio');
  props.innerHTML = `
    <label>Speed <select data-p="speed">${speeds.map(v => `<option value="${v}"${v === sp ? ' selected' : ''}>${v}×</option>`).join('')}</select></label>
    <label class="sc-check"><input type="checkbox" data-p="reverse"${c.reverse ? ' checked' : ''}> Backwards</label>
    ${audioSel ? `<label>Volume <input type="range" data-p="gain" min="-24" max="12" step="1" value="${Math.round(20 * Math.log10(c.gain ?? 1))}"><output>${Math.round(20 * Math.log10(c.gain ?? 1))} dB</output></label>` : ''}
    <label>Fade in <input type="number" data-p="fadeIn" min="0" step="10" value="${Math.round(((c.fadeIn ?? 0) - (c.extIn ?? 0)) * 1000)}"> ms</label>
    <label>Fade out <input type="number" data-p="fadeOut" min="0" step="10" value="${Math.round(((c.fadeOut ?? 0) - (c.extOut ?? 0)) * 1000)}"> ms</label>`;
  props.addEventListener('change', e => {
    const p = e.target.dataset.p;
    if (!p) return;
    S.tl.commit();
    for (const x of sel) {
      const y = S.tl.get(x.id);
      if (!y) continue;
      if (p === 'speed') setSpeed(y, Number(e.target.value));
      if (p === 'reverse') y.reverse = e.target.checked;
      if (p === 'gain') y.gain = 10 ** (Number(e.target.value) / 20);
      if (p === 'fadeIn') y.fadeIn = Math.min(y.len / 2, Math.max(0, e.target.value / 1000)) + (y.extIn ?? 0);
      if (p === 'fadeOut') y.fadeOut = Math.min(y.len / 2, Math.max(0, e.target.value / 1000)) + (y.extOut ?? 0);
      // Lippen-Schnipsel folgen ihrem Ton-Clip
      if (p === 'speed' || p === 'reverse') for (const l of S.tl.clips.filter(z => z.ref === y.id)) { l.speed = y.speed; l.reverse = y.reverse; }
    }
    if ((p === 'speed' || p === 'reverse') && sel.some(hasLips)) { S.tl.history.pop(); lips(sel.filter(hasLips).map(x => S.tl.get(x.id)), true); }
    else S.tl.changed();
  });
  props.addEventListener('input', e => { if (e.target.dataset.p === 'gain') e.target.nextElementSibling.textContent = `${e.target.value} dB`; });
  box.append(props);

  const acts = document.createElement('div');
  acts.className = 'sc-insp-acts';
  const btn = (label, fn, ic, title = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sc-act'; b.title = title; if (ic) b.append(icon(ic, { size: '14px' }), ' '); b.append(label); b.addEventListener('click', fn); acts.append(b); return b; };
  if (!many) btn('Listen', () => S.player.play(c.at, { until: endOf(c) }), 'play');
  const voiced = sel.filter(isVoiced);
  if (voiced.length) {
    const on = voiced.every(hasLips);
    btn(on ? 'Hide lips' : 'Show lips', () => lips(voiced, !on), 'film', 'L · Put the video of them saying each piece on the Lips track');
  }
  if (voiced.length && voiced.some(x => clipText(x))) btn('Save in Gold', () => clipsToList(voiced).then(pulseGold).catch(err => fail(err.message)), 'star', 'Keep this in the Gold list, to edit or reuse it');
  if (voiced.length && voiced.some(x => clipText(x))) btn('AI rewrite', () => aiRewrite(voiced), 'sparkles', 'Let a language model turn this into YTP versions (needs your OpenRouter key under Find gold)');
  if (!many && c.type === 'snip') {
    const row = document.createElement('div');
    row.className = 'sc-nudge';
    row.innerHTML = `<span>Start</span><button type="button" data-n="s-">−10 ms</button><button type="button" data-n="s+">+10 ms</button>
      <span>End</span><button type="button" data-n="e-">−10 ms</button><button type="button" data-n="e+">+10 ms</button>`;
    row.addEventListener('click', ev => {
      const n = ev.target.dataset.n;
      if (!n) return;
      const d = n.endsWith('+') ? 0.01 : -0.01;
      S.tl.commit();
      if (n[0] === 's') { const nd = Math.max(-c.src, Math.min(c.len - 0.02, d)); c.src += nd; c.len -= nd; }
      else c.len = Math.max(0.02, c.len + d);
      S.tl.changed();
      S.player.listen(S.voice, c.src, c.src + c.len);
    });
    box.append(row);
  }
  const pics = sel.every(x => S.tl.kindOf(x) === 'video'), off = sel.every(x => x.muted);
  if (pics) btn(off ? 'Show' : 'Hide', () => tools.mute(), off ? 'eye' : 'eye-off', 'M · Hide this picture (the clip stays where it is)');
  else btn(off ? 'Unmute' : 'Mute', () => tools.mute(), off ? 'volume-2' : 'volume-x', 'M');
  btn('Delete', () => tools.del(), 'trash', 'Del (Shift+Del closes the gap)');
  box.append(acts);
  const found = aiFor(sel);
  if (found) box.append(found.el);
}

// ---------------------------------------------------------------- KI: Warten und Streamen
/** Statuszeile, solange das Modell nachdenkt (mit Sekunden), danach was gerade geschieht. */
function modelStatus(say) {
  const t0 = Date.now();
  let phase = 'thinking';
  const tick = () => { if (phase === 'thinking') say(`The model is thinking… ${Math.round((Date.now() - t0) / 1000)} s`); };
  const timer = setInterval(tick, 1000);
  tick();
  return { phase: p => { phase = p; if (p === 'writing') say('Results are coming in…'); else tick(); }, stop: () => clearInterval(timer) };
}
/** Arbeitet Aufgaben nacheinander ab (Schneiden im Worker), während der Stream weiterläuft. */
function queue() {
  let chain = Promise.resolve();
  return { add: fn => { chain = chain.then(fn).catch(() => {}); }, done: () => chain };
}

// ---------------------------------------------------------------- KI: Stelle umschreiben
// Ergebnisse bleiben, auch nach „Use“ und Rückgängig: Sie gelten für die Clips, für die sie
// geholt wurden, und für jeden Clip, der daraus entstanden ist. { keys: Set, el }
const aiResults = [];
const selKey = sel => sel.map(x => x.id).sort().join();
const aiFor = sel => (sel.length ? aiResults.findLast(r => r.keys.has(selKey(sel))) : null);

/** Was in einem Ton-Clip gesagt wird (nur der sichtbare Teil). */
function clipText(c) {
  if (c.type === 'take') {
    const a = c.src, b = c.src + c.len * speedOf(c);
    return c.take.words.filter(w => w.end > a + 0.02 && w.start < b - 0.02).map(w => w.w).join(' ');
  }
  return clipWords(c).map(i => S.words[i].w).join(' ');
}
const clipWords = c => S.words.map((w, i) => i).filter(i => S.words[i].e > S.words[i].s && S.words[i].s >= c.src - 0.02 && S.words[i].e <= c.src + c.len * speedOf(c) + 0.02);
function clipSpeaker(c) {
  if (S.speakers.length < 2) return null;
  if (c.type === 'take') return c.take.speaker ?? null;
  const n = new Map();
  for (const i of clipWords(c)) n.set(S.words[i].spk, (n.get(S.words[i].spk) ?? 0) + 1);
  return [...n].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
}

/** Die gewählten Clips von einem Sprachmodell umschreiben lassen; Ergebnisse zum Anhören und Einsetzen. */
async function aiRewrite(cs) {
  cs = [...cs].sort((a, b) => a.at - b.at);
  const line = cs.map(clipText).filter(Boolean).join(' ');
  const key = ideas.key.value.trim(), model = ideas.model.value.trim() || DEFAULT_MODEL;
  if (!key) {
    if (ideas.box.hidden) ideas.btn.click();
    ideas.status.textContent = 'Enter your OpenRouter key here first, then try AI rewrite again.';
    $('ideas-keys').open = true; ideas.key.focus();
    return;
  }
  const spk = clipSpeaker(cs[0]);
  const el = document.createElement('div');
  el.className = 'sc-ai';
  el.innerHTML = `<p class="sc-ai-from">“${esc(line)}”</p>`;
  const busy = document.createElement('p');
  busy.className = 'sc-busy';
  busy.innerHTML = '<span class="sc-busy-ring"></span><span class="sc-busy-text">Asking the model…</span>';
  el.append(busy);
  const entry = { keys: new Set([selKey(cs)]), el };
  aiResults.push(entry);
  if (aiResults.length > 20) aiResults.shift();
  inspect(S.tl.selection());
  const say = t => { busy.querySelector('.sc-busy-text').textContent = t; };
  const list = document.createElement('ol');
  list.className = 'sc-ai-list';
  busy.before(list);
  const st = modelStatus(say), q = queue();
  const pick = streamPick(5, ({ text, r }) => list.append(aiVersion(entry, list, { text, audio: r.audio, words: r.words, pieces: r.pieces, speaker: spk, force: r.force, ai: true, id: newId() })));
  try {
    const ws = S.words.filter(w => spk == null || w.spk === spk);
    let n = 0;
    const { pron } = await request({ type: 'pron', words: vocabulary(ws) });
    await rewriteIdeas({ key, model, words: ws, lang: S.lang, line, pron, onPhase: st.phase,
      onLine: text => q.add(async () => {
        n++;
        const r = await request({ type: 'mix', text, speaker: spk });
        pick.offer({ text, r, cost: buildCost(r.words) });
        say(`${pick.count} versions so far – cutting more…`);
      }) });
    st.phase('writing');
    await q.done();
    if (!pick.finish()) throw new Error(n ? 'None of the versions could be cut cleanly. Try again.' : 'The model sent no usable versions. Try again.');
    busy.remove();
  } catch (err) {
    busy.className = 'sc-note';
    busy.textContent = err.message;
  } finally { st.stop(); }
}

/** Eine Fassung in der Umschreib-Liste: anhören, Wörter ziehen, ☆, „Use“. */
function aiVersion(entry, list, b) {
  const li = document.createElement('li');
  li.draggable = true;
  li.title = 'Drag onto a track (or onto Gold) to add it anywhere · drag a single word to use it alone';
  li.addEventListener('dragstart', ev => {
    dragging = { clip: takeClip(b, 0, 'a1'), item: b };
    ev.dataTransfer.setData('text/plain', b.text);
    ev.dataTransfer.effectAllowed = 'copy';
  });
  li.addEventListener('dragend', () => { dragging = null; S.tl.ghost(null); });
  const play = document.createElement('button');
  play.type = 'button'; play.className = 'sc-mini'; play.setAttribute('aria-label', 'Listen'); play.title = 'Listen';
  play.append(icon('play', { size: '13px' }));
  play.addEventListener('click', () => S.player.listen(b.audio));
  const t = document.createElement('span');
  t.className = 'sc-ai-text';
  b.words.forEach((w, wi) => {
    const x = document.createElement('span');
    x.className = `sc-ai-word q ${w.quality}`;
    x.textContent = w.w;
    x.title = 'Drag this word onto a track or onto Gold · right-click for more';
    wordHandle(x, b, wi);
    t.append(x, ' ');
  });
  const star = document.createElement('button');
  star.type = 'button'; star.className = 'sc-mini sc-add sc-star' + (inGold(b) ? ' on' : ''); star.title = 'Save in Gold';
  star.append(icon('star', { size: '14px' }));
  star.addEventListener('click', () => { saveGold(b); star.classList.add('on'); });
  const use = document.createElement('button');
  use.type = 'button'; use.className = 'sc-act sc-ai-use'; use.textContent = 'Use';
  use.title = 'Replace the selected clips with this version (the other versions stay here)';
  use.addEventListener('click', () => { useRewrite(entry, b); for (const x of list.children) x.classList.toggle('on', x === li); });
  li.append(play, t, star, use);
  return li;
}

/** Die gewählten Clips durch eine Fassung ersetzen (an der Stelle des ersten, auf seiner Spur). */
function useRewrite(entry, b) {
  const { tl } = S;
  const cs = tl.selection().filter(isVoiced);
  if (!cs.length || !entry.keys.has(selKey(cs))) return;
  tl.commit();
  const hadLips = cs.some(hasLips);
  const at = Math.min(...cs.map(c => c.at)), track = cs[0].track, gain = cs[0].gain ?? 1;
  tl.remove(withLips(cs).map(c => c.id));
  const n = tl.add({ ...takeClip(b, at, track), gain });
  entry.keys.add(n.id);
  tl.changed();
  tl.select(n.id);
  if (hadLips) { tl.history.pop(); lips([n], true); }
  S.player.play(n.at, { until: endOf(n) });
}

/** Tempo ändern: Die Dauer auf der Zeitleiste ändert sich, die Quelle bleibt dieselbe. */
function setSpeed(c, v) {
  const span = srcSpan(c);
  c.speed = v;
  c.len = span / v;
  c.fadeIn = Math.min(c.fadeIn ?? 0, c.len / 2); c.fadeOut = Math.min(c.fadeOut ?? 0, c.len / 2);
}

// ---------------------------------------------------------------- Alternativen (im Clip)
const pop = $('pop');
function closePop() { pop.hidden = true; pop.replaceChildren(); }
document.addEventListener('pointerdown', e => { if (!pop.hidden && !e.target.closest('#pop, .tl-word, .sc-chip, .sc-bin-strip')) closePop(); });
document.addEventListener('pointerdown', e => { if (e.target.closest('.sc-bin')) focusArea = 'bin'; else if (e.target.closest('.tl')) focusArea = 'timeline'; });

/** Was die Alternativen ändern: ein Take auf der Zeitleiste … */
function forClip(c) {
  return { take: () => S.tl.get(c.id)?.take, use: o => replaceTake(S.tl.get(c.id), o), before: () => S.tl.select(c.id) };
}
/**
 * Wort in der Originalstimme: Das Stück wird als Satz geschnitten, in dem jedes
 * Wort an seinem Vorkommen festhängt (klingt wie vorher). Erst wenn man eine
 * Alternative wählt, ersetzt dieser Satz das Stück auf der Spur.
 */
async function editSourceWord({ clip: c, si, x, y }) {
  if (speedOf(c) !== 1 || c.reverse) { fail('Words can be swapped in clips at normal speed and direction.'); return; }
  const a = c.src, b = c.src + c.len;
  const idx = S.words.map((w, i) => i).filter(i => S.words[i].e > S.words[i].s && S.words[i].s >= a - 0.02 && S.words[i].e <= b + 0.02);
  if (!idx.includes(si)) return;
  const spk = S.words[si].spk;
  const r = await request({ type: 'phrase', si: idx, speaker: S.speakers.length > 1 ? spk : null });
  const pending = { text: r.text, audio: r.audio, words: r.words, pieces: r.pieces, speaker: r.speaker, force: r.force, rev: 0 };
  const w0 = S.words[idx[0]];
  pickAlternative({
    take: () => pending,
    before: () => S.tl.select(c.id),
    wi: idx.indexOf(si), si: -1, x, y,
    // erster Tausch: das Stück Originalstimme wird zum Satz-Clip, danach geht es dort weiter
    use: o => {
      const { tl } = S;
      tl.commit();
      const at = c.at + (w0.s - c.src) - o.words[0].start;
      tl.remove([c.id]);
      const text = o.text ?? pending.text;
      const n = tl.add({ track: c.track, type: 'take', at: Math.max(0, at), len: o.audio.length / SR, src: 0, label: text, gain: c.gain ?? 1,
        take: { ...pending, text, audio: o.audio, words: o.words, pieces: o.segs, force: o.force, rev: 1 } });
      tl.changed();
      tl.select(n.id);
      return forClip(n);
    },
  });
}

/** … oder einer in der Ablage. */
function forBin(b) {
  return { take: () => S.bin.find(x => x.id === b.id), use: o => updateBin(b.id, o), before: () => selectBin(b.id) };
}

/**
 * Feld zum Tauschen eines Worts oder einer Silbe.
 *   Kopf:   das Wort, ▶ (hört es), ✕
 *   Ändern: [ganzes Wort] [Gi] [gan] [ten] – was getauscht wird
 *   Liste:  ● aktuelle Fassung, ○ Alternativen. Klick = übernehmen und anhören, ▶ = nur anhören
 *   Fuß:    anhören „im Satz“ oder „allein“
 */
let hearMode = 'alone';
async function pickAlternative(target) {
  const { wi, x, y } = target;
  const t = target.take();
  if (!t) return;
  const w = t.words[wi];
  const nsyl = w.syls?.length ?? 0;
  const si = nsyl > 1 && target.si >= 0 && target.si < nsyl ? target.si : -1;
  target.before?.();
  const word = w.w.replace(/[^\p{L}\p{N}'-]/gu, '');
  const sylNames = nsyl > 1 ? (orthoSyllables(word, nsyl) ?? w.syls.map(s => s.text)) : [];
  // „alone“: nur das Wort bzw. die Silbe; „sentence“: der ganze Satz
  const hearSpan = (take, i = wi, k = si) => (hearMode === 'sentence' ? [0, take.audio.length / SR] : spanOf(take.words, i, k));

  pop.replaceChildren();
  pop.hidden = false;
  const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

  const head = el('div', 'sc-pop-head');
  // Das Wort selbst ist ein Eingabefeld: umschreiben und Enter – auch mehrere Wörter, leer = löschen
  const title = el('input', 'sc-pop-title');
  title.value = w.w;
  title.spellcheck = true;
  title.title = 'Type to change the word, then press Enter (empty = remove it)';
  title.setAttribute('aria-label', 'Word');
  title.addEventListener('keydown', async ev => {
    if (ev.key === 'Escape') { closePop(); return; }
    if (ev.key !== 'Enter' || title.value.trim() === w.w.trim()) return;
    ev.preventDefault();
    title.disabled = true;
    try {
      const tk = target.take();
      const r = await request({ type: 'rewrite', text: tk.text, speaker: tk.speaker, force: tk.force, wi, replacement: title.value });
      const next = target.use({ audio: r.audio, words: r.words, segs: r.pieces, force: r.force, text: r.text });
      const nt = { ...target, ...(next ?? {}), si: -1 };
      if (r.wi >= 0) { S.player.listen(r.audio, ...spanOf(r.words, r.wi, -1)); pickAlternative({ ...nt, wi: r.wi }); } else closePop();
    } catch (err) { title.disabled = false; fail(err.message); }
  });
  const play = el('button', 'sc-mini');
  play.type = 'button'; play.title = 'Listen'; play.append(icon('play', { size: '13px' }));
  play.addEventListener('click', () => { const tk = target.take(), [a, b] = hearSpan(tk); S.player.listen(tk.audio, a, b); });
  const close = el('button', 'sc-mini sc-close', '×');
  close.type = 'button'; close.title = 'Close (Esc)';
  close.addEventListener('click', closePop);
  head.append(title, play, close);

  const change = el('div', 'sc-change');
  if (nsyl > 1) {
    change.append(el('span', 'sc-change-label', 'Change'));
    const opts = [['whole word', -1], ...sylNames.map((n, k) => [n, k])];
    for (const [label, k] of opts) {
      const b = el('button', 'sc-seg-btn' + (k === si ? ' on' : ''));
      b.type = 'button';
      b.textContent = label;
      b.title = k < 0 ? 'Swap the whole word' : `Swap only this syllable`;
      b.addEventListener('click', () => pickAlternative({ ...target, si: k }));
      change.append(b);
    }
  }

  const list = el('ol', 'sc-alts');
  list.append(el('li', 'sc-hint', si < 0 ? 'Looking for other ways to say it…' : 'Looking for this syllable elsewhere…'));

  // Anhören: nur das Stück oder den ganzen Satz – ein Klick spielt gleich zur Probe
  const foot = el('div', 'sc-pop-foot');
  foot.append(el('span', '', 'Listen to'));
  const what = si < 0 ? 'the word' : 'the syllable';
  for (const [mode, label] of [['alone', `just ${what}`], ['sentence', 'the whole sentence']]) {
    const b = el('button', 'sc-seg-btn' + (hearMode === mode ? ' on' : ''));
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => {
      hearMode = mode;
      for (const x of foot.querySelectorAll('.sc-seg-btn')) x.classList.toggle('on', x === b);
      const tk = target.take(), [a, z] = hearSpan(tk);
      S.player.listen(tk.audio, a, z);
    });
    foot.append(b);
  }
  pop.append(head, ...(nsyl > 1 ? [change] : []), list, foot);
  place(pop, x, y);

  try {
    const r = await request(si < 0
      ? { type: 'variants', text: t.text, speaker: t.speaker, force: t.force, wi }
      : { type: 'sylVariants', text: t.text, speaker: t.speaker, force: t.force, wi, si });
    if (pop.hidden) return;
    if (r.options.length <= 1) list.append(el('li', 'sc-hint', 'No other way to say it in this video.'));
    list.querySelector('.sc-hint')?.remove();
    for (const o of r.options) {
      const li = el('li', o.current ? 'current' : '');
      const dot = el('span', `sc-dot ${o.quality}`);
      const main = el('button', 'sc-alt-main');
      main.type = 'button';
      const { name, detail, context, best } = altText(o, si, sylNames);
      const nameEl = el('span', 'sc-alt-name', esc(name));
      if (best) nameEl.append(' ', el('span', 'sc-best', 'fits best'));
      main.append(nameEl, el('small', '', esc(detail)));
      if (context) main.append(el('small', 'sc-alt-ctx', `“…${esc(context)}…”`));
      main.title = (o.current ? 'In use' : 'Use this one') + (best ? ' · joins most smoothly with the rest of the sentence' : '');
      main.addEventListener('click', () => {
        const next = o.current ? null : target.use(o);
        const [a, b] = hearSpan(o);
        S.player.listen(o.audio, a, b);
        if (!o.current) pickAlternative({ ...target, ...(next ?? {}), si });
      });
      const hear = el('button', 'sc-mini');
      hear.type = 'button'; hear.title = 'Just listen'; hear.append(icon('play', { size: '12px' }));
      hear.addEventListener('click', () => { const [a, b] = hearSpan(o); S.player.listen(o.audio, a, b); });
      li.append(dot, main, hear);
      list.append(li);
    }
    place(pop, x, y);
  } catch (err) { list.replaceChildren(el('li', 'sc-hint', esc(err.message))); }
}

/**
 * Beschriftung einer Alternative, in Alltagssprache: was man hört und woher es
 * kommt („gan – the middle of “Giganten”, 0:14“), Herkunft klein darunter.
 */
function altText(o, si, sylNames) {
  const i = o.info ?? { kind: 'mix', from: [] };
  const use = o.current ? 'In use · ' : '';
  const time = i.at != null ? ` · ${clock(i.at, false)}` : '';
  const where = { all: 'all of', start: 'the start of', end: 'the end of', middle: 'the middle of' }[i.pos] ?? 'part of';
  if (i.kind === 'whole') {
    // wie es neben den Nachbarwörtern klingt, und wo es herkommt
    const f = o.feel, how = [];
    if (f?.pitch != null && Math.abs(f.pitch) >= 1.5) how.push(`${Math.abs(f.pitch) >= 4 ? 'much ' : ''}${f.pitch > 0 ? 'higher' : 'lower'}`);
    if (f?.tempo != null && (f.tempo > 1.2 || f.tempo < 0.83)) how.push(f.tempo > 1 ? 'slower' : 'faster');
    const feel = f ? (how.length ? `${how.join(', ')} than the words around it` : 'matches the words around it') : 'the whole word from the video';
    return { name: `${use}“${i.word}”`, detail: `${feel}${time}`, context: i.context, best: o.best };
  }
  if (i.kind === 'stem' && i.swap) return { name: `${use}“${i.word}” with ${i.swap}`, detail: `the word “${i.word}” from the video, one sound swapped${time}`, context: i.context, best: o.best };
  if (i.kind === 'stem') {
    const added = [i.before, i.after].filter(Boolean).map(x => `“${x}”`).join(' and ');
    return { name: `${use}${[i.before, `“${i.word}”`, i.after].filter(Boolean).join(' + ')}`,
      detail: `the whole word “${i.word}” from the video, ${added} added${time}`, context: i.context, best: o.best };
  }
  if (i.kind === 'syllable') return { name: `${use}${where} “${i.word}”`, detail: `sounds like “${sylNames[si] ?? ''}”${i.similar ? ' (close, not exact)' : ''}${time}` };
  const from = [...new Set(i.from)];
  if (from.length === 1) return { name: `${use}pieces of “${from[0]}”`, detail: 'put together from several spots' };
  return { name: `${use}pieces of ${from.length} words`, detail: from.join(' + ') };
}

/** Geschriebene Silben (Näherung): Vokalgruppen trennen, ein Konsonant geht zur nächsten Silbe. */
function orthoSyllables(word, n) {
  const groups = [...word.matchAll(/(?:ei|ie|au|eu|äu|ai|[aeiouäöüy])+/gi)];
  if (groups.length !== n) return null;
  const cuts = [];
  for (let k = 0; k + 1 < groups.length; k++) {
    const a = groups[k].index + groups[k][0].length, b = groups[k + 1].index;
    const cons = word.slice(a, b);
    const keep = /(sch|ch|ck|ph|th|qu)$/i.exec(cons)?.[0].length ?? (cons.length ? 1 : 0);
    cuts.push(b - Math.min(keep, cons.length));
  }
  return [0, ...cuts].map((c, i) => word.slice(c, cuts[i] ?? word.length));
}

/** Zeitspanne eines Worts (si < 0) oder einer Silbe im Ton des Takes, mit kleinem Rand. */
function spanOf(words, wi, si) {
  const w = words[wi], x = si >= 0 && w.syls?.[si] ? w.syls[si] : w;
  return [Math.max(0, x.start - 0.012), x.end + 0.02];
}
/** Klappfeld neben die Klickstelle setzen, im Fenster halten. */
function place(el, x, y) {
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - 20))}px`;
  el.style.top = `${y + h + 16 > innerHeight ? Math.max(8, y - h - 12) : y + 12}px`;
}

function replaceTake(c, o) {
  const { tl } = S;
  tl.commit();
  const hadLips = hasLips(c);
  const sp = speedOf(c);
  // Zeigte der Clip nur einen Teil des Satzes (geteilt, getrimmt), bleibt es dieser Teil
  const [s0, s1] = keptSpan(c.take.words, o.words, c.src, c.src + c.len * sp, o.audio.length / SR);
  c.take = { ...c.take, audio: o.audio, words: o.words, pieces: o.segs, force: o.force, rev: (c.take.rev ?? 0) + 1 };
  if (o.text) { c.take.text = o.text; c.label = o.text; }
  c.src = s0; c.len = (s1 - s0) / sp; c.fadeIn = c.extIn ?? 0; c.fadeOut = c.extOut ?? 0;
  tl.clear(c.track, c.at, c.len, c.id);
  tl.changed();
  if (hadLips) { tl.history.pop(); lips([c], true); }
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ---------------------------------------------------------------- Bausteine finden
let findTimer = 0;
els.find.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(async () => {
    const q = els.find.value.trim();
    if (!q || !S) { els.results.replaceChildren(); return; }
    const r = await request({ type: 'find', query: q, speaker: speaker() });
    if (els.find.value.trim() !== q) return;
    if (!r.results.length) { els.results.innerHTML = '<li class="sc-hint">Nothing like that in the video.</li>'; return; }
    els.results.replaceChildren(...r.results.map(x => {
      const li = document.createElement('li');
      const play = document.createElement('button');
      play.type = 'button'; play.className = 'sc-mini'; play.setAttribute('aria-label', 'Listen');
      play.append(icon('play', { size: '13px' }));
      play.addEventListener('click', () => S.player.listen(S.voice, x.s, x.e));
      const label = document.createElement('span');
      label.className = 'sc-res-label';
      label.innerHTML = x.kind === 'word' ? `<b>${esc(x.label)}</b>` : `<b>${esc(x.label)}</b> <small>in “${esc(x.context)}”</small>`;
      const t = document.createElement('small');
      t.className = 'sc-res-time';
      t.textContent = clock(x.s);
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'sc-mini sc-add'; add.title = 'Place at the playhead';
      add.append(icon('plus', { size: '14px' }));
      add.addEventListener('click', () => { const c = insertSnip({ label: x.label, s: x.s, e: x.e }); S.player.play(c.at, { until: endOf(c) }); });
      const star = document.createElement('button');
      star.type = 'button'; star.className = 'sc-mini sc-add sc-star'; star.title = 'Save in Gold';
      star.append(icon('star', { size: '14px' }));
      star.addEventListener('click', () => { saveGold(snipItem(x)); star.classList.add('on'); });
      li.append(play, label, t, star, add);
      li.draggable = true;
      li.title = 'Drag onto a track';
      li.addEventListener('dragstart', ev => {
        dragging = { clip: { track: 'a1', type: 'snip', at: 0, len: x.e - x.s, src: x.s, label: x.label, speed: 1, gain: 1 }, item: snipItem(x) };
        ev.dataTransfer.setData('text/plain', x.label);
        ev.dataTransfer.effectAllowed = 'copy';
      });
      li.addEventListener('dragend', () => { dragging = null; S.tl.ghost(null); });
      return li;
    }));
  }, 180);
});

// ---------------------------------------------------------------- Werkzeuge
let clipboard = [];
const selIds = () => [...S.tl.sel];
const withLips = cs => { const ids = new Set(cs.map(c => c.id)); return S.tl.clips.filter(c => ids.has(c.id) || ids.has(c.ref)); };
const tools = {
  play: () => S.player.toggle(),
  split: () => {
    // Die gewählten Clips unter dem Abspielkopf – sonst alles unter dem Abspielkopf
    const { tl } = S, t = tl.playhead;
    const inside = tl.selection().filter(c => t > c.at + 0.01 && t < endOf(c) - 0.01).map(c => c.id);
    tl.commit();
    if (!tl.split(t, inside.length ? new Set(inside) : null)) tl.history.pop();
    tl.changed();
  },
  mute: () => { const cs = S.tl.selection(); if (!cs.length) return; S.tl.commit(); const on = !cs.every(c => c.muted); for (const c of cs) c.muted = on; S.tl.changed(); },
  copy: () => {
    const b = focusArea === 'bin' && S.bin.find(x => x.id === S.binSel);
    clipboard = b ? [takeClip(b, 0, voiceTrack())] : withLips(S.tl.selection()).map(c => ({ ...c }));
  },
  cut: () => { tools.copy(); tools.del(); },
  paste: () => {
    if (!clipboard.length) return;
    const { tl } = S;
    tl.commit();
    const added = tl.paste(clipboard.filter(c => tl.track(c.track)), tl.playhead);
    tl.setPlayhead(Math.max(...added.map(endOf)), { follow: true });
    tl.changed();
    tl.setSelection(added.filter(c => !c.ref).map(c => c.id));
  },
  dup: () => {
    const cs = withLips(S.tl.selection());
    if (!cs.length) return;
    const { tl } = S;
    tl.commit();
    const added = tl.paste(cs.map(c => ({ ...c })), Math.max(...cs.filter(c => !c.ref).map(endOf)));
    tl.changed();
    tl.setSelection(added.filter(c => !c.ref).map(c => c.id));
  },
  del: (ripple = false) => {
    const ids = selIds();
    if (!ids.length) return;
    S.tl.commit();
    if (ripple) S.tl.rippleRemove(ids); else S.tl.remove(ids);
    S.tl.setSelection([]);
    S.tl.changed();
  },
  xfade: () => {
    const { tl } = S;
    if (!tl.sel.size) return;
    tl.commit();
    if (!toggleCrossfades(tl.clips, tl.sel, tl.tracks)) { tl.history.pop(); return; }
    tl.changed();
  },
  reverse: () => { const cs = S.tl.selection(); if (!cs.length) return; S.tl.commit(); for (const c of cs) { c.reverse = !c.reverse; for (const l of S.tl.clips.filter(z => z.ref === c.id)) l.reverse = c.reverse; } S.tl.history.pop(); lips(cs.filter(hasLips), true); },
  selectAll: () => S.tl.setSelection(S.tl.clips.filter(c => !c.ref).map(c => c.id)),
  nudge: d => {
    const cs = withLips(S.tl.selection());
    if (!cs.length) return;
    S.tl.commit();
    const shift = Math.max(d, -Math.min(...cs.map(c => c.at)));
    for (const c of cs) c.at += shift;
    const ids = new Set(cs.map(c => c.id));
    for (const c of cs) S.tl.clear(c.track, c.at, c.len, ids);
    S.tl.changed();
  },
  lips: () => { const v = S.tl.selection().filter(isVoiced); if (v.length) lips(v, !v.every(hasLips)); },
  markIn: () => S.tl.setMark('a', S.tl.playhead),
  markOut: () => S.tl.setMark('b', S.tl.playhead),
  clearRange: () => S.tl.setRange(null, null),
  rangeFromSelection: () => {
    const cs = S.tl.selection();
    if (cs.length) S.tl.setRange(Math.min(...cs.map(c => c.at)), Math.max(...cs.map(endOf)));
  },
  undo: () => S.tl.undo(),
  redo: () => S.tl.redo(),
  fit: () => { S.tl.fit(); syncZoomSlider(); },
};
for (const [id, fn] of [['t-play', 'play'], ['t-split', 'split'], ['t-mute', 'mute'], ['t-dup', 'dup'], ['t-del', 'del'], ['t-undo', 'undo'], ['t-redo', 'redo'], ['t-xfade', 'xfade'], ['t-rev', 'reverse']])
  $(id)?.addEventListener('click', () => S && tools[fn]());

// Klinge: B gedrückt halten und auf einen Clip klicken – dort wird geteilt
document.addEventListener('keyup', e => { if (e.key.toLowerCase() === 'b') S?.tl.setBlade(false); });
addEventListener('blur', () => S?.tl.setBlade(false));
document.addEventListener('keydown', e => {
  if (!S || els.studio.hidden) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); S.tl.setBlade(true); return; }
  const mod = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const map = mod ? { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'dup', c: 'copy', x: 'cut', v: 'paste', a: 'selectAll' }
    : { ' ': 'play', s: 'split', m: 'mute', x: 'xfade', r: 'reverse', l: 'lips', i: 'markIn', o: 'markOut', Delete: 'del', Backspace: 'del' };
  if (k === 'x' && e.altKey && !mod) { e.preventDefault(); tools.clearRange(); return; }   // wie in Resolve
  const act = map[k];
  if (act && !(e.altKey && !mod)) {
    e.preventDefault();
    if (act === 'del') tools.del(e.shiftKey); else tools[act]();
    closePop();
    return;
  }
  if (k === 'z' && e.shiftKey && !mod) { e.preventDefault(); tools.fit(); return; }
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.altKey) {
    // Alt+Pfeil: Auswahl um 10 ms (mit Umschalt 100 ms) schieben – zum Feinjustieren
    e.preventDefault();
    tools.nudge((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01));
    return;
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
    e.preventDefault();
    const step = e.shiftKey ? 1 : 1 / 30;
    const t = k === 'Home' ? 0 : k === 'End' ? S.tl.end() : S.tl.playhead + (k === 'ArrowLeft' ? -step : step);
    S.player.stop();
    S.tl.setPlayhead(t, { follow: true });
    S.player.sync(S.tl.playhead);
    showTime(S.tl.playhead);
  } else if (k === '+' || k === '=' || k === '-') { e.preventDefault(); S.tl.zoom(S.tl.pps * (k === '-' ? 1 / 1.4 : 1.4)); }
  else if (k === 'Escape') { closePop(); closeMenu(); S.tl.setSelection([]); }
});

// ---------------------------------------------------------------- Kontextmenü
const menu = $('ctx');
function closeMenu() { menu.hidden = true; }
document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('#ctx')) closeMenu(); });
function contextMenu({ x, y, t, onClip, onRuler }) {
  closePop();
  const n = S.tl.sel.size, items = [], r = S.tl.range;
  if (onRuler) {
    items.push(['Range starts here', 'I at playhead', () => S.tl.setMark('a', t)], ['Range ends here', 'O at playhead', () => S.tl.setMark('b', t)]);
    if (n) items.push(['Range around selection', '', 'rangeFromSelection']);
    if (r) items.push(null, ['Clear range', 'Alt+X', 'clearRange']);
  } else if (onClip && n) {
    items.push(['Cut', 'Ctrl+X', 'cut'], ['Copy', 'Ctrl+C', 'copy'], ['Duplicate', 'Ctrl+D', 'dup'], null,
      ['Split at playhead', 'S', 'split'], ['Crossfade with neighbours', 'X', 'xfade'], ['Backwards', 'R', 'reverse'],
      [S.tl.selection().every(x => S.tl.kindOf(x) === 'video') ? (S.tl.selection().every(x => x.muted) ? 'Show' : 'Hide') : (S.tl.selection().every(x => x.muted) ? 'Unmute' : 'Mute'), 'M', 'mute'], null);
    const voiced = S.tl.selection().filter(isVoiced);
    if (voiced.length) items.push([voiced.every(hasLips) ? 'Hide lips' : 'Show lips', 'L', 'lips'], ...(voiced.some(clipText) ? [['Save in Gold', '', () => clipsToList(voiced)], ['AI rewrite…', '', () => aiRewrite(voiced)]] : []), null);
    items.push(['Range around selection', '', 'rangeFromSelection'], null);
    items.push(['Delete', 'Del', 'del'], ['Delete and close gap', 'Shift+Del', () => tools.del(true)]);
  } else {
    items.push(['Paste here', 'Ctrl+V', () => { S.tl.setPlayhead(t); tools.paste(); }], ['Play from here', 'double-click', () => S.player.play(t)], null,
      ['Select all', 'Ctrl+A', 'selectAll'], ['Zoom to fit', 'Shift+Z', 'fit']);
  }
  showMenu(items, x, y);
}

/** Kontextmenü mit Einträgen [Text, Taste, Aktion] (null = Trennlinie; Aktion null = nur Hinweis). */
function showMenu(items, x, y) {
  menu.replaceChildren(...items.map(it => {
    if (!it) { const hr = document.createElement('hr'); return hr; }
    const [label, key, act] = it;
    if (act === null) { const p = document.createElement('p'); p.className = 'sc-ctx-note'; p.textContent = label; return p; }
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>${label}</span><kbd>${key}</kbd>`;
    if (act === 'paste' || (label.startsWith('Paste') && !clipboard.length)) b.disabled = !clipboard.length;
    b.addEventListener('click', () => { closeMenu(); typeof act === 'function' ? act() : tools[act](); });
    return b;
  }));
  menu.hidden = false;
  place(menu, x + 20, y - 12);
}

// ---------------------------------------------------------------- Spuren wiederherstellen
/** „+ Video“ / „+ Audio“: leere Spur oder das Original (aus der gespeicherten Analyse) neu anlegen. */
function addTrackMenu({ kind, x, y }) {
  const voiceLen = Math.min(S.duration, S.voice.length / SR);
  const items = [['Empty track', '', () => newTrack(kind)]];
  if (kind === 'video') items.push(['Original video', '', () => newTrack('video', [{ type: 'video', at: 0, len: S.duration, src: 0, label: file.name }])]);
  else {
    items.push(['Original voice, sentence by sentence', '', () => newTrack('audio', phraseClips(S, voiceLen, ''))],
      [`Original ${S.hasMusic ? 'voice' : 'sound'} in one piece`, '', () => newTrack('audio', [{ type: 'orig', at: 0, len: voiceLen, src: 0, label: S.hasMusic ? 'Original voice' : 'Original sound' }])]);
    if (S.music) items.push(['Music', '', () => newTrack('audio', [{ type: 'music', at: 0, len: Math.min(S.duration, S.music.length / SR), src: 0, label: 'Music' }])]);
  }
  for (const src of S.sources.slice(1)) {
    const dur = Math.min(src.duration, S.voice.length / SR - src.offset);
    if (kind === 'video') items.push([`Video of “${src.name}”`, '', () => newTrack('video', [{ type: 'video', at: 0, len: src.duration, src: src.offset, label: src.name }])]);
    else items.push([`Voice of “${src.name}”, sentence by sentence`, '', () => newTrack('audio', phraseClips(S, dur, '', src.offset))]);
  }
  items.push(null, ['Analyse the video again…', '', () => askReanalyse(x, y)]);
  showMenu(items, x - 20, y + 12);
}
function newTrack(kind, clips = []) {
  const { tl } = S;
  tl.commit();
  // Ist die übliche Spur dafür leer (Clips gelöscht), kommt es dorthin, sonst auf eine neue
  const home = { video: 'v1', orig: 'a1', music: 'a2' }[clips[0]?.type];
  let t = home && tl.track(home) && !tl.clips.some(c => c.track === home) ? tl.track(home) : null;
  if (!t) { t = tl.addTrack(kind); if (clips[0]?.type === 'music') t.name = 'Music'; }
  for (const c of clips) tl.add({ ...c, track: t.id }, { overwrite: false });
  tl.build(true);
  tl.changed();
}
/** Alles neu berechnen (Trennung, Transkript, Laute). Das Projekt bleibt, wie es ist. */
function askReanalyse(x, y) {
  const min = Math.round(((els.video.duration || 0) / 60) * (els.separate.checked ? 4.1 : 2.6) + 1);
  showMenu([[`Runs the whole analysis again: separation, transcript, sounds (about ${min} min). Your clips and sentences stay. Only useful after an update or if something sounds wrong.`, '', null],
    ['Analyse again', '', reanalyse], ['Cancel', 'Esc', () => {}]], x - 20, y + 12);
}
async function reanalyse() {
  clearTimeout(saveTimer);
  await cache.put(`project|${key}`, projectState()).catch(() => {});
  await cache.remove(key).catch(() => {});
  const lg = key.split('|')[3];
  load(file);
  const r = document.querySelector(`input[name="lang"][value="${lg}"]`);
  if (r) r.checked = true;
  els.analyze.click();
}

// ---------------------------------------------------------------- Ausgeben
els.exportBtn.addEventListener('click', () => {
  if (exporting) { exporting.abort(); return; }
  const open = els.exportMenu.hidden;
  if (open) syncExportScope();
  els.exportMenu.hidden = !open;
  els.exportBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', e => { if (!e.target.closest('.sc-export')) { els.exportMenu.hidden = true; els.exportBtn.setAttribute('aria-expanded', 'false'); } });
let exporting = null;
// Was ausgegeben wird: alles oder nur der markierte Bereich (Marken im Lineal)
let exportScope = 'all';
function syncExportScope() {
  const r = S?.tl.range, btn = $('export-range');
  if (!r) exportScope = 'all';
  btn.disabled = !r;
  btn.innerHTML = r ? `Range <small>${clock(r.a)}–${clock(r.b)}</small>` : 'Range';
  $('export-range-hint').hidden = !!r;
  for (const b of els.exportMenu.querySelectorAll('[data-scope]')) b.setAttribute('aria-checked', String(b.dataset.scope === exportScope));
}
els.exportMenu.addEventListener('click', async e => {
  if (e.target.closest('.sc-wmark')) { e.stopPropagation(); return; }
  const scope = e.target.closest('[data-scope]')?.dataset.scope;
  if (scope) { e.stopPropagation(); exportScope = scope; syncExportScope(); return; }
  const kind = e.target.closest('[data-export]')?.dataset.export;
  if (!kind || !S) return;
  els.exportMenu.hidden = true;
  const r = exportScope === 'range' && S.tl.range;
  const span = r ? { t0: r.a, t1: r.b } : { t0: 0, t1: S.tl.end() };
  const name = file.name.replace(/\.[^.]+$/, '') + '-slinky' + (r ? `-${clock(r.a).replace(/[:.]/g, '')}-${clock(r.b).replace(/[:.]/g, '')}` : '');
  if (kind === 'wav') { download(new Blob([encodeWav(S.player.mix(span.t0, span.t1))], { type: 'audio/wav' }), `${name}.wav`); return; }
  const btn = els.exportBtn, label = btn.innerHTML;
  exporting = new AbortController();
  btn.title = 'Click to cancel';
  try {
    const { blob, ext } = await S.player.render(f => { btn.textContent = `Exporting ${Math.round(f * 100)} % · cancel`; }, exporting.signal,
      { ...span, watermark: $('export-mark').checked });
    download(blob, `${name}.${ext}`);
    exportDone(blob, `${name}.${ext}`);
  } catch (err) { if (err.name !== 'AbortError') fail(err.message); } finally {
    exporting = null; btn.innerHTML = label; btn.title = ''; S.player.mark = null; S.player.sync(S.tl.playhead);
  }
});

/**
 * Nach dem Ausgeben: Hinweis, wo die Datei ist, und Wege zum Veröffentlichen – „Teilen…“
 * (wo das System Dateien teilen kann, z. B. an die YouTube-App) und YouTubes Upload-Seite.
 */
function exportDone(blob, name) {
  const box = $('export-done');
  const f = new File([blob], name, { type: blob.type });
  box.innerHTML = `<span><b>${esc(name)}</b> is in your downloads.</span>`;
  const act = (label, ic, fn, title = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sc-act'; b.title = title; b.append(icon(ic, { size: '14px' }), ' ', label); b.addEventListener('click', fn); box.append(b); return b; };
  if (navigator.canShare?.({ files: [f] })) act('Share…', 'upload', () => navigator.share({ files: [f], title: name }).catch(() => {}), 'Send it to another app, e.g. YouTube');
  const yt = document.createElement('a');
  yt.className = 'sc-act'; yt.href = 'https://www.youtube.com/upload'; yt.target = '_blank'; yt.rel = 'noopener';
  yt.title = 'Opens YouTube’s upload page in a new tab – drop the file there';
  yt.append(icon('external-link', { size: '14px' }), ' Upload to YouTube');
  box.append(yt);
  act('', 'x', () => { box.hidden = true; }, 'Close').setAttribute('aria-label', 'Close');
  box.hidden = false;
}

// ---------------------------------------------------------------- Sammeln
// Gute Stellen des Originals in die Liste legen (aus dem Transkript oder von der Spur):
// dort sind sie wie geschnittene Sätze – anhören, Wörter tauschen, auf eine Spur ziehen.
let tAnchor = null;
function selectTranscript(a, b = a) {
  const bar = $('tsel');
  for (const x of els.transcript.querySelectorAll('.sc-word.on')) x.classList.remove('on');
  if (a == null) { bar.hidden = true; return; }
  const [i0, i1] = a < b ? [a, b] : [b, a];
  const idx = [];
  const btns = els.transcript.children;
  for (let i = i0; i <= i1; i++) { btns[i]?.classList.add('on'); if (S.words[i].e > S.words[i].s) idx.push(i); }
  if (!idx.length) { bar.hidden = true; return; }
  const text = idx.map(i => S.words[i].w).join(' ');
  bar.hidden = false;
  bar.innerHTML = `<span class="sc-tsel-text">“${esc(text.length > 120 ? text.slice(0, 117) + '…' : text)}”</span>`;
  const mk = (label, ic, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'sc-act'; x.append(icon(ic, { size: '14px' }), ' ', label); x.addEventListener('click', fn); bar.append(x); };
  const w0 = S.words[idx[0]], w1 = S.words[idx.at(-1)];
  mk('Listen', 'play', () => S.player.listen(S.voice, w0.s - 0.03, w1.e + 0.05));
  mk('Save in Gold', 'star', () => { showBinTab('gold'); addPassage(idx, { gold: true }).then(() => { selectTranscript(null); pulseGold(); }).catch(err => fail(err.message)); });
  mk('Place at playhead', 'plus', () => insertSnip({ label: text.length > 40 ? text.slice(0, 38) + '…' : text, s: w0.s - 0.03, e: w1.e + 0.05 }));
}

/** Eine Stelle des Originals (Wortindizes) als Satz in die Liste – klingt genau wie im Video. */
async function addPassage(idx, extra = {}, at = 0) {
  const spk = S.speakers.length > 1 ? S.words[idx[0]].spk : null;
  const r = await request({ type: 'phrase', si: idx, speaker: spk });
  const b = { id: newId(), text: r.text, audio: r.audio, words: r.words,
    pieces: r.pieces, speaker: r.speaker, force: r.force, rev: 0, orig: true, ...extra };
  S.bin.splice(Math.min(at, S.bin.length), 0, b);
  renderBin(); save();
  return b;
}

/** Gewählte Ton-Clips in die Liste: Sätze als Kopie, Originalstimme als Stelle. */
async function clipsToList(cs) {
  showBinTab('gold');
  for (const c of [...cs].sort((a, b) => b.at - a.at)) {
    if (c.type === 'take') {
      const t = c.take;
      S.bin.unshift({ id: newId(), text: t.text, audio: t.audio, words: t.words, pieces: t.pieces, speaker: t.speaker, force: t.force, rev: 0, gold: true });
    } else {
      const idx = clipWords(c);
      if (idx.length) await addPassage(idx, { gold: true });
    }
  }
  renderBin(); save();
}

// ---------------------------------------------------------------- Fundstücke
const findsGo = $('finds-go');
findsGo.addEventListener('click', () => S && findGoldUI(ideas.topic.value.trim()).catch(err => { ideas.status.textContent = err.message; idleFinds(); }));
const idleFinds = () => { findsGo.disabled = false; ideas.go.disabled = false; findsGo.classList.remove('busy'); ideas.status.classList.remove('sc-busy-text'); };
/** Das Sprachmodell sucht Stellen, die so oder mit kleinem Eingriff lustig sind; sie kommen in die Liste. */
async function findGoldUI(topic = '') {
  const key = ideas.key.value.trim(), model = ideas.model.value.trim() || DEFAULT_MODEL;
  if (!key) { ideas.status.textContent = 'Please enter your OpenRouter key.'; $('ideas-keys').open = true; ideas.key.focus(); return; }
  store.set('slinky-openrouter-key', key); store.set('slinky-openrouter-model', model);
  findsGo.disabled = true; ideas.go.disabled = true; findsGo.classList.add('busy'); ideas.status.classList.add('sc-busy-text');
  const spk = speaker();
  const pos = S.words.map((w, i) => i).filter(i => spk == null || S.words[i].spk === spk);
  showBinTab('gold');
  let at = 0, n = 0;
  const pick = streamPick(8, ({ f, idx, r }) => {
    const note = `${f.why ? f.why + ' · ' : ''}Original: “${f.quote}”`;
    if (r) { S.bin.splice(at++, 0, { id: newId(), text: f.edit, audio: r.audio, words: r.words, pieces: r.pieces, speaker: spk, force: r.force, rev: 0, ai: true, gold: true, note }); renderBin(); save(); }
    else addPassage(idx, { note: f.why ? `${f.why} · as they say it` : '', gold: true }, at++);
  });
  const st = modelStatus(t => { ideas.status.textContent = t; }), q = queue();
  try {
    await findGold({ key, model, words: pos.map(i => S.words[i]), lang: S.lang, topic, onPhase: st.phase,
      onFind: f => q.add(async () => {
        n++;
        const idx = f.idx.map(k => pos[k]);
        if (!f.edit) { pick.offer({ f, idx, cost: 0 }); return; }
        const r = await request({ type: 'mix', text: f.edit, speaker: spk, force: editForce(idx, f.edit) });
        pick.offer({ f, idx, r, cost: buildCost(r.words) });
        ideas.status.textContent = `${pick.count} finds in Gold so far – cutting more…`;
      }) });
    st.phase('writing');
    await q.done();
  } finally { st.stop(); }
  const got = pick.finish();
  if (!n) throw new Error('The model found nothing usable. Try again.');
  ideas.status.textContent = `Added ${got} finds to Gold – originals are marked “Orig”, small edits “AI”. Hover one to see why.`;
  idleFinds();
}

/** Bearbeitung einer Stelle: Was aus dem Zitat bleibt, bleibt genau dieses Vorkommen (mit seinen Pausen). */
function editForce(idx, edit) {
  const kept = keptWords(idx.map(i => S.words[i].w), edit.split(/\s+/).filter(Boolean));
  const words = {}, pauses = {};
  for (const [j, k] of kept) {
    words[j] = idx[k];
    const nk = kept.get(j + 1);
    if (nk === k + 1) { const a = S.words[idx[k]], b = S.words[idx[k + 1]]; if (b.s - a.e > 0.08) pauses[j] = Math.min(1.5, b.s - a.e); }
  }
  return { words, pins: {}, avoid: {}, pauses };
}

// ---------------------------------------------------------------- Geschichte (Drehbuch)
// Ideen → Szenen → Rohschnitt. Jede Szene ist ein eigener Eintrag der Liste (story: true);
// S.story = { pitches, pitch, length, scenes: [{id, kind, beat, quote, text, idx, goldId, pic, cost}] }.
// Fast alles ist Originalton oder ein kleiner Eingriff darin – dann passen Bild und Lippen.
const storyGo = $('story-go');
const KIND = { orig: ['Orig', 'As they say it in the video'], edit: ['Edit', 'A small edit of an original passage'], gold: ['Gold', 'From your Gold list'], new: ['New', 'A new line – the picture comes from the passage that fits'] };
const LENGTHS = { short: 'short (~30 s)', medium: 'medium (~1 min)', long: 'long (~2 min)' };
let storyBusy = false;
storyGo.addEventListener('click', () => S && storyIdeasUI().catch(storyFail));
function storyFail(err) { ideas.status.textContent = err.message; busyStory(false); }

/** Schlüssel und Modell aus dem Ideen-Feld (fehlt der Schlüssel: Hinweis). */
function aiKey() {
  const key = ideas.key.value.trim(), model = ideas.model.value.trim() || DEFAULT_MODEL;
  if (!key) { ideas.status.textContent = 'Please enter your OpenRouter key.'; $('ideas-keys').open = true; ideas.key.focus(); return null; }
  store.set('slinky-openrouter-key', key); store.set('slinky-openrouter-model', model);
  return { key, model };
}
/** Wörter des gewählten Sprechers (und ihre Stellen im ganzen Transkript). */
function storyWords() {
  const spk = speaker();
  const pos = S.words.map((w, i) => i).filter(i => spk == null || S.words[i].spk === spk);
  return { spk, pos, words: pos.map(i => S.words[i]) };
}
const storyGold = () => S.bin.filter(b => b.gold && !b.story).slice(0, 30);
function busyStory(on) {
  storyBusy = on;
  storyGo.disabled = on; findsGo.disabled = on;
  storyGo.classList.toggle('busy', on); ideas.status.classList.toggle('sc-busy-text', on);
  renderBin();
}

async function storyIdeasUI() {
  const ai = aiKey();
  if (!ai) return;
  const { words } = storyWords();
  S.story = { length: 'medium', scenes: [], ...(S.story ?? {}), pitches: [], showIdeas: true };
  S.binTab = 'story';
  busyStory(true);
  $('bintabs').scrollIntoView({ block: 'start', behavior: 'smooth' });
  const st = modelStatus(t => { ideas.status.textContent = t; });
  try {
    await storyPitches({ ...ai, words, lang: S.lang, topic: ideas.topic.value.trim(), gold: storyGold(), onPhase: st.phase,
      onPitch: p => { S.story.pitches.push(p); renderBin(); } });
  } finally { st.stop(); }
  if (!S.story.pitches.length) throw new Error('The model sent no ideas. Try again.');
  ideas.status.textContent = 'Pick an idea in the Story tab.';
  busyStory(false); save();
}

/** Szene vom Modell → Stellen im ganzen Transkript, Gold-Eintrag, Bild für neue Sätze. */
function sceneFrom(s, pos, gold) {
  const sc = { ...s };
  if (sc.idx) sc.idx = sc.idx.map(k => pos[k]);
  if (sc.kind === 'gold') { sc.goldId = gold[sc.gold]?.id; delete sc.gold; }
  if (sc.kind === 'new' && sc.idx) sc.pic = { s: Math.max(0, S.words[sc.idx[0]].s - 0.1), e: S.words[sc.idx.at(-1)].e + 0.1 };
  return sc;
}
/** Szene schneiden → eigener Eintrag (story: true); setzt sc.id und sc.cost. */
async function cutScene(sc) {
  const spk = speaker();
  let b;
  if (sc.kind === 'gold') {
    const g = S.bin.find(x => x.id === sc.goldId);
    if (!g) return null;
    b = { ...g, id: newId(), gold: false, story: true };
  } else if (sc.kind === 'orig') {
    const r = await request({ type: 'phrase', si: sc.idx, speaker: spk });
    b = { id: newId(), text: r.text, audio: r.audio, words: r.words, pieces: r.pieces, speaker: r.speaker, force: r.force, rev: 0, orig: true, story: true };
  } else {
    const r = await request({ type: 'mix', text: sc.text, speaker: spk, force: sc.kind === 'edit' && sc.idx ? editForce(sc.idx, sc.text) : {} });
    b = { id: newId(), text: sc.text, audio: r.audio, words: r.words, pieces: r.pieces, speaker: spk, force: r.force, rev: 0, ai: true, story: true,
      note: sc.quote ? (sc.kind === 'edit' ? `Original: “${sc.quote}”` : `Picture: “${sc.quote}”`) : '' };
  }
  b.note = [sc.beat, b.note].filter(Boolean).join(' · ');
  S.bin.push(b);
  sc.id = b.id;
  sc.cost = sc.kind === 'edit' || sc.kind === 'new' ? buildCost(b.words) : 0;
  return b;
}
const dropItems = ids => { const x = new Set(ids); S.bin = S.bin.filter(b => !x.has(b.id)); };
/** Eintrag löschen (auch als Szene). */
function removeItem(id) {
  dropItems([id]);
  if (S.story?.scenes) S.story.scenes = S.story.scenes.filter(sc => sc.id !== id);
  renderBin(); save();
}

async function writeStoryUI(pitch) {
  const ai = aiKey();
  if (!ai) return;
  const { pos, words } = storyWords(), gold = storyGold();
  dropItems((S.story?.scenes ?? []).map(sc => sc.id));
  S.story = { ...S.story, pitch, scenes: [], showIdeas: false };
  busyStory(true);
  const st = modelStatus(t => { ideas.status.textContent = t; }), q = queue();
  try {
    await writeStory({ ...ai, words, lang: S.lang, pitch, gold, length: S.story.length, onPhase: st.phase,
      onScene: s => {
        const sc = sceneFrom(s, pos, gold);
        sc.pending = true;
        S.story.scenes.push(sc); renderBin();
        q.add(async () => {
          try { await cutScene(sc); } catch { /* fällt unten weg */ }
          sc.pending = false; renderBin();
          ideas.status.textContent = `${S.story.scenes.filter(x => x.id).length} scenes cut so far…`;
        });
      } });
    st.phase('writing');
    await q.done();
  } finally { st.stop(); }
  S.story.scenes = S.story.scenes.filter(sc => sc.id);
  if (!S.story.scenes.length) throw new Error('The model sent no usable scenes. Try again.');
  // Was sich nicht sauber schneiden lässt: einmal leichtere Fassungen holen
  const weak = S.story.scenes.map((sc, i) => (sc.cost > MAX_BUILD_COST ? i : -1)).filter(i => i >= 0);
  if (weak.length) {
    ideas.status.textContent = `Asking for easier versions of ${weak.length} scene${weak.length > 1 ? 's' : ''}…`;
    await replaceScenes(weak, ai, { onlyIfBetter: true, why: sc => {
      const b = S.bin.find(x => x.id === sc.id);
      return `does not cut cleanly: ${(b?.words ?? []).filter(w => w.quality === 'sounds').map(w => w.w).join(', ') || 'words'} would be stitched from single sounds`;
    } }).catch(() => {});
  }
  ideas.status.textContent = `${S.story.scenes.length} scenes in the Story tab. Listen, swap or remove scenes, then place them on the timeline.`;
  busyStory(false); save();
}

/** Szenen (Indizes) vom Modell ersetzen lassen; onlyIfBetter: nur, wenn sich der Ersatz sauberer schneiden lässt. */
async function replaceScenes(list, ai, { why, onlyIfBetter = false }) {
  const { pos, words } = storyWords(), gold = storyGold();
  const messages = storyMessages({ words, lang: S.lang, pitch: S.story.pitch, gold, length: S.story.length });
  const content = JSON.stringify({ scenes: S.story.scenes.map(sc => rawScene({ ...sc, gold: sc.kind === 'gold' ? Math.max(0, gold.findIndex(g => g.id === sc.goldId)) : 0 })) });
  const weak = list.map(i => ({ n: i + 1, text: S.story.scenes[i].text || S.story.scenes[i].quote, why: why(S.story.scenes[i]) }));
  const st = modelStatus(t => { ideas.status.textContent = t; });
  let r;
  try { r = await fixScenes({ ...ai, words, gold, messages, content, weak, onPhase: st.phase }); } finally { st.stop(); }
  const old = [...S.story.scenes];
  for (const { n, scene } of r.scenes) {
    const i = n - 1, prev = old[i];
    if (!prev || !list.includes(i)) continue;
    const sc = sceneFrom(scene, pos, gold);
    try { await cutScene(sc); } catch { continue; }
    if (!sc.id) continue;
    if (onlyIfBetter && sc.cost >= prev.cost) { dropItems([sc.id]); continue; }
    dropItems([prev.id]);
    const k = S.story.scenes.indexOf(prev);
    if (k >= 0) S.story.scenes[k] = sc;
  }
  renderBin(); save();
  return r.scenes.length;
}

function moveScene(i, d) {
  const sc = S.story.scenes, j = i + d;
  if (j < 0 || j >= sc.length) return;
  [sc[i], sc[j]] = [sc[j], sc[i]];
  renderBin(); save();
}

/** Drehbuch-Ansicht im Reiter „Story“. */
function renderStory() {
  const st = S.story;
  const li = (cls, html = '') => { const x = document.createElement('li'); x.className = cls; x.innerHTML = html; return x; };
  const btn = (label, ic, fn, cls = 'sc-act') => { const x = document.createElement('button'); x.type = 'button'; x.className = cls; if (ic) x.append(icon(ic, { size: '14px' }), ' '); x.append(label); x.addEventListener('click', ev => { ev.stopPropagation(); fn(); }); return x; };
  const out = [];
  if (!st || (!st.pitches?.length && !st.scenes?.length)) {
    els.bin.replaceChildren(li('sc-hint', storyBusy ? 'Waiting for ideas…' : 'No story yet. Open <b>Find gold</b> and click <b>Write a story</b>: the model suggests a few ideas built from this video, you pick one, and it writes the scenes – mostly original passages and small edits, so picture and voice fit. Your Gold list is used where it fits.'));
    return;
  }
  if (st.scenes?.length) {
    const head = li('sc-story-head', `<p><b>${esc(st.pitch?.title || 'Your story')}</b> ${esc(st.pitch?.premise ?? '')}</p>`);
    const row = document.createElement('div');
    row.className = 'sc-row';
    const place = btn('Place on the timeline', 'plus', placeStory, 'pill-button sc-pill');
    place.disabled = storyBusy || st.scenes.some(sc => sc.pending);
    place.title = 'All scenes in order behind the end of the timeline, with their picture; the export range is set to them';
    const other = btn(st.showIdeas ? 'Hide ideas' : 'Other ideas', 'sparkles', () => { st.showIdeas = !st.showIdeas; renderBin(); });
    other.disabled = storyBusy;
    row.append(place, other);
    head.append(row);
    out.push(head);
  }
  if (!st.scenes?.length || st.showIdeas) {
    const opts = li('sc-story-opts');
    const lab = document.createElement('label');
    lab.textContent = 'Length ';
    const sel = document.createElement('select');
    sel.id = 'story-length';
    sel.append(...Object.entries(LENGTHS).map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
    sel.value = st.length ?? 'medium';
    sel.addEventListener('change', () => { st.length = sel.value; save(); });
    lab.append(sel);
    opts.append(lab, btn('New ideas', 'sparkles', () => storyIdeasUI().catch(storyFail)));
    opts.querySelectorAll('button').forEach(x => { x.disabled = storyBusy; });
    out.push(opts);
    const own = ideas.topic.value.trim();
    const pitches = [...(st.pitches ?? []), ...(own ? [{ title: 'Your idea', premise: own, why: 'from the “What about?” field', own: true }] : [])];
    for (const p of pitches) {
      const card = li('sc-story-pitch', `<p><b>${esc(p.title)}</b> ${esc(p.premise)}</p>${p.why ? `<p class="sc-note">${esc(p.why)}</p>` : ''}`);
      const w = btn('Write this story', 'file-text', () => writeStoryUI(p).catch(storyFail), 'sc-act');
      w.disabled = storyBusy;
      card.append(w);
      out.push(card);
    }
  }
  (st.scenes ?? []).forEach((sc, i) => {
    const b = sc.id && S.bin.find(x => x.id === sc.id);
    const [tag, tip] = KIND[sc.kind] ?? ['', ''];
    const top = `<span class="sc-story-n">${i + 1}</span> <span class="sc-tag sc-kind-${sc.kind}" title="${esc(tip)}">${tag}</span> <span class="sc-story-beat">${esc(sc.beat ?? '')}</span>${sc.cost > MAX_BUILD_COST ? ' <span class="sc-story-warn" title="Some words are stitched from single sounds – try another version">hard to cut</span>' : ''}`;
    if (!b) { out.push(li('sc-story-scene pending', `<div class="sc-story-top">${top}</div><p class="sc-note">Cutting “${esc(sc.text || sc.quote || '…')}”…</p>`)); return; }
    const item = binLi(b);
    item.classList.add('sc-story-scene');
    const bar = document.createElement('div');
    bar.className = 'sc-story-top';
    bar.innerHTML = top;
    const acts = document.createElement('span');
    acts.className = 'sc-story-acts';
    const mini = (ic, title, fn, cls = '') => { const x = document.createElement('button'); x.type = 'button'; x.className = `sc-mini ${cls}`; x.title = title; x.setAttribute('aria-label', title); x.append(icon(ic, { size: '13px' })); x.disabled = storyBusy; x.addEventListener('click', ev => { ev.stopPropagation(); fn(); }); acts.append(x); };
    mini('arrow-up', 'Move up', () => moveScene(i, -1));
    mini('arrow-up', 'Move down', () => moveScene(i, 1), 'sc-flip');
    mini('sparkles', 'Another version of this scene', () => {
      const ai = aiKey();
      if (!ai) return;
      busyStory(true);
      replaceScenes([i], ai, { why: () => 'the editor wants another version here' })
        .then(n => { ideas.status.textContent = n ? 'Scene replaced.' : 'No other version came back. Try again.'; busyStory(false); }).catch(storyFail);
    });
    bar.append(acts);
    item.prepend(bar);
    out.push(item);
  });
  els.bin.replaceChildren(...out);
}

/** Alle Szenen der Reihe nach hinter das Ende der Zeitleiste, mit Bild; Ausgabebereich darauf. */
function placeStory() {
  const { tl } = S, st = S.story;
  const scenes = st.scenes.map(sc => [sc, S.bin.find(b => b.id === sc.id)]).filter(([, b]) => b);
  if (!scenes.length) return;
  tl.commit();
  const at0 = Math.ceil(Math.max(tl.end(), S.duration) + 1);
  let at = at0;
  const placed = [];
  for (const [sc, b] of scenes) {
    const c = tl.add(takeClip(b, at, 'a1'), { overwrite: false });
    placed.push([sc, c]);
    at = endOf(c) + (sc.kind === 'orig' ? 0.3 : 0.2);
  }
  for (const [sc, c] of placed) {
    // Neue Sätze zeigen das Bild der passenden Stelle (statt springender Lippen-Schnipsel)
    if (sc.kind === 'new' && sc.pic) tl.add({ track: lipsTrack(), type: 'lips', at: c.at, len: c.len, src: sc.pic.s, speed: 1, reverse: false, label: '', ref: c.id });
    else for (const x of lipsFor(c)) tl.add(x);
  }
  tl.setRange(at0, at);
  tl.setPlayhead(at0, { follow: true });
  showTime(at0);
  tl.changed();
  tl.setSelection(placed.map(([, c]) => c.id));
  reveal(placed[0][1]);
  S.player.sync(tl.playhead);
  ideas.status.textContent = `Placed ${placed.length} scenes at ${clock(at0)}, with their picture. The export range covers them.`;
}

// ---------------------------------------------------------------- Weitere Quellen
// Andere Aufnahmen desselben Sprechers (z. B. weitere Folgen einer Reihe): Sie werden genauso
// analysiert und hinter das Video gehängt; der Schnitt schöpft dann aus allem.
const mediaFiles = new Map();          // „Name|Größe“ → Objekt-URL (nur in dieser Sitzung)
const MAX_TOTAL_MIN = 45;
/** Bildquellen an den Player geben; fehlende Dateien (nach dem Neuladen) zum Nachladen anbieten. */
function syncMedia() {
  const list = S.sources.map((x, i) => ({ url: i === 0 ? els.video.src : mediaFiles.get(`${x.name}|${x.size}`) ?? null, offset: x.offset }));
  S.player.setMedia(list);
  const missing = S.sources.filter((x, i) => i > 0 && !list[i].url);
  const box = $('src-box');
  if (!missing.length) { if (box.dataset.kind === 'missing') box.hidden = true; return; }
  box.dataset.kind = 'missing';
  box.hidden = false;
  box.innerHTML = `<p>This project also uses ${missing.map(x => `“${esc(x.name)}”`).join(', ')}. Its sound is here; load the file to see its picture too.</p>`;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'sc-act'; b.textContent = missing.length > 1 ? 'Load the files' : 'Load the file';
  b.addEventListener('click', () => $('src-media').click());
  box.append(b);
}
$('src-media').addEventListener('change', e => {
  for (const f of e.target.files) {
    const hit = S?.sources.find(x => x.name === f.name && x.size === f.size) ?? S?.sources.find(x => x.name === f.name);
    if (hit) mediaFiles.set(`${hit.name}|${hit.size}`, URL.createObjectURL(f));
  }
  e.target.value = '';
  if (S) syncMedia();
});

$('src-add').addEventListener('click', () => $('src-file').click());
$('src-file').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f && S) addSourceFile(f).catch(err => { srcBox(`<p class="sc-error-inline">${esc(err.message)}</p>`, true); els.steps.hidden = true; });
});
function srcBox(html, closable = false) {
  const box = $('src-box');
  box.dataset.kind = 'add';
  box.hidden = false;
  box.innerHTML = html;
  if (closable) {
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'sc-act'; x.textContent = 'Close';
    x.addEventListener('click', () => { box.hidden = true; });
    box.append(x);
  }
}

async function addSourceFile(f, { run = runStage, dec = decode } = {}) {
  if (S.sources.some(x => x.name === f.name && x.size === f.size)) throw new Error(`“${f.name}” is already part of this project.`);
  if (S.sources.length >= 4) throw new Error('At most three extra sources per project (memory).');
  const separate = key.endsWith('|sep');
  srcBox(`<p><strong>Adding “${esc(f.name)}”</strong> · the steps are shown at the top of the page. You can keep cutting meanwhile.</p>`);
  for (const li of els.steps.querySelectorAll('li')) { delete li.dataset.state; delete li.dataset.keep; li.querySelector('.bar i').style.width = '0'; li.querySelector('.detail').textContent = ''; }
  els.steps.hidden = false;
  setStage('decode', 'running');
  const { a16, a48, a44 } = await dec(f, separate);
  setStage('decode', 'done');
  const have = S.voice.length / SR, add = a16.length / 16000;
  if ((have + add) / 60 > MAX_TOTAL_MIN) throw new Error(`Together that would be ${Math.round((have + add) / 60)} minutes of sound – more than ${MAX_TOTAL_MIN} minutes do not fit in browser memory.`);
  let voice16 = a16, voice48 = a48, music48 = null;
  if (separate) ({ voice16, voice48, music48 } = await run('separate', { task: 'separate', a44, a48 }, [...a44.map(x => x.buffer)]));
  else setStage('separate', 'skipped');
  const tr = await run('transcribe', { task: 'transcribe', a16: voice16.slice(), lang: S.lang });
  const words = tr.words;
  // Stimmen vergleichen: je bekannter Stimme bis zu 10 s ihrer längsten Sätze (16 kHz)
  const refs = S.speakers.map(sp => ({ id: sp.id, clips: voiceSamples(sp.id) })).filter(r => r.clips.length);
  const { spk, match } = await run('speakers', { task: 'speakers', a16: voice16.slice(), words, refs });
  words.forEach((w, i) => { w.spk = spk[i] ?? 0; });
  const ph = await run('phonemes', { task: 'phonemes', a16: voice16.slice() });
  els.steps.hidden = true;

  // Welche neue Stimme ist welche bekannte? Vorschlag aus dem Vergleich, man kann es ändern.
  const secs = k => words.filter(w => w.spk === k).reduce((a, w) => a + w.e - w.s, 0);
  const known = S.speakers.map((sp, i) => `<option value="${sp.id}">Voice ${i + 1}${i === 0 ? ' (most)' : ''}</option>`).join('');
  const rows = match.filter(x => secs(x.spk) > 1).map(x => `<label class="sc-srcmap">Voice in the new file · ${clock(secs(x.spk), false)}
      <select data-spk="${x.spk}"><option value="new">a new voice</option>${known}</select>
      <small>${x.ref != null ? `sounds like Voice ${S.speakers.findIndex(sp => sp.id === x.ref) + 1}` : 'sounds like nobody here'}</small></label>`).join('');
  srcBox(`<p><strong>“${esc(f.name)}”</strong>: ${words.length} words. Who is speaking there?</p>${rows}`);
  const box = $('src-box');
  for (const x of match) { const sel = box.querySelector(`select[data-spk="${x.spk}"]`); if (sel && x.ref != null) sel.value = String(x.ref); }
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'sc-act sc-act-main'; go.textContent = 'Add to this project';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'sc-act'; no.textContent = 'Cancel';
  no.addEventListener('click', () => { box.hidden = true; });
  box.append(go, no);
  await new Promise(r => go.addEventListener('click', r, { once: true }));

  let next = Math.max(...S.speakers.map(x => x.id), 0) + 1;
  const map = new Map();
  for (const x of match) {
    const v = box.querySelector(`select[data-spk="${x.spk}"]`)?.value ?? (x.ref != null ? String(x.ref) : 'new');
    map.set(x.spk, v === 'new' ? next++ : Number(v));
  }
  for (const w of words) w.spk = map.get(w.spk) ?? next;
  srcBox(`<p><strong>Adding “${esc(f.name)}”</strong> · placing every sound in time…</p><p class="sc-busy"><span class="sc-busy-ring"></span><span class="sc-busy-text">This takes a minute or two.</span></p>`);
  mediaFiles.set(`${f.name}|${f.size}`, URL.createObjectURL(f));
  clearTimeout(saveTimer);
  await cache.put(`project|${key}`, projectState()).catch(() => {});
  worker.postMessage({ type: 'addSource', key, name: f.name, size: f.size, mainName: file.name, mainSize: file.size,
    words, post: ph.post, V: ph.V, vocab: ph.vocab, voice16, voice48, music48 },
    [ph.post.buffer, voice16.buffer, voice48.buffer, ...(music48 ? [music48.buffer] : [])]);
  // fertig, wenn der Worker „ready“ meldet: dann baut ready() das Schneidefenster neu auf
  addedSource = f.name;
}
let addedSource = null;

/** Bis zu 10 s der längsten Sätze einer Stimme als 16-kHz-Stücke (für den Stimmvergleich). */
function voiceSamples(id) {
  const groups = [];
  for (const w of S.words) {
    if (w.spk !== id || !(w.e > w.s)) continue;
    const g = groups.at(-1);
    if (g && w.s - g.e < 0.3) g.e = w.e; else groups.push({ s: w.s, e: w.e });
  }
  groups.sort((a, b) => (b.e - b.s) - (a.e - a.s));
  const out = [];
  let tot = 0;
  for (const g of groups) {
    if (tot >= 10 || g.e - g.s < 1) break;
    const a = Math.round(g.s * SR), b = Math.min(S.voice.length, Math.round(Math.min(g.e, g.s + 6) * SR));
    const x = new Float32Array(Math.floor((b - a) / 3));
    for (let i = 0; i < x.length; i++) { const j = a + 3 * i; x[i] = (S.voice[j] + S.voice[j + 1] + S.voice[j + 2]) / 3; }
    out.push(x);
    tot += x.length / 16000;
  }
  return out;
}

// ---------------------------------------------------------------- Projektdatei
// Klein: Spuren, Clips, Sätze (mit ihrem Ton). Groß: dazu die ganze Analyse – dann muss
// auf dem anderen Rechner nichts neu berechnet werden, nur dasselbe Video geladen sein.
$('proj-save').addEventListener('click', async e => {
  if (!S) return;
  const r = e.currentTarget.getBoundingClientRect();
  // Stimme und Musik (48 kHz), Stimme für die Merkmale (16 kHz), Laut-Wahrscheinlichkeiten (50 je s, ~400 Laute)
  const sec = S.voice.length / SR;
  const big = Math.round(estimateMB([S.voice, S.music]) + sec * (16000 * 2 + 50 * 400 * 2) / 1e6);
  showMenu([
    ['Project only (small)', '', () => saveProject(false)],
    [`Project and analysis (about ${big} MB)`, '', () => saveProject(true)],
    ['With the analysis, the other computer skips the long analysis. Either way, load the same video there first, then Open project.', '', null],
  ], r.left - 20, r.bottom - 6);
});
async function saveProject(withAnalysis) {
  clearTimeout(saveTimer);
  const p = projectState();
  await cache.put(`project|${key}`, p).catch(() => {});
  const [, , , langSetting, sep] = key.split('|');
  const analysis = withAnalysis ? await cache.get(key) : null;
  if (withAnalysis && !analysis) { fail('The analysis is not stored in this browser any more. Save the project without it.'); return; }
  const header = { format: 'slinky-cut-project', version: 1, saved: new Date().toISOString(),
    video: { name: file.name, size: file.size, duration: S.duration }, lang: S.lang, langSetting, separate: sep === 'sep', sources: S.sources, project: p, analysis };
  const blob = pack(header, new Set(analysis ? [analysis.raw.post] : []));
  download(blob, `${file.name.replace(/\.[^.]+$/, '')}.slinky`);
}

$('proj-open').addEventListener('click', () => $('proj-file').click());
$('proj-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !file) return;
  try { await openProject(f); } catch (err) { fail(err.message); }
});
async function openProject(f) {
  const h = await unpack(f);
  if (h.format !== 'slinky-cut-project') throw new Error('This is not a Slinky-Cut project file.');
  const same = h.video.name === file.name && h.video.size === file.size;
  const close = Math.abs((h.video.duration ?? 0) - (els.video.duration || h.video.duration)) < 1;
  const extra = (h.sources ?? []).slice(1).map(x => `“${x.name}”`);
  const warn = (same ? '' : `This project was made for “${h.video.name}”${close ? '' : ', a video of another length'}. The clips may not fit this video. `)
    + (extra.length && !(h.analysis && close) ? `It also used ${extra.join(', ')}: add ${extra.length > 1 ? 'them' : 'it'} again with Add source, in the same order.` : '');
  if (S) {
    // Im Schneidefenster: Projekt übernehmen (rückgängig machbar), die Analyse hier bleibt
    const { tl } = S;
    tl.commit();
    const p = migrate(h.project);
    tl.tracks = p.tracks; tl.clips = p.clips; reserveIds(p.clips);
    S.bin = h.project.bin ?? []; S.story = h.project.story ?? null; S.binTab = 'cut'; renderBin();
    tl.build();
    if (h.project.range) tl.setRange(h.project.range.a, h.project.range.b); else tl.setRange(null, null);
    tl.changed();
    requestAnimationFrame(() => { tl.fit(); syncZoomSlider(); });
    els.estimate.textContent = warn || `Opened ${f.name}.`;
    return;
  }
  // Vor der Analyse: Einstellungen wie im Projekt; mitgebrachte Analyse ersetzt die Berechnung
  const r = document.querySelector(`input[name="lang"][value="${h.langSetting ?? 'auto'}"]`);
  if (r) r.checked = true;
  els.separate.checked = !!h.separate;
  const k = `${file.name}|${file.size}|${file.lastModified}|${h.langSetting ?? 'auto'}|${h.separate ? 'sep' : 'mix'}`;
  if (h.analysis && close) await cache.put(k, h.analysis);
  await cache.put(`project|${k}`, h.project);
  els.estimate.textContent = warn || (h.analysis && close ? 'Project with analysis: opening…' : 'Project opened. The video is analysed first, then your clips appear.');
  els.analyze.click();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
}

function fail(msg) {
  els.error.textContent = `Something went wrong: ${msg}`;
  els.error.hidden = false;
  els.analyze.disabled = false;
}

// ---------------------------------------------------------------- Ideen (Sprachmodell über OpenRouter)
// Das Modell entscheidet nur, WAS gesagt wird – möglichst mit Wörtern, die im Video
// vorkommen. Wie es klingt, prüft Slinky-Cut selbst: Jeder Vorschlag wird
// geschnitten und bewertet, nur die am besten klingenden landen in der Liste.
const store = {
  get: k => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ohne Speicher eben nicht */ } },
};
// Wasserzeichen beim Ausgeben: an, bis man es abwählt (gemerkt)
$('export-mark').checked = store.get('slinky-watermark') !== '0';
$('export-mark').addEventListener('change', e => store.set('slinky-watermark', e.target.checked ? '1' : '0'));
const ideas = { btn: $('ideas-btn'), box: $('ideas'), topic: $('ideas-topic'), key: $('ideas-key'), model: $('ideas-model'), go: $('ideas-go'), status: $('ideas-status'), list: $('ideas-models') };
ideas.key.value = store.get('slinky-openrouter-key');
// alte Voreinstellung durch die neue ersetzen, eine eigene Wahl bleibt
// alte Voreinstellungen durch die neue ersetzen, eine eigene Wahl bleibt
ideas.model.value = [store.get('slinky-openrouter-model')].find(m => m && !['google/gemini-2.5-flash-lite', 'deepseek/deepseek-v4.1-flash-1017'].includes(m)) ?? DEFAULT_MODEL;
// Auswahl: die empfohlenen Modelle, sonst „Other…“ mit Freitext und Vorschlägen
const pick = $('ideas-pick');
pick.replaceChildren(...MODELS.map(m => Object.assign(document.createElement('option'), { value: m.id, textContent: m.label })),
  Object.assign(document.createElement('option'), { value: '', textContent: 'Other model…' }));
const syncPick = () => { const known = MODELS.some(m => m.id === ideas.model.value); pick.value = known ? ideas.model.value : ''; $('ideas-other').hidden = known; };
syncPick();
pick.addEventListener('change', () => {
  if (pick.value) { ideas.model.value = pick.value; store.set('slinky-openrouter-model', pick.value); }
  $('ideas-other').hidden = !!pick.value;
  if (!pick.value) { ideas.model.value = ''; ideas.model.focus(); loadModels(); }
});
// Schlüssel gespeichert: Feld zugeklappt, nur ein Hinweis; ohne Schlüssel offen
const keyInfo = () => { const k = ideas.key.value.trim(); $('ideas-keyinfo').textContent = k ? '· saved' : ''; if (!k) $('ideas-keys').open = true; };
keyInfo();
ideas.key.addEventListener('change', () => { store.set('slinky-openrouter-key', ideas.key.value.trim()); keyInfo(); });
ideas.model.addEventListener('change', () => { store.set('slinky-openrouter-model', ideas.model.value.trim()); if (MODELS.some(m => m.id === ideas.model.value.trim())) syncPick(); });
ideas.btn.addEventListener('click', () => {
  ideas.box.hidden = !ideas.box.hidden;
  ideas.btn.setAttribute('aria-expanded', String(!ideas.box.hidden));
  if (!ideas.box.hidden && !ideas.list.childElementCount) loadModels();
});
// Modellliste für die Auswahl (günstige zuerst); ohne Netz bleibt das Feld frei
// Vorschläge für „Other…“: Textmodelle mit JSON-Antwort, günstig zuerst, mit Preis
async function loadModels() {
  if (ideas.list.childElementCount) return;
  try {
    const { data } = await (await fetch('https://openrouter.ai/api/v1/models')).json();
    const $M = m => Number(m.pricing?.prompt ?? 1) * 6000 + Number(m.pricing?.completion ?? 1) * 2000;   // $ für eine Suche: ≈ 6k Token rein, 2k raus
    const ok = m => Number(m.pricing?.prompt) > 0 && m.architecture?.output_modalities?.includes('text')
      && (m.supported_parameters ?? []).some(p => p === 'response_format' || p === 'structured_outputs') && (m.context_length ?? 0) >= 32000;
    ideas.list.replaceChildren(...data.filter(ok).sort((a, b) => $M(a) - $M(b)).slice(0, 120)
      .map(m => Object.assign(document.createElement('option'), { value: m.id, label: `${m.name ?? m.id} · ~${($M(m) * 100).toFixed(2)} ct` })));
  } catch { /* ohne Netz: Freitext */ }
}
const idle = () => { ideas.go.disabled = false; findsGo.disabled = false; ideas.go.classList.remove('busy'); ideas.status.classList.remove('sc-busy-text'); };
ideas.go.addEventListener('click', () => S && getIdeas({ topic: ideas.topic.value.trim() }).catch(err => { ideas.status.textContent = err.message; idle(); }));

/** Satzvorschläge holen, schneiden, bewerten; die besten `keep` kommen in die Liste. */
async function getIdeas({ topic = '', count = 16, keep = 5 } = {}) {
  const key = ideas.key.value.trim(), model = ideas.model.value.trim() || DEFAULT_MODEL;
  if (!key) { ideas.status.textContent = 'Please enter your OpenRouter key.'; $('ideas-keys').open = true; ideas.key.focus(); return []; }
  store.set('slinky-openrouter-key', key); store.set('slinky-openrouter-model', model);
  ideas.go.disabled = true; findsGo.disabled = true; ideas.go.classList.add('busy'); ideas.status.classList.add('sc-busy-text');
  const spk = speaker();
  const ws = S.words.filter(w => spk == null || w.spk === spk);
  // Jede Zeile wird geschnitten, sobald sie ankommt; was verständlich bleibt, kommt sofort
  // in die Liste (in der Reihenfolge des Modells: lustigste zuerst)
  showBinTab('cut');
  let at = 0, n = 0;
  const added = [];
  const pick = streamPick(keep, ({ text, r }) => {
    const b = { id: newId(), text, audio: r.audio, words: r.words, pieces: r.pieces, speaker: spk, force: r.force, rev: 0, ai: true };
    S.bin.splice(at++, 0, b); added.push(text);
    renderBin(); save();
  });
  const st = modelStatus(t => { ideas.status.textContent = t; }), q = queue();
  try {
    const { pron } = await request({ type: 'pron', words: vocabulary(ws) });
    await generateIdeas({ key, model, words: ws, lang: S.lang, topic, count, pron, onStatus: m => { ideas.status.textContent = m; }, onPhase: st.phase,
      onLine: text => q.add(async () => {
        n++;
        const r = await request({ type: 'mix', text, speaker: spk });
        pick.offer({ text, r, cost: buildCost(r.words) });
        ideas.status.textContent = `${pick.count} ideas added so far – cutting more…`;
      }) });
    st.phase('writing');
    await q.done();
  } finally { st.stop(); }
  pick.finish();
  if (!n) throw new Error('The model sent no usable lines. Try again.');
  ideas.status.textContent = `Added ${added.length} of ${n} ideas – the funniest that cut cleanly.`;
  idle();
  return added;
}

// ---------------------------------------------------------------- Schnittstelle für Agenten
// Für Automatisierung (z. B. ein KI-Agent mit Browser-Zugriff). Beschreibung in README.md.
// nur für den Oberflächentest (ohne Modelle): Quelle mit vorgegebenen Stufen-Ergebnissen anhängen
if (location.hostname === 'localhost') window.__slinkyTest = { addSourceFile, exportDone };
window.slinkyCut = {
  /** Was gesagt wird: [{w, s, e, spk}] (Sekunden in der Quelle). */
  transcript: () => S?.words.map(({ w, s, e, spk }) => ({ w, s, e, spk })) ?? [],
  /** Einen Satz schneiden; landet in der Liste. → {id, words: [{w, quality}]} */
  async cut(text, { speaker: spk = speaker() } = {}) {
    const r = await request({ type: 'mix', text, speaker: spk });
    const b = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, audio: r.audio, words: r.words, pieces: r.pieces, speaker: spk, force: r.force, rev: 0 };
    S.bin.unshift(b); S.binTab = 'cut'; renderBin(); save();
    return { id: b.id, words: b.words.map(w => ({ w: w.w, quality: w.quality })) };
  },
  /** Alternativen für Wort wi (si = Silbe, -1 = ganzes Wort). → [{index, label, quality, current}] */
  async alternatives(id, wi, si = -1) {
    const b = S.bin.find(x => x.id === id);
    const r = await request(si < 0 ? { type: 'variants', text: b.text, speaker: b.speaker, force: b.force, wi }
      : { type: 'sylVariants', text: b.text, speaker: b.speaker, force: b.force, wi, si });
    this._last = { id, options: r.options };
    return r.options.map((o, index) => ({ index, label: o.label, quality: o.quality, current: o.current }));
  },
  /** Eine Alternative aus dem letzten alternatives()-Aufruf übernehmen. */
  choose(index) { const { id, options } = this._last; updateBin(id, options[index]); return true; },
  /** Wort wi umschreiben (auch mehrere Wörter, leer = löschen). */
  async rewrite(id, wi, replacement) {
    const b = S.bin.find(x => x.id === id);
    const r = await request({ type: 'rewrite', text: b.text, speaker: b.speaker, force: b.force, wi, replacement });
    updateBin(id, { audio: r.audio, words: r.words, segs: r.pieces, force: r.force, text: r.text });
    return r.text;
  },
  /** Vorschläge vom Sprachmodell (braucht den OpenRouter-Schlüssel im Ideen-Feld). */
  ideas: (topic = '') => getIdeas({ topic }),
  /** Satz aus der Liste auf eine Tonspur legen (Sekunden). */
  place(id, at = S.tl.playhead, track = 'a1') { placeTake(S.bin.find(x => x.id === id), at, track); return true; },
  play: (from = 0, to = null) => S.player.play(from, { until: to }),
  stop: () => S.player.stop(),
  /** Die Zeitleiste als Daten (ohne Ton). */
  clips: () => S?.tl.clips.map(({ take, ...c }) => ({ ...c, text: take?.text })) ?? [],
  /** Mischung als WAV, ganz oder von t0 bis t1 (s). */
  wav: (t0 = 0, t1 = S.tl.end()) => new Blob([encodeWav(S.player.mix(t0, t1))], { type: 'audio/wav' }),
  /** Ausgabebereich setzen (null, null = keiner). */
  range: (a, b) => { S.tl.setRange(a, b); return S.tl.range; },
};
