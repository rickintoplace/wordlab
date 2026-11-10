// Slinky-Cut: das Projekt als reine Daten – Spuren, Clips und alle Rechnungen
// darauf (Teilen, Platz schaffen, Blenden, Tonmischung). Ohne DOM, läuft auch in Node.
//
// Spur: { id, kind: 'video'|'audio', name, muted }   (oben in der Liste = oben im Bild)
// Clip: { id, track, type: 'video'|'lips'|'orig'|'take'|'snip'|'music',
//         at, len,            Lage auf der Zeitleiste (s)
//         src,                Beginn des benutzten Quellstücks (s)
//         speed, reverse,     Tempo (1 = normal) und rückwärts
//         gain,               Lautstärke (linear)
//         fadeIn, fadeOut,    Blendenlängen (s)
//         extIn, extOut,      Überlappung in den Nachbarn (s) – für Überblendungen
//         muted, label, take, ref }

export const SR = 48000;

export const defaultTracks = () => [
  { id: 'v2', kind: 'video', name: 'Lips' },
  { id: 'v1', kind: 'video', name: 'Video' },
  { id: 'a1', kind: 'audio', name: 'Voice' },
  { id: 'a2', kind: 'audio', name: 'Music' },
];
// Projekte von vorher hatten feste Spurnamen
export const LEGACY_TRACK = { over: 'v2', video: 'v1', voice: 'a1', music: 'a2' };

export const KIND = { video: 'video', lips: 'video', orig: 'audio', take: 'audio', snip: 'audio', music: 'audio' };
export const speedOf = c => c.speed ?? 1;
export const endOf = c => c.at + c.len;
/** Wie viel Quelle der Clip verbraucht (s). */
export const srcSpan = c => c.len * speedOf(c);

/** Quellzeit zur Zeitleistenzeit t (auch außerhalb des Clips, für Überlappungen). */
export function sourceAt(c, t) {
  const u = (t - c.at) * speedOf(c);
  return c.reverse ? c.src + srcSpan(c) - u : c.src + u;
}
/** Zeitleistenzeit zur Quellzeit s. */
export function timeOf(c, s) {
  const u = c.reverse ? c.src + srcSpan(c) - s : s - c.src;
  return c.at + u / speedOf(c);
}

/** Teilstück eines Clips für den Zeitleistenbereich [a, b]. */
export function sub(c, a, b, newId) {
  const sp = speedOf(c), end = endOf(c);
  const keepStart = Math.abs(a - c.at) < 1e-6, keepEnd = Math.abs(b - end) < 1e-6;
  return {
    ...c,
    id: keepStart ? c.id : newId(),
    at: a, len: b - a,
    src: c.reverse ? c.src + (end - b) * sp : c.src + (a - c.at) * sp,
    fadeIn: keepStart ? c.fadeIn ?? 0 : 0, extIn: keepStart ? c.extIn ?? 0 : 0,
    fadeOut: keepEnd ? c.fadeOut ?? 0 : 0, extOut: keepEnd ? c.extOut ?? 0 : 0,
  };
}

/** Platz schaffen: Was auf der Spur in [at, at+len) liegt, wird gekürzt, geteilt oder entfernt. */
export function clearRange(clips, track, at, len, except, newId) {
  const end = at + len, out = [], gone = new Set();
  for (const c of clips) {
    if (c.track !== track || except?.has?.(c.id) || c.id === except || c.at >= end - 1e-6 || endOf(c) <= at + 1e-6) { out.push(c); continue; }
    if (c.at < at) out.push(sub(c, c.at, at, newId));
    if (endOf(c) > end) out.push(sub(c, end, endOf(c), c.at < at ? newId : () => c.id));
    if (c.at >= at && endOf(c) <= end) gone.add(c.id);
  }
  // Lippen-Schnipsel eines ganz überdeckten Clips gehen mit
  return out.filter(c => !gone.has(c.ref));
}

/** Clips an der Zeit t teilen (nur die angegebenen ids oder alle darunter). Liefert die neuen Clips. */
export function splitAt(clips, t, ids, newId) {
  const out = [];
  let did = false;
  for (const c of clips) {
    if ((ids && !ids.has(c.id)) || t <= c.at + 0.01 || t >= endOf(c) - 0.01) { out.push(c); continue; }
    out.push(sub(c, c.at, t, newId), sub(c, t, endOf(c), newId));
    did = true;
  }
  return did ? out : null;
}

/** Hüllkurve (0…1) eines Clips zur Zeit t, einschließlich Überlappung und Blenden. */
export function envelope(c, t) {
  const a = c.at - (c.extIn ?? 0), b = endOf(c) + (c.extOut ?? 0);
  if (t < a || t >= b) return 0;
  let g = 1;
  const fi = c.fadeIn ?? 0, fo = c.fadeOut ?? 0;
  if (fi > 0 && t < a + fi) g *= Math.sin(((t - a) / fi) * Math.PI / 2);
  if (fo > 0 && t > b - fo) g *= Math.sin(((b - t) / fo) * Math.PI / 2);
  return g;
}
export const reach = c => [c.at - (c.extIn ?? 0), endOf(c) + (c.extOut ?? 0)];

