// Slinky-Cut: Abspielen und Ausgeben der Zeitleiste.
// Ton: wird für jedes Abspielen frisch gemischt (project.mix) und als ein Stück
// abgespielt – die Vorschau klingt genau wie die Ausgabe.
// Bild: ein Canvas; je sichtbarem Video-Clip ein (verstecktes) <video>, das
// nachgeführt wird – vorwärts mit seinem Tempo, rückwärts Bild für Bild.

import { SR, mix, reach, sourceAt, speedOf, endOf } from './project.js';

const POOL = 4;
const isFirefox = () => /Firefox\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.mjs';

export class Player extends EventTarget {
  constructor({ timeline, voice, music, url, canvas, badge }) {
    super();
    Object.assign(this, { tl: timeline, voice, music, canvas, badge });
    // Bildquellen: weitere Aufnahmen liegen in der Quellzeit hinter dem Hauptvideo
    this.media = [{ url, offset: 0 }];
    this.g = canvas.getContext('2d');
    this.ctx = null;
    this.node = null;
    this.playing = false;
    this.raf = 0;
    // Videoelemente: unsichtbar im Dokument (sonst dekodieren manche Browser nicht)
    this.hold = document.createElement('div');
    this.hold.className = 'sc-vpool';
    this.pool = Array.from({ length: POOL }, () => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      const p = { v, clip: null, k: 0 };
      // Nach jeder Suche das Bild festhalten: Rückwärts wird ständig gesucht, und
      // ein suchendes Element liefert kein Bild – ohne das stünde das Bild still.
      v.addEventListener('seeked', () => { this.capture(p); if (!this.playing) this.draw(this.tl.playhead); });
      v.addEventListener('loadeddata', () => { if (!this.playing) this.sync(this.tl.playhead); });
      this.hold.append(v);
      return p;
    });
    canvas.after(this.hold);
    const v0 = this.pool[0].v;
    v0.addEventListener('loadedmetadata', () => this.size(), { once: true });
  }

  /** Bildquellen setzen: [{url (oder null, wenn die Datei fehlt), offset}] in Quellzeit. */
  setMedia(list) {
    this.media = list;
    for (const p of this.pool) if (p.k !== 0 || !list[0]?.url) { p.k = -1; p.clip = null; }
    this.sync(this.tl.playhead);
  }
  /** Quellzeit → welche Aufnahme, und die Zeit darin. */
  locate(s) {
    let k = 0;
    for (let i = 1; i < this.media.length; i++) if (s >= this.media[i].offset - 0.5) k = i;
    return { k, t: s - this.media[k].offset };
  }
  /** Element auf eine andere Aufnahme umstellen. */
  load(p, k) {
    p.k = k; p.snap = null; p.shot = null;
    const url = this.media[k]?.url;
    if (url) { if (p.v.src !== url) p.v.src = url; } else p.v.removeAttribute('src');
  }
  has(k) { return !!this.media[k]?.url; }

  size() {
    const v = this.pool[0].v, w0 = v.videoWidth || 1280, h0 = v.videoHeight || 720, k = Math.min(1, 1280 / w0);
    this.canvas.width = Math.round(w0 * k / 2) * 2;
    this.canvas.height = Math.round(h0 * k / 2) * 2;
    this.draw(this.tl.playhead);
  }

  /** Ton eines Clips. Video-Clips sind stumm (ihr Ton liegt auf den Tonspuren). */
  source(c) {
    if (c.type === 'take') return c.take.audio;
    if (c.type === 'music') return this.music;
    if (c.type === 'orig' || c.type === 'snip') return this.voice;
    return null;
  }
  mix(t0 = 0, t1 = this.tl.end()) { return mix(this.tl.clips, this.tl.tracks, c => this.source(c), t0, t1); }

  audio() {
    this.ctx ??= new AudioContext({ sampleRate: SR });
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /**
   * Abspielen ab `from`. Gemischt wird in Stücken von 4 s, jedes Stück startet
   * sampelgenau hinter dem vorigen – so beginnt das Abspielen sofort, auch bei
   * langen Projekten, und Änderungen während des Abspielens kosten wenig.
   */
  play(from = this.tl.playhead, { until = null } = {}) {
    this.stop();
    this.until = until;
    const end = until ?? this.tl.end();
    if (from >= end - 0.05) from = 0;
    const ctx = this.audio(), CH = 4 * SR;
    const F = Math.round(from * SR), E = Math.round(end * SR);
    const t0 = ctx.currentTime + 0.05;
    this.nodes = [];
    this.playing = true;
    let k = 0;
    const schedule = () => {
      if (!this.playing) return;
      const a = F + k * CH, b = Math.min(E, a + CH);
      const data = this.mix(a / SR, b / SR);
      const buf = ctx.createBuffer(1, Math.max(1, data.length), SR);
      buf.copyToChannel(data, 0);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      const at = t0 + (a - F) / SR;
      node.start(Math.max(at, ctx.currentTime));
      this.nodes.push(node);
      k++;
      if (b < E) this.timer = setTimeout(schedule, Math.max(0, (at - ctx.currentTime) * 1000 + 1500));
      else node.onended = () => { if (this.nodes.includes(node)) this.stop(true); };
    };
    schedule();
    this.node = this.nodes[0];
    // Was gerade aus dem Lautsprecher kommt, nicht was gerade berechnet wird:
    // Ausgabe-Zeitstempel (oder wenigstens die Ausgabelatenz) einrechnen.
    this.clock = () => {
      let now = ctx.currentTime - (ctx.outputLatency || 0);
      const ts = ctx.getOutputTimestamp?.();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) now = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      return from + Math.max(0, now - t0);
    };
    this.dispatchEvent(new Event('state'));
    const tick = () => {
      if (!this.playing) return;
      const t = this.clock();
      this.tl.setPlayhead(t, { follow: true });
      this.sync(t, true);
      this.draw(t);
      this.dispatchEvent(new CustomEvent('time', { detail: t }));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(ended = false) {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    for (const n of this.nodes ?? []) { try { n.stop(); } catch { /* schon zu Ende */ } }
    this.nodes = []; this.node = null;
    if (this.snippet) { try { this.snippet.stop(); } catch { /* */ } this.snippet = null; }
    const was = this.playing;
    this.playing = false;
    for (const p of this.pool) p.v.pause();
    if (was) this.dispatchEvent(new CustomEvent('state', { detail: { ended } }));
  }

  toggle() { if (this.playing) this.stop(); else this.play(); }

  /** Sichtbare Video-Clips zur Zeit t, von unten nach oben (Bildspuren: oben in der Liste = vorn). */
  visible(t) {
    const tracks = this.tl.tracks.filter(tr => tr.kind === 'video' && !tr.muted).reverse();
    const out = [];
    for (const tr of tracks) {
      const cs = this.tl.clips.filter(c => c.track === tr.id && !c.muted && t >= reach(c)[0] && t < reach(c)[1]).sort((a, b) => a.at - b.at);
      for (const c of cs) {
        // Überblendung: der frühere Clip bleibt voll, der spätere blendet über ihn
        const crossOut = (c.extOut ?? 0) > 0 && t >= endOf(c) - (c.fadeOut - c.extOut);
        const a = crossOut ? 1 : envelopeLinear(c, t);
        if (a > 0.003) out.push({ c, a });
      }
    }
    return out;
  }

  /**
   * Videoelemente den sichtbaren Clips zuordnen und an die Zeit t führen.
   * Ein Clip bekommt bevorzugt das Element, das schon an seiner Quellstelle steht –
   * so laufen geteilte Clips nahtlos weiter, ohne neu zu suchen. Beim Abspielen
   * werden Clips, die gleich beginnen, vorab an ihren Anfang gesetzt.
   */
  sync(t, running = false) {
    const vis = this.visible(t).slice(-POOL);
    const want = new Set(vis.map(x => x.c.id));
    for (const p of this.pool) if (p.clip && !want.has(p.clip)) { p.clip = null; if (!running) p.v.pause(); }
    for (const { c } of vis) {
      const L = this.locate(sourceAt(c, t));
      let p = this.pool.find(q => q.clip === c.id);
      if (p && p.k !== L.k) { p.clip = null; p = null; }
      if (!this.has(L.k)) continue;                  // Datei dieser Aufnahme nicht geladen
      if (!p) {
        const free = this.pool.filter(q => !q.clip);
        if (!free.length) continue;
        const same = free.filter(q => q.k === L.k), cand = same.length ? same : free;
        p = cand.reduce((a, q) => (Math.abs(q.v.currentTime - L.t) < Math.abs(a.v.currentTime - L.t) ? q : a));
        if (p.k !== L.k) this.load(p, L.k);
        p.clip = c.id;
      }
      const v = p.v, s = L.t, sp = speedOf(c);
      if (running && !c.reverse) {
        if (Math.abs(v.playbackRate - sp) > 1e-3) v.playbackRate = sp;
        if (v.paused) { if (Math.abs(v.currentTime - s) > 0.05) v.currentTime = s; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - s) > 0.15 * Math.max(1, sp) && !v.seeking) v.currentTime = s;
      } else {
        if (!v.paused) v.pause();
        // rückwärts und beim Scrubben: erst weitersuchen, wenn die letzte Suche fertig ist
        if (!v.seeking && Math.abs(v.currentTime - s) > (running ? 0.04 : 0.01)) v.currentTime = s;
      }
    }
    // Was gleich kommt, schon einmal hinstellen (nur mit freien Elementen)
    if (running) {
      for (const c of this.upcoming(t, 0.6)) {
        const { k, t: s } = this.locate(sourceAt(c, c.at));
        if (!this.has(k) || this.pool.some(q => q.k === k && Math.abs(q.v.currentTime - s) < 0.05)) continue;
        const q = this.pool.find(x => !x.clip && x.k === k && x.v.paused && !x.v.seeking);
        if (!q) break;
        q.v.currentTime = s;
      }
    }
    this.badge.hidden = !vis.some(x => x.c.type === 'lips');
    if (!running) this.draw(t);
  }

  /** Video-Clips, die in den nächsten `ahead` Sekunden beginnen. */
  upcoming(t, ahead) {
    const vids = new Set(this.tl.tracks.filter(tr => tr.kind === 'video' && !tr.muted).map(tr => tr.id));
    return this.tl.clips.filter(c => vids.has(c.track) && !c.muted && reach(c)[0] > t && reach(c)[0] <= t + ahead);
  }

  /**
   * Zeichnen. Ein Element, das gerade sucht oder noch kein Bild hat, liefert in
   * manchen Browsern Schwarz – dann gilt sein letztes gutes Bild (kein Flackern).
   */
  draw(t) {
    const { g, canvas: cv } = this;
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, cv.width, cv.height);
    for (const { c, a } of this.visible(t)) {
      const p = this.pool.find(q => q.clip === c.id);
      if (!p) continue;
      const fresh = p.v.readyState >= 2 && !p.v.seeking;
      if (fresh && p.shot !== p.v.currentTime) this.capture(p);
      const img = fresh ? p.v : p.snap ?? this.lastFrame(c);
      if (!img) continue;
      g.globalAlpha = a;
      g.drawImage(img, 0, 0, cv.width, cv.height);
    }
    g.globalAlpha = 1;
  }

  /** Aktuelles Bild eines Elements festhalten. */
  capture(p) {
    if (p.v.readyState < 2) return;
    const cv = this.canvas;
    p.snap ??= document.createElement('canvas');
    if (p.snap.width !== cv.width || p.snap.height !== cv.height) { p.snap.width = cv.width; p.snap.height = cv.height; }
    p.snap.getContext('2d').drawImage(p.v, 0, 0, cv.width, cv.height);
    p.shot = p.v.currentTime;
  }

  /** Ersatzbild, solange ein Element noch sucht: das Bild eines anderen Elements an fast derselben Stelle. */
  lastFrame(c) {
    const { k, t: s } = this.locate(sourceAt(c, this.tl.playhead));
    const q = this.pool.filter(x => x.k === k && x.snap && x.shot != null).sort((x, y) => Math.abs(x.shot - s) - Math.abs(y.shot - s))[0];
    return q && Math.abs(q.shot - s) < 0.5 ? q.snap : null;
  }

  /** Ein Stück Ton allein anhören (Vorschläge, Fundstücke). */
  listen(data, from = 0, to = data.length / SR) {
    this.stop();
    const ctx = this.audio();
    const a = Math.max(0, Math.round(from * SR)), b = Math.min(data.length, Math.round(to * SR));
    const seg = data.slice(a, b), F = Math.round(0.004 * SR);
    for (let i = 0; i < Math.min(F, seg.length); i++) { seg[i] *= i / F; seg[seg.length - 1 - i] *= i / F; }
    const buf = ctx.createBuffer(1, Math.max(1, seg.length), SR);
    buf.copyToChannel(seg, 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    node.start();
    this.snippet = node;
    return new Promise(r => { node.onended = r; });
  }

  // ------------------------------------------------------------ Ausgabe
  /** Bild für Bild: jedes Video genau an seine Stelle setzen, abwarten, zeichnen. */
  async frameAt(t) {
    this.sync(t);
    const waits = [];
    for (const { c } of this.visible(t)) {
      const p = this.pool.find(q => q.clip === c.id);
      if (!p) continue;
      const s = this.locate(sourceAt(c, t)).t;
      if (p.v.seeking || Math.abs(p.v.currentTime - s) > 1e-3) {
        if (!p.v.seeking) p.v.currentTime = s;
        waits.push(new Promise(r => { const done = () => { p.v.removeEventListener('seeked', done); r(); }; p.v.addEventListener('seeked', done); setTimeout(done, 3000); }));
      }
      if (p.v.readyState < 2) waits.push(new Promise(r => { p.v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 3000); }));
    }
    await Promise.all(waits);
    this.draw(t);
  }

  /**
   * Video ausgeben. Mit WebCodecs als MP4, Bild für Bild genau (auch Rückwärts und
   * Tempo); ohne WebCodecs als Echtzeit-Aufnahme. Liefert {blob, ext}.
   */
  async render(onProgress, signal, span = {}) {
    this.stop();
    const t0 = span.t0 ?? 0, t1 = span.t1 ?? this.tl.end();
    this.mark = span.watermark ? await watermark() : null;
    if (window.VideoEncoder && window.AudioEncoder) {
      try { return await this.renderMp4(onProgress, signal, t0, t1); } catch (err) { if (signal?.aborted) throw err; console.warn('WebCodecs:', err); }
    }
    return this.record(onProgress, signal, t0, t1);
  }

  /** Dezentes „Made with Slinky-Cut“ unten rechts ins aktuelle Bild (nur beim Ausgeben). */
  stamp() {
    if (!this.mark) return;
    const g = this.canvas.getContext('2d'), W = this.canvas.width, H = this.canvas.height;
    const fs = Math.max(11, Math.round(H * 0.028)), pad = Math.round(H * 0.03), logo = Math.round(fs * 1.35);
    g.save();
    g.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textBaseline = 'middle';
    const text = 'Made with Slinky-Cut', tw = g.measureText(text).width;
    const y = H - pad - logo / 2, x = W - pad - tw;
    g.globalAlpha = 0.7;
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = Math.round(fs * 0.4);
    g.fillStyle = '#fff';
    g.fillText(text, x, y);
    if (this.mark.img) g.drawImage(this.mark.img, x - logo - Math.round(fs * 0.35), y - logo / 2, logo, logo);
    g.restore();
  }

  /** Bereich [from, to) der Zeitleiste als MP4; die Datei beginnt bei 0. */
  async renderMp4(onProgress, signal, from, to) {
    const { Muxer, ArrayBufferTarget } = await import(MUXER);
    const W = this.canvas.width, H = this.canvas.height, FPS = 30, end = to - from;
    // Constrained Baseline zuerst (keine B-Frames, die der MP4-Muxer nicht abbildet – in
    // Firefox gab es sonst Klötzchen), Stufe nach Bildgröße; Echtzeit-Modus und Software-
    // Kodierer, wo möglich: die sind verlässlicher als manche Hardware-Kodierer.
    const level = W * H > 1280 * 720 ? '28' : '1f';
    const avc = [['avc', `avc1.42e0${level}`], ['avc', `avc1.4d00${level === '28' ? '28' : '1f'}`]], vp9 = [['vp9', 'vp09.00.31.08']];
    // Firefox (OpenH264) beginnt mit jedem Schlüsselbild einen neuen Parametersatz, den die
    // MP4-Kopfdaten nicht kennen: Abspieler zeigen danach Klötzchen (gemessen, Firefox 159).
    // Sein VP9 ist sauber und schärfer – dort also VP9 im MP4.
    const vcands = isFirefox() ? [...vp9, ...avc] : [...avc, ...vp9];
    let vc = null;
    search: for (const [kind, codec] of vcands) {
      for (const extra of kind === 'vp9' ? [{}] : [{ hardwareAcceleration: 'prefer-software', latencyMode: 'realtime' }, { latencyMode: 'realtime' }, {}]) {
        const cfg = { codec, width: W, height: H, bitrate: 6e6, framerate: FPS, ...extra, ...(kind === 'avc' ? { avc: { format: 'avc' } } : {}) };
        try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { vc = { kind, cfg }; break search; } } catch { /* nächste */ }
      }
    }
    let ac = null;
    for (const [kind, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
      const cfg = { codec, sampleRate: SR, numberOfChannels: 1, bitrate: 160000 };
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) { ac = { kind, cfg }; break; }
    }
    if (!vc || !ac) throw new Error('no suitable encoder');
    console.info('Slinky-Cut export:', vc.cfg.codec, vc.cfg, ac.cfg.codec);
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: vc.kind, width: W, height: H }, audio: { codec: ac.kind, sampleRate: SR, numberOfChannels: 1 } });
    let fail = null;
    const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => { fail = e; } });
    venc.configure(vc.cfg);
    const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: e => { fail = e; } });
    aenc.configure(ac.cfg);

    // Ton zuerst (schnell), dann Bild für Bild
    const pcm = this.mix(from, to), N = 1024;
    for (let i = 0; i < pcm.length; i += N) {
      const part = pcm.subarray(i, Math.min(pcm.length, i + N));
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round(i / SR * 1e6), data: part });
      aenc.encode(ad); ad.close();
    }
    const frames = Math.ceil(end * FPS);
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (fail) throw fail;
      const t = i / FPS;
      this.tl.setPlayhead(from + t);
      await this.frameAt(from + t);
      this.stamp();
      const vf = new VideoFrame(this.canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: i % FPS === 0 });
      vf.close();
      while (venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 5));
      onProgress?.((i + 1) / frames);
    }
    await venc.flush(); await aenc.flush();
    if (fail) throw fail;
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
  }

  /** Ersatzweg ohne WebCodecs: einmal in Echtzeit abspielen und aufnehmen. */
  async record(onProgress, signal, from, to) {
    const end = to - from, ctx = this.audio(), dest = ctx.createMediaStreamDestination();
    const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const types = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find(t => window.MediaRecorder?.isTypeSupported(t));
    if (!mimeType) throw new Error('This browser cannot record video.');
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6e6 });
    const parts = [];
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    const stopped = new Promise(r => { rec.onstop = r; });
    await this.frameAt(from);
    const data = this.mix(from, to), buf = ctx.createBuffer(1, Math.max(1, data.length), SR);
    buf.copyToChannel(data, 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(dest);
    rec.start(500);
    const t0 = ctx.currentTime + 0.05;
    node.start(t0);
    this.playing = true;
    await new Promise(resolve => {
      const loop = () => {
        const t = Math.max(0, ctx.currentTime - t0);
        if (t >= end || signal?.aborted) { this.playing = false; resolve(); return; }
        this.sync(from + t, true); this.draw(from + t); this.stamp();
        onProgress?.(t / end);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    try { node.stop(); } catch { /* */ }
    rec.stop();
    await stopped;
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    return { blob: new Blob(parts, { type: mimeType.split(';')[0] }), ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }
}

/** Logo fürs Wasserzeichen (einmal geladen). */
let markImg = null;
function watermark() {
  markImg ??= new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL('./favicon.svg', import.meta.url).href;
  });
  return markImg.then(img => ({ img }));
}

/** Wie envelope, aber linear – fürs Bild (Abblenden wirkt linear natürlicher). */
function envelopeLinear(c, t) {
  const [a, b] = reach(c);
  if (t < a || t >= b) return 0;
  let g = 1;
  const fi = c.fadeIn ?? 0, fo = c.fadeOut ?? 0;
  if (fi > 0 && t < a + fi) g *= (t - a) / fi;
  if (fo > 0 && t > b - fo) g *= (b - t) / fo;
  return g;
}
