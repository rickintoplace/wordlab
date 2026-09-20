// Sprachausgabe über die eingebaute Web-Speech-API — kostenlos, offline,
// keine Abhängigkeit. Bei einem lautlichen Werkzeug ist Hören der Beweis:
// gelesen sind "ice cream" und "I scream" verschieden, gehört sind sie gleich.
//
// Zwei Eigenheiten machen das unangenehmer, als es sein müsste:
//
// 1. Unter Linux holen die Browser ihre Stimmen von speech-dispatcher. Fehlt
//    das Paket, existiert speechSynthesis zwar, liefert aber keine einzige
//    Stimme und schweigt bei jedem Aufruf — ohne Fehler.
// 2. Chrome liefert bei `getVoices()` anfangs oft ein leeres Feld und füllt es
//    erst später; je nach Version feuert `voiceschanged` spät oder gar nicht.
//    Deshalb wird hier zusätzlich nachgefasst, statt einmal zu fragen.

export const hasApi = typeof speechSynthesis !== 'undefined';

const STORAGE_KEY = 'preferred-voice';
let chosen = null;

const english = list => list.filter(v => v.lang?.toLowerCase().startsWith('en'));

/**
 * Nicht alle Systemstimmen sind gleich. Windows 11 und macOS bringen seit ein
 * paar Jahren neuronale Stimmen mit, die gut klingen — sie heißen nur anders als
 * die alten. Chrome bringt zusätzlich eigene Netzstimmen mit. Ohne diese
 * Rangfolge landet man leicht bei der ältesten Formantstimme des Systems.
 *
 * Kleinere Zahl = besser.
 */
const GOOD_NAMES = /\b(ava|andrew|emma|brian|samantha|alex|allison|susan|daniel|karen|moira|serena|fiona|tom|aria|jenny|guy)\b/i;

export function voiceQuality(v) {
  const name = v.name ?? '';
  if (/espeak|\+/i.test(name)) return 90;             // espeak-ng samt Klangvarianten
  if (/\(natural\)|neural/i.test(name)) return 0;     // Windows 11
  if (/premium|enhanced/i.test(name)) return 1;        // macOS
  if (/^google /i.test(name)) return 2;                // Chrome-Netzstimmen
  if (GOOD_NAMES.test(name)) return 3;                 // gepflegte Systemstimmen
  if (/^microsoft /i.test(name)) return 5;             // ältere SAPI-Stimmen
  return 10;
}

/** Innerhalb gleicher Güte zählen Sprachvariante und Systemvorgabe. */
const rank = v => voiceQuality(v) * 10
  + (/^en[-_]?(us|gb)/i.test(v.lang ?? '') ? 0 : 2)
  + (v.default ? 0 : 1);

/**
 * Alle brauchbaren Stimmen. espeak-ng bringt über speech-dispatcher tausende
 * Klangvarianten mit; ohne Deckel wird die Auswahl unbedienbar.
 */
const MAX_VOICES = 60;

export function listVoices() {
  if (!hasApi) return [];
  const all = speechSynthesis.getVoices();
  const en = english(all);
  const pool = en.length ? en : all;

  const seen = new Set();
  const unique = pool.filter(v => !seen.has(v.name) && seen.add(v.name));
  return unique.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_VOICES);
}

function preferred() {
  const list = listVoices();
  if (!list.length) return null;
  if (chosen) {
    const still = list.find(v => v.voiceURI === chosen);
    if (still) return still;
  }
  const saved = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
  return list.find(v => v.voiceURI === saved)
    ?? list.find(v => v.lang === 'en-US' && v.localService)
    ?? list.find(v => v.lang === 'en-US')
    ?? list[0];
}

export function currentVoice() { return preferred(); }

export function setVoice(uri) {
  chosen = uri;
  try { localStorage.setItem(STORAGE_KEY, uri); } catch { /* privater Modus */ }
}

/**
 * Wartet darauf, dass überhaupt eine Stimme auftaucht — mit Nachfassen, weil
 * Chrome die Liste verspätet füllt.
 * @returns {Promise<boolean>}
 */
// 3,5 s: lang genug für Chromes verspätete Stimmenliste, kurz genug, dass der
// Hinweis bei fehlenden Stimmen nicht ewig auf sich warten lässt.
export function voicesReady(timeout = 3500) {
  if (!hasApi) return Promise.resolve(false);
  if (preferred()) return Promise.resolve(true);
  return new Promise(resolve => {
    const started = Date.now();
    const finish = ok => {
      clearInterval(poll);
      speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(ok);
    };
    const check = () => {
      if (preferred()) finish(true);
      else if (Date.now() - started >= timeout) finish(false);
    };
    const onChange = () => check();
    speechSynthesis.addEventListener('voiceschanged', onChange);
    const poll = setInterval(check, 250);     // der Aufruf stößt Chrome mit an
  });
}