/**
 * Alle hörbaren Clips von t0 bis t1 mischen.
 * @param {(clip)=>Float32Array|null} source  Ton eines Clips (48 kHz, mono)
 */
export function mix(clips, tracks, source, t0, t1) {
  const n = Math.max(0, Math.round((t1 - t0) * SR)), out = new Float32Array(n);
  const mutedTrack = new Set(tracks.filter(t => t.muted).map(t => t.id));
  const EDGE = 0.004, HALF_PI = Math.PI / 2;
  for (const c of clips) {
    const data = source(c);
    if (!data || c.muted || mutedTrack.has(c.track)) continue;
    const [ra, rb] = reach(c);
    const a = Math.max(ra, t0), b = Math.min(rb, t1);
    if (b <= a) continue;
    const sp = speedOf(c), g0 = c.gain ?? 1;
    const i0 = Math.round((a - t0) * SR), i1 = Math.min(n, Math.round((b - t0) * SR));
    // Blenden in Samples, gemessen vom Rand der Reichweite (ohne eigene: 4 ms gegen Knackser)
    const fiN = Math.max(c.fadeIn ?? 0, EDGE) * SR, foN = Math.max(c.fadeOut ?? 0, EDGE) * SR;
    const ra0 = (ra - t0) * SR, rb0 = (rb - t0) * SR;
    const gain = i => {
      let g = g0;
      const x = i - ra0, y = rb0 - i;
      if (x < fiN) g *= Math.sin(Math.max(0, x / fiN) * HALF_PI);
      if (y < foN) g *= Math.sin(Math.max(0, y / foN) * HALF_PI);
      return g;
    };
    if (sp === 1 && !c.reverse) {
      // Normalfall: Sample für Sample kopieren, ohne Interpolation
      const off = Math.round((c.src - (c.at - t0)) * SR);
      const fadeEnd = Math.min(i1, Math.ceil(ra0 + fiN)), fadeStart = Math.max(fadeEnd, Math.floor(rb0 - foN));
      for (let i = i0; i < fadeEnd; i++) out[i] += (data[off + i] ?? 0) * gain(i);
      for (let i = Math.max(i0, fadeEnd); i < Math.min(i1, fadeStart); i++) out[i] += (data[off + i] ?? 0) * g0;
      for (let i = Math.max(i0, fadeStart); i < i1; i++) out[i] += (data[off + i] ?? 0) * gain(i);
      continue;
    }
    for (let i = i0; i < i1; i++) {
      const t = t0 + i / SR;
      const u = (t - c.at) * sp, s = (c.reverse ? c.src + c.len * sp - u : c.src + u) * SR;
      const k = Math.floor(s), f = s - k;
      out[i] += ((data[k] ?? 0) * (1 - f) + (data[k + 1] ?? 0) * f) * gain(i);
    }
  }
  return out;
}

/** Nachbarn auf derselben Spur, die direkt anstoßen (±10 ms). */
export function neighbours(clips, c) {
  const same = clips.filter(x => x.track === c.track && x.id !== c.id);
  return {
    left: same.find(x => Math.abs(endOf(x) - c.at) < 0.01) ?? null,
    right: same.find(x => Math.abs(x.at - endOf(c)) < 0.01) ?? null,
  };
}

/**
 * Überblendung an beiden Rändern der gewählten Clips (Taste X); noch einmal X nimmt sie weg.
 * Länge: Ton 60 ms, Bild 0,5 s (höchstens ein Drittel der beteiligten Clips).
 */
export function toggleCrossfades(clips, ids, tracks) {
  const kindOf = id => tracks.find(t => t.id === id)?.kind;
  const pairs = [];
  for (const c of clips.filter(x => ids.has(x.id))) {
    const { left, right } = neighbours(clips, c);
    if (left) pairs.push([left, c]);
    if (right) pairs.push([c, right]);
  }
  if (!pairs.length) return false;
  const on = pairs.some(([a]) => !(a.extOut > 0));
  for (const [a, b] of pairs) {
    if (on) {
      const d = Math.min(kindOf(a.track) === 'video' ? 0.5 : 0.06, a.len / 3, b.len / 3);
      a.extOut = d / 2; a.fadeOut = d; b.extIn = d / 2; b.fadeIn = d;
    } else { a.extOut = 0; a.fadeOut = 0; b.extIn = 0; b.fadeIn = 0; }
  }
  return true;
}

/** Projekt aus älteren Fassungen auf den aktuellen Stand bringen. */
export function migrate(saved) {
  const tracks = saved.tracks ?? defaultTracks();
  const clips = saved.clips.map(c => ({ ...c, track: LEGACY_TRACK[c.track] ?? c.track }));
  return { tracks, clips };
}
