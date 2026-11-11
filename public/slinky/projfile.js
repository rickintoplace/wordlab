// Projektdatei (.slinky): Kopf als JSON, danach die Tonspuren als Binärblöcke.
//
//   "SLINKYCUT1" · Kopflänge (uint32, LE) · Kopf (UTF-8-JSON) · Blöcke …
//
// Im Kopf stehen Float32Arrays als {$blob: n}; Block n liegt bei blobs[n].offset
// (ab Ende des Kopfs). Ton wird als 16 Bit mit eigenem Maßstab gespeichert (halb so
// groß, für das Ohr verlustfrei), die Modell-Wahrscheinlichkeiten als 16 Bit in
// Tausendsteln (Logarithmen zwischen −32 und 0).

const MAGIC = 'SLINKYCUT1';

/** Wert → Blob. `logp` = Menge der Arrays, die Log-Wahrscheinlichkeiten sind. */
export function pack(header, logp = new Set()) {
  const blobs = [], parts = [];
  let offset = 0;
  const json = JSON.stringify(header, (k, v) => {
    if (!(v instanceof Float32Array)) return v;
    let data, enc, scale = 1;
    if (logp.has(v)) {
      enc = 'logp';
      data = new Int16Array(v.length);
      for (let i = 0; i < v.length; i++) data[i] = Math.max(-32767, Math.round(Math.max(-32.767, v[i]) * 1000));
    } else {
      enc = 'pcm16';
      let peak = 0;
      for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]); if (a > peak) peak = a; }
      scale = Math.max(1, peak);
      data = new Int16Array(v.length);
      for (let i = 0; i < v.length; i++) data[i] = Math.round(v[i] / scale * 32767);
    }
    blobs.push({ offset, length: v.length, enc, scale });
    parts.push(data);
    offset += data.byteLength;
    return { $blob: blobs.length - 1 };
  });
  const head = new TextEncoder().encode(JSON.stringify({ blobs, json }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length, true);
  return new Blob([MAGIC, len, head, ...parts], { type: 'application/octet-stream' });
}

/** Blob/File → Wert (wie an pack übergeben). */
export async function unpack(file) {
  const magic = await file.slice(0, MAGIC.length).text();
  if (magic !== MAGIC) throw new Error('This is not a Slinky-Cut project file.');
  const n = new DataView(await file.slice(MAGIC.length, MAGIC.length + 4).arrayBuffer()).getUint32(0, true);
  const start = MAGIC.length + 4;
  const { blobs, json } = JSON.parse(await file.slice(start, start + n).text());
  const base = start + n;
  const arrays = [];
  for (const b of blobs) {
    const raw = new Int16Array(await file.slice(base + b.offset, base + b.offset + b.length * 2).arrayBuffer());
    const out = new Float32Array(b.length);
    if (b.enc === 'logp') for (let i = 0; i < raw.length; i++) out[i] = raw[i] <= -32767 ? -1e9 : raw[i] / 1000;
    else { const k = b.scale / 32767; for (let i = 0; i < raw.length; i++) out[i] = raw[i] * k; }
    arrays.push(out);
  }
  return JSON.parse(json, (k, v) => (v && typeof v === 'object' && '$blob' in v ? arrays[v.$blob] : v));
}

/** Ungefähre Größe in MB, ohne zu packen. */
export function estimateMB(arrays) {
  return arrays.reduce((s, a) => s + (a?.length ?? 0) * 2, 0) / 1e6;
}