/**
 * Spricht einen Text. Löst spätestens nach `guard` ms auf, auch wenn die
 * Sprachausgabe gar nicht anspringt — sonst hängt der Aufrufer für immer.
 * @returns {Promise<boolean>} ob wirklich gesprochen wurde
 */
export async function say(text, { rate = 0.95, pitch = 1, guard = 8000 } = {}) {
  if (!hasApi) return false;
  let voice = preferred();
  if (!voice) {
    // Chrome kann die Liste erst beim ersten Klick gefüllt haben.
    if (!await voicesReady(1500)) return false;
    voice = preferred();
  }

  speechSynthesis.cancel();                  // Chrome verschluckt sich sonst
  return new Promise(resolve => {
    let settled = false;
    const finish = ok => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    const timer = setTimeout(() => finish(false), guard);

    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;
    u.pitch = pitch;
    u.addEventListener('end', () => finish(true));
    u.addEventListener('error', () => finish(false));
    speechSynthesis.speak(u);
  });
}

export const stopSpeaking = () => { if (hasApi) speechSynthesis.cancel(); };

/** Spricht mehrere Texte nacheinander mit Pause dazwischen. */
export async function sayAll(texts, { gap = 420, ...opts } = {}) {
  for (const [i, text] of texts.entries()) {
    if (i) await new Promise(r => setTimeout(r, gap));
    if (!await say(text, opts)) return false;
  }
  return true;
}

/**
 * Baut die Stimmenauswahl. Vorgewählt ist die nach Güte beste vorhandene
 * Stimme; unter Linux ist das erfahrungsgemäß trotzdem nicht viel.
 * @param {HTMLElement} host
 * @param {() => string} sample liefert den Text zum Vorhören
 */
export function mountVoiceControls(host, sample) {
  host.replaceChildren();
  const picker = buildPicker(() => { const text = sample?.(); if (text) say(text); });
  if (picker) host.append(picker);

  // Wenn das Beste, was das System hergibt, eine espeak-Variante ist, klingt es
  // hart — und daran lässt sich von hier aus nichts ändern. Lieber sagen.
  const best = preferred();
  if (best && voiceQuality(best) >= 90) {
    const note = document.createElement('small');
    note.className = 'voice-note';
    note.innerHTML = 'Only robotic espeak voices here. '
      + '<span>Installing <code>rhvoice</code> and registering it with '
      + '<code>speech-dispatcher</code> helps.</span>';
    host.append(note);
  }
  return picker;
}

/**
 * speech-dispatcher reicht espeak-ng samt aller Klangvarianten durch — das sind
 * schnell dreistellig viele Einträge, die sich nur durch ein Kürzel wie "+f3"
 * unterscheiden. Hier wird nach Grundstimme gruppiert, damit die Liste
 * benutzbar bleibt.
 */
function grouped(voices) {
  const groups = new Map();
  for (const v of voices) {
    const [base, variant] = v.name.split('+');
    const key = base.trim();
    const bucket = groups.get(key) ?? groups.set(key, []).get(key);
    bucket.push({ voice: v, variant: variant ? variant.trim() : null });
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => (a.variant ? 1 : 0) - (b.variant ? 1 : 0)
      || (a.variant ?? '').localeCompare(b.variant ?? ''));
  }
  return groups;
}

function buildPicker(preview) {
  const voices = listVoices();
  if (voices.length < 2) return null;

  const wrap = document.createElement('label');
  wrap.className = 'voice-picker';
  wrap.append('Voice');

  const select = document.createElement('select');
  for (const [base, entries] of grouped(voices)) {
    const target = entries.length > 1
      ? select.appendChild(Object.assign(document.createElement('optgroup'), { label: base }))
      : select;
    for (const { voice, variant } of entries) {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = entries.length > 1
        ? (variant ?? 'default')
        : base + (voice.lang ? ` · ${voice.lang}` : '');
      target.append(option);
    }
  }
  select.value = preferred()?.voiceURI ?? voices[0].voiceURI;
  select.addEventListener('change', () => { setVoice(select.value); preview(); });

  wrap.append(select);
  return wrap;
}
