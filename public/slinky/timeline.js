// Slinky-Cut: Zeitleiste wie in einem Schnittprogramm. Beliebig viele Bild- und
// Tonspuren; Clips verschieben (auch auf andere Spuren), trimmen, blenden,
// mehrere auswählen (Klick mit Umschalt/Strg, Rahmen ziehen), mit Rückgängig.
// Die Rechnungen auf den Daten stehen in project.js.

import { KIND, endOf, speedOf, sourceAt, timeOf, sub, clearRange, splitAt, defaultTracks } from './project.js';

const EDGE = 7, SNAP = 8, MIN_LEN = 0.02, ROW = 58, RULER = 26;

let nextId = 1;
export const newId = () => `c${nextId++}`;
/** Nach dem Laden eines gespeicherten Projekts: neue ids nicht doppelt vergeben. */
export function reserveIds(clips) { for (const c of clips) nextId = Math.max(nextId, Number(String(c.id).slice(1)) + 1 || nextId); }

export class Timeline extends EventTarget {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {(clip)=>Float32Array|null} o.samples   Ton eines Clips (für die Wellenform)
   * @param {(clip)=>number} o.sourceLength          Länge der Quelle eines Clips (Trimm-Grenzen)
   */
  constructor(root, { samples, sourceLength, words = [] }) {
    super();
    Object.assign(this, { root, samples, sourceLength, srcWords: words.map((w, idx) => ({ ...w, idx })).filter(w => w.e > w.s).sort((a, b) => a.s - b.s) });
    this.tracks = defaultTracks();
    this.clips = [];
    this.sel = new Set();
    this.playhead = 0;
    this.pps = 40;                 // Pixel pro Sekunde
    this.history = [];
    this.future = [];
    this.els = new Map();          // id → Element
    this.build();
  }

  // ------------------------------------------------------------ Modell
  snapshot() { return { tracks: this.tracks.map(t => ({ ...t })), clips: this.clips.map(c => ({ ...c })) }; }
  restore(s) { this.tracks = s.tracks; this.clips = s.clips; }
  /** Vor jeder Änderung aufrufen: merkt den Zustand fürs Rückgängigmachen. */
  commit() {
    this.history.push(this.snapshot());
    if (this.history.length > 200) this.history.shift();
    this.future = [];
  }
  changed() {
    // Spuren gleich geblieben: nur die Clips nachziehen (schnell), sonst alles neu
    const sig = this.tracks.map(t => `${t.id}:${t.name}:${t.muted ? 1 : 0}`).join('|');
    if (sig === this.trackSig) this.render(); else this.build(true);
    this.dispatchEvent(new Event('change'));
  }
  undo() { if (!this.history.length) return; this.future.push(this.snapshot()); this.restore(this.history.pop()); this.fixSelection(); this.changed(); }
  redo() { if (!this.future.length) return; this.history.push(this.snapshot()); this.restore(this.future.pop()); this.fixSelection(); this.changed(); }
  fixSelection() { this.setSelection([...this.sel].filter(id => this.get(id))); }

  get(id) { return this.clips.find(c => c.id === id); }
  get selected() { return this.sel.size === 1 ? [...this.sel][0] : null; }
  selection() { return this.clips.filter(c => this.sel.has(c.id)); }
  end() { return this.clips.reduce((m, c) => Math.max(m, endOf(c)), 0); }
  track(id) { return this.tracks.find(t => t.id === id); }
  kindOf(c) { return this.track(c.track)?.kind ?? KIND[c.type]; }
  at(t, trackId) { return this.clips.find(c => c.track === trackId && t >= c.at && t < endOf(c)); }

  clear(track, at, len, except = null) { this.clips = clearRange(this.clips, track, at, len, except, newId); }

  add(clip, { overwrite = true } = {}) {
    const c = { muted: false, speed: 1, gain: 1, ...clip, id: clip.id ?? newId() };
    if (overwrite) this.clear(c.track, c.at, c.len);
    this.clips.push(c);
    return c;
  }

  remove(ids) {
    const set = new Set(ids);
    this.clips = this.clips.filter(c => !set.has(c.id) && !set.has(c.ref));
    for (const id of set) this.sel.delete(id);
  }

  /** Entfernen und die Lücke schließen: Spätere Clips derselben Spuren rücken auf. */
  rippleRemove(ids) {
    const gone = this.clips.filter(c => ids.includes(c.id));
    this.remove(ids);
    for (const g of gone.sort((a, b) => b.at - a.at)) {
      for (const c of this.clips) if (c.track === g.track && c.at >= endOf(g) - 1e-6) c.at -= g.len;
    }
  }

  split(t, ids = null) {
    const out = splitAt(this.clips, t, ids, newId);
    if (out) this.clips = out;
    return !!out;
  }

  /** Clips (als Gruppe) einfügen, frühester Clip ab `at`. Lippen-Schnipsel folgen ihrem Take. */
  paste(group, at) {
    const base = Math.min(...group.map(c => c.at)), idMap = new Map(), added = [];
    for (const c of [...group.filter(c => !c.ref), ...group.filter(c => c.ref)]) {
      const n = { ...c, id: newId(), at: at + (c.at - base) };
      if (c.ref) n.ref = idMap.get(c.ref) ?? null;
      idMap.set(c.id, n.id);
      this.clear(n.track, n.at, n.len);
      this.clips.push(n);
      added.push(n);
    }
    return added;
  }

  addTrack(kind) {
    const n = this.tracks.filter(t => t.kind === kind).length + 1;
    const t = { id: `${kind[0]}${Date.now().toString(36)}`, kind, name: kind === 'video' ? `Video ${n}` : `Audio ${n}` };
    // Bildspuren oben, Tonspuren unten anfügen
    if (kind === 'video') this.tracks.unshift(t); else this.tracks.push(t);
    return t;
  }
  removeTrack(id) { this.tracks = this.tracks.filter(t => t.id !== id); this.clips = this.clips.filter(c => c.track !== id); }

  // ------------------------------------------------------------ Ansicht
  build(keep = false) {
    const scrollLeft = this.scroll?.scrollLeft ?? 0;
    this.root.replaceChildren();
    this.els.clear();
    this.root.classList.add('tl');
    this.root.style.setProperty('--rows', this.tracks.length);
    this.trackSig = this.tracks.map(t => `${t.id}:${t.name}:${t.muted ? 1 : 0}`).join('|');

    const head = document.createElement('div');
    head.className = 'tl-head';
    const corner = document.createElement('div');
    corner.className = 'tl-corner';
    corner.innerHTML = '<button type="button" data-add="video" title="Add a video track">+ Video</button><button type="button" data-add="audio" title="Add an audio track">+ Audio</button>';
    head.append(corner);
    const fixed = new Set(defaultTracks().map(d => d.id));
    for (const t of this.tracks) {
      const n = document.createElement('div');
      n.className = 'tl-name';
      n.dataset.track = t.id;
      n.dataset.kind = t.kind;
      n.classList.toggle('muted', !!t.muted);
      n.innerHTML = `<span class="tl-tname" title="Double-click to rename">${esc(t.name)}</span>
        <button type="button" class="tl-tmute" data-mute="${t.id}" title="${t.kind === 'video' ? 'Hide' : 'Mute'} this track" aria-pressed="${!!t.muted}">${t.kind === 'video' ? 'H' : 'M'}</button>
        ${fixed.has(t.id) ? '' : `<button type="button" class="tl-tdel" data-del="${t.id}" title="Remove this track">×</button>`}`;
      head.append(n);
    }
    head.addEventListener('click', e => this.headClick(e));
    head.addEventListener('dblclick', e => this.rename(e));

    this.scroll = document.createElement('div');
    this.scroll.className = 'tl-scroll';
    this.lane = document.createElement('div');
    this.lane.className = 'tl-lane';
    this.ruler = document.createElement('div');
    this.ruler.className = 'tl-ruler';
    this.lane.append(this.ruler);
    this.rows = new Map();
    for (const t of this.tracks) {
      const row = document.createElement('div');
      row.className = 'tl-track';
      row.dataset.track = t.id;
      row.dataset.kind = t.kind;
      row.classList.toggle('muted', !!t.muted);
      this.rows.set(t.id, row);
      this.lane.append(row);
    }
    this.head = document.createElement('div');
    this.head.className = 'tl-playhead';
    this.box = document.createElement('div');
    this.box.className = 'tl-box';
    this.box.hidden = true;
    this.lane.append(this.head, this.box);
    this.scroll.append(this.lane);
    this.root.append(head, this.scroll);

    this.lane.addEventListener('pointerdown', e => this.pointerDown(e));
    // mittlere Taste: kein Auto-Scroll-Symbol des Browsers, kein Einfügen (Linux)
    this.lane.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    this.lane.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
    this.lane.addEventListener('dblclick', e => {
      if (e.target.closest('.tl-clip')) return;
      this.setPlayhead(this.timeAt(e));
      this.dispatchEvent(new Event('playfrom'));
    });
    this.lane.addEventListener('contextmenu', e => {
      e.preventDefault();
      const el = e.target.closest('.tl-clip');
      if (el && !this.sel.has(el.dataset.id)) this.setSelection([el.dataset.id]);
      this.dispatchEvent(new CustomEvent('menu', { detail: { x: e.clientX, y: e.clientY, t: this.timeAt(e), onClip: !!el } }));
    });
    this.scroll.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = this.scroll.getBoundingClientRect(), x = e.clientX - r.left, t = (this.scroll.scrollLeft + x) / this.pps;
        this.zoom(this.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), t, x);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
        // Mausrad ohne Taste: waagrecht durch die Zeit
        e.preventDefault();
        this.scroll.scrollLeft += e.deltaY;
      }
    }, { passive: false });
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.scroll);
    this.render();
    if (keep) this.scroll.scrollLeft = scrollLeft;
  }

  headClick(e) {
    const add = e.target.closest('[data-add]')?.dataset.add;
    const mute = e.target.closest('[data-mute]')?.dataset.mute;
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (add) { this.commit(); this.addTrack(add); this.changed(); }
    if (mute) { this.commit(); const t = this.track(mute); t.muted = !t.muted; this.changed(); }
    if (del) { this.commit(); this.removeTrack(del); this.fixSelection(); this.changed(); }
  }

  rename(e) {
    const name = e.target.closest('.tl-tname');
    if (!name) return;
    const t = this.track(name.parentElement.dataset.track);
    name.contentEditable = 'true';
    name.focus();
    document.getSelection().selectAllChildren(name);
    name.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); name.blur(); } ev.stopPropagation(); });
    name.addEventListener('blur', () => {
      name.contentEditable = 'false';
      const v = name.textContent.trim();
      if (v && v !== t.name) { this.commit(); t.name = v; this.changed(); }
    }, { once: true });
  }

  /** Zoomen um die Zeit t, die an Bildschirmposition x bleiben soll. */
  zoom(pps, t = this.playhead, x = null) {
    const min = Math.max(2, (this.scroll.clientWidth - 20) / Math.max(1, this.length()));
    if (x == null) x = t * this.pps - this.scroll.scrollLeft;
    this.pps = Math.max(min, Math.min(1500, pps));
    this.render();
    this.scroll.scrollLeft = t * this.pps - x;
    this.dispatchEvent(new Event('zoom'));
  }
  fit() { this.zoom((this.scroll.clientWidth - 20) / Math.max(1, this.length()), 0, 0); }
  length() { return Math.max(this.end(), this.minLength ?? 0) + 2; }

  render() {
    this.lane.style.width = `${this.length() * this.pps}px`;
    this.renderRuler();
    const live = new Set();
    for (const c of this.clips) {
      const row = this.rows.get(c.track);
      if (!row) continue;
      live.add(c.id);
      let el = this.els.get(c.id);
      if (!el || el.parentNode !== row) {
        el?.remove();
        el = document.createElement('div');
        el.className = 'tl-clip';
        el.dataset.id = c.id;
        row.append(el);
        this.els.set(c.id, el);
      }
      this.paintClip(el, c);
    }
    for (const [id, el] of this.els) if (!live.has(id)) { el.remove(); this.els.delete(id); }
    this.setPlayhead(this.playhead);
  }

  paintClip(el, c) {
    el.style.left = `${c.at * this.pps}px`;
    el.style.width = `${Math.max(2, c.len * this.pps)}px`;
    el.dataset.type = c.type;
    el.classList.toggle('muted', !!c.muted);
    el.classList.toggle('selected', this.sel.has(c.id));
    const key = [c.type, c.src, c.len, c.speed, c.reverse, c.fadeIn, c.fadeOut, c.extIn, c.extOut, c.gain, this.pps, c.label, c.take?.rev ?? 0].join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.replaceChildren();
    const data = this.samples(c);
    if (data) el.append(this.wave(c, data));
    if (c.type === 'take') el.append(this.words(c));
    else if ((c.type === 'orig' || c.type === 'snip') && this.srcWords.length) el.append(this.sourceWords(c));
    else {
      const label = document.createElement('span');
      label.className = 'tl-label';
      label.textContent = c.label ?? '';
      el.append(label);
    }
    const tags = [speedOf(c) !== 1 ? `${speedOf(c)}×` : '', c.reverse ? 'reversed' : '', (c.gain ?? 1) !== 1 ? `${(20 * Math.log10(c.gain)).toFixed(0)} dB` : ''].filter(Boolean);
    if (tags.length) el.insertAdjacentHTML('beforeend', `<span class="tl-tags">${tags.join(' · ')}</span>`);
    // Blenden: Kurve, Griffe an den oberen Ecken, Überlappung in den Nachbarn
    const w = Math.max(1, c.len * this.pps);
    const fi = Math.max(0, (c.fadeIn ?? 0) - (c.extIn ?? 0)) * this.pps, fo = Math.max(0, (c.fadeOut ?? 0) - (c.extOut ?? 0)) * this.pps;
    el.insertAdjacentHTML('beforeend', `<svg class="tl-fade" viewBox="0 0 ${w} 100" preserveAspectRatio="none" aria-hidden="true">
      ${fi > 0 ? `<path d="M0 0 L0 100 Q ${fi * 0.45} ${15} ${fi} 0 Z"/>` : ''}
      ${fo > 0 ? `<path d="M${w} 0 L${w} 100 Q ${w - fo * 0.45} ${15} ${w - fo} 0 Z"/>` : ''}</svg>`);
    if ((c.extIn ?? 0) > 0) el.insertAdjacentHTML('beforeend', `<span class="tl-xf in" style="width:${c.extIn * this.pps}px" title="Crossfade"></span>`);
    if ((c.extOut ?? 0) > 0) el.insertAdjacentHTML('beforeend', `<span class="tl-xf out" style="width:${c.extOut * this.pps}px" title="Crossfade"></span>`);
    el.insertAdjacentHTML('beforeend', `<span class="tl-fh in" style="left:${fi}px" title="Drag to fade in"></span><span class="tl-fh out" style="right:${fo}px" title="Drag to fade out"></span>`);
  }

  /** Wörter und Silben eines geschnittenen Satzes, eingefärbt nach Güte. */
  words(c) {
    const box = document.createElement('div');
    box.className = 'tl-words';
    const toX = s => (timeOf(c, s) - c.at) * this.pps;
    c.take.words.forEach((w, wi) => {
      let a = toX(w.start), b = toX(w.end);
      if (a > b) [a, b] = [b, a];
      a = Math.max(0, a); b = Math.min(c.len * this.pps, b);
      if (b - a < 1) return;
      const span = document.createElement('span');
      span.className = `tl-word q ${w.quality}`;
      span.dataset.wi = wi;
      span.style.left = `${a}px`;
      span.style.width = `${b - a}px`;
      span.textContent = w.w;
      span.title = `${w.w}: ${{ whole: 'whole word from the video', syllables: `built from ${w.pieces} pieces`, sounds: `built from ${w.pieces} single sounds` }[w.quality]}. Click a word or syllable for alternatives.`;
      // Silbengrenzen als feine Striche, wenn Platz ist
      if ((w.syls?.length ?? 0) > 1 && b - a > 22 * w.syls.length) {
        for (const s of w.syls.slice(1)) {
          const x = Math.abs(toX(s.start) - (c.reverse ? b : a));
          if (x > 2 && x < b - a - 2) span.insertAdjacentHTML('beforeend', `<i class="tl-syl" style="left:${x}px"></i>`);
        }
      }
      box.append(span);
    });
    return box;
  }

  /** Was in einem Stück Originalstimme gesagt wird, an seiner Stelle im Clip. */
  sourceWords(c) {
    const box = document.createElement('div');
    box.className = 'tl-words tl-src';
    const a = Math.min(sourceAt(c, c.at), sourceAt(c, endOf(c))), b = Math.max(sourceAt(c, c.at), sourceAt(c, endOf(c)));
    // erstes Wort, das in den Bereich reicht (binäre Suche)
    let lo = 0, hi = this.srcWords.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.srcWords[m].e <= a) lo = m + 1; else hi = m; }
    let lastRight = -Infinity, skipped = 0;
    for (let i = lo; i < this.srcWords.length && this.srcWords[i].s < b; i++) {
      const w = this.srcWords[i];
      let x0 = (timeOf(c, Math.max(w.s, a)) - c.at) * this.pps, x1 = (timeOf(c, Math.min(w.e, b)) - c.at) * this.pps;
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (x1 - x0 < 24 || x0 < lastRight) { skipped++; continue; }
      const span = document.createElement('span');
      span.className = 'tl-word';
      span.dataset.si = w.idx;
      span.title = `${w.w}: click to swap this word or a syllable`;
      span.style.left = `${x0}px`;
      span.style.width = `${x1 - x0}px`;
      span.textContent = w.w;
      box.append(span);
      lastRight = x1;
    }
    // Zu eng für einzelne Wörter: dann den Satz als Ganzes zeigen (Klick auf den Clip, dann hineinzoomen)
    if (!box.childElementCount || skipped > box.childElementCount) {
      box.replaceChildren();
      const l = document.createElement('span'); l.className = 'tl-label'; l.textContent = c.label ?? ''; box.append(l);
    }
    return box;
  }

  /** Wellenform eines Clips als Canvas (Spitzenwerte pro Pixelspalte), mit Tempo und Richtung. */
  wave(c, data) {
    const cv = document.createElement('canvas');
    cv.className = 'tl-wave';
    const w = Math.max(1, Math.min(8000, Math.round(c.len * this.pps))), h = 48;
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = getComputedStyle(this.root).getPropertyValue('--wave') || '#888';
    const SR = 48000, cols = [], P = peaks(data), B = 256;
    let peak = 1e-3;
    for (let x = 0; x < w; x++) {
      const s0 = sourceAt(c, c.at + (x / w) * c.len) * SR, s1 = sourceAt(c, c.at + ((x + 1) / w) * c.len) * SR;
      const a = Math.max(0, Math.floor(Math.min(s0, s1))), b = Math.min(data.length, Math.ceil(Math.max(s0, s1)));
      let lo = 0, hi = 0;
      if (b - a >= 2 * B) {
        for (let k = Math.ceil(a / B); k < Math.floor(b / B); k++) { if (P.lo[k] < lo) lo = P.lo[k]; if (P.hi[k] > hi) hi = P.hi[k]; }
      } else for (let i = a; i < b; i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      cols.push([lo, hi]);
      peak = Math.max(peak, hi, -lo);
    }
    peak = Math.min(1, peak * 1.05) / Math.max(0.05, c.gain ?? 1);
    cols.forEach(([lo, hi], x) => {
      const y0 = h / 2 - Math.min(1, hi / peak) * h / 2, y1 = h / 2 - Math.max(-1, lo / peak) * h / 2;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    });
    return cv;
  }

  renderRuler() {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find(s => s * this.pps >= 64) ?? 300;
    const n = Math.ceil(this.length() / step), html = [];
    for (let i = 0; i <= n; i++) html.push(`<span style="left:${i * step * this.pps}px">${clock(i * step, step < 1)}</span>`);
    this.ruler.innerHTML = html.join('');
  }

  setPlayhead(t, { follow = false } = {}) {
    this.playhead = Math.max(0, t);
    this.head.style.transform = `translateX(${this.playhead * this.pps}px)`;
    if (follow) {
      const x = this.playhead * this.pps, l = this.scroll.scrollLeft, w = this.scroll.clientWidth;
      if (x < l || x > l + w - 40) this.scroll.scrollLeft = x - w * 0.2;
    }
  }

  /** Vorschau beim Hineinziehen von außen (Ablage, Suche): wo der Clip landen würde. */
  ghost(spec) {
    this.ghostEl ??= Object.assign(document.createElement('div'), { className: 'tl-ghost' });
    if (!spec) { this.ghostEl.remove(); return; }
    const i = this.tracks.findIndex(t => t.id === spec.track);
    Object.assign(this.ghostEl.style, { left: `${spec.at * this.pps}px`, width: `${spec.len * this.pps}px`, top: `${RULER + i * ROW + 5}px`, height: `${ROW - 10}px` });
    if (this.ghostEl.parentNode !== this.lane) this.lane.append(this.ghostEl);
  }

  setSelection(ids) {
    this.sel = new Set(ids);
    for (const [cid, el] of this.els) el.classList.toggle('selected', this.sel.has(cid));
    this.dispatchEvent(new CustomEvent('select', { detail: this.selection() }));
  }
  select(id) { this.setSelection(id ? [id] : []); }

  // ------------------------------------------------------------ Maus
  timeAt(e) { return (e.clientX - this.lane.getBoundingClientRect().left) / this.pps; }
  rowAt(e) {
    const y = e.clientY - this.lane.getBoundingClientRect().top - RULER;
    return this.tracks[Math.max(0, Math.min(this.tracks.length - 1, Math.floor(y / ROW)))];
  }

  snap(t, ignore) {
    const pts = [0, this.playhead];
    for (const c of this.clips) if (!ignore.has(c.id)) pts.push(c.at, endOf(c));
    let best = t, d = SNAP / this.pps;
    for (const p of pts) if (Math.abs(p - t) < d) { d = Math.abs(p - t); best = p; }
    return best;
  }

  pointerDown(e) {
    if (e.button === 1) { this.pan(e); return; }
    if (e.button !== 0) return;
    const clipEl = e.target.closest('.tl-clip');
    const t0 = this.timeAt(e);
    if (e.target.closest('.tl-ruler')) {
      const scrub = ev => { this.setPlayhead(this.timeAt(ev)); this.dispatchEvent(new Event('seek')); };
      scrub(e);
      this.drag(e, scrub);
      return;
    }
    if (!clipEl) { this.marquee(e, t0); return; }

    const c = this.get(clipEl.dataset.id);
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.shiftKey && !e.altKey) {
      const ids = new Set(this.sel);
      if (ids.has(c.id)) ids.delete(c.id); else ids.add(c.id);
      this.setSelection([...ids]);
      return;
    }
    // Strg: Klick schaltet die Auswahl um, Ziehen verschiebt eine Kopie
    // (Alt-Ziehen ebenso – unter Linux schnappt sich Alt+Ziehen aber oft der Fenstermanager)
    const toggleOnClick = ctrl && !e.altKey, wasSelected = this.sel.has(c.id);
    if (!this.sel.has(c.id)) this.setSelection(ctrl ? [...this.sel, c.id] : [c.id]);

    const fh = e.target.closest('.tl-fh');
    const r = clipEl.getBoundingClientRect(), x = e.clientX - r.left;
    const mode = fh ? (fh.classList.contains('in') ? 'fadein' : 'fadeout')
      : x < EDGE && r.width > 3 * EDGE ? 'left' : x > r.width - EDGE && r.width > 3 * EDGE ? 'right' : 'move';
    const before = this.snapshot();
    const copy = e.altKey || ctrl;                           // Kopie verschieben
    // Gezogen wird die ganze Auswahl (samt Lippen-Schnipseln der Takes)
    const group = mode === 'move' ? this.clips.filter(y => this.sel.has(y.id) || this.sel.has(y.ref)) : [c];
    const orig = new Map(group.map(y => [y.id, { ...y }]));
    const ids = new Set(group.map(y => y.id));
    const srcLen = this.sourceLength(c);
    const row0 = this.rowAt(e);
    let moved = false, last = e;

    const apply = ev => {
      last = ev;
      const dt = this.timeAt(ev) - t0;
      if (!moved && Math.abs(dt * this.pps) < 3 && this.rowAt(ev) === row0) return;
      moved = true;
      const o = orig.get(c.id), sp = speedOf(o);
      if (mode === 'move') {
        // Zeit: am gegriffenen Clip einrasten (Anfang oder Ende)
        let at = this.snap(o.at + dt, ids);
        if (at === o.at + dt) at = this.snap(o.at + o.len + dt, ids) - o.len;
        const minAt = Math.min(...group.map(y => orig.get(y.id).at));
        const shift = Math.max(at - o.at, -minAt);
        // Spur: um gleich viele Spuren derselben Art nach oben/unten
        const kind = this.kindOf(c), same = this.tracks.filter(t => t.kind === kind);
        const di = same.indexOf(this.rowAt(ev)) - same.indexOf(this.track(o.track));
        const canMove = di !== 0 && this.rowAt(ev).kind === kind && group.every(y => {
          const k = same.indexOf(this.track(orig.get(y.id).track)) + di;
          return !!y.ref || (this.kindOf(y) === kind && k >= 0 && k < same.length);
        });
        for (const y of group) {
          const oy = orig.get(y.id);
          y.at = oy.at + shift;
          y.track = canMove && !y.ref ? same[same.indexOf(this.track(oy.track)) + di].id : oy.track;
        }
      } else if (mode === 'left' || mode === 'right') {
        // Quelle reicht so weit, wie das Material da ist (rückwärts: spiegelverkehrt)
        const roomL = (o.reverse ? srcLen - (o.src + o.len * sp) : o.src) / sp;
        const roomR = (o.reverse ? o.src : srcLen - (o.src + o.len * sp)) / sp;
        const full = { ...o, at: o.at - roomL, len: o.len + roomL + roomR, src: o.reverse ? o.src - roomR * sp : o.src - roomL * sp };
        let a = o.at, b = endOf(o);
        if (mode === 'left') a = Math.min(b - MIN_LEN, Math.max(this.snap(o.at + dt, ids), o.at - roomL, 0));
        else b = Math.max(a + MIN_LEN, Math.min(this.snap(b + dt, ids), endOf(o) + roomR));
        Object.assign(c, sub(full, a, b, () => c.id));
        c.fadeIn = mode === 'left' ? Math.min(o.fadeIn ?? 0, c.len / 2) : o.fadeIn; c.extIn = o.extIn;
        c.fadeOut = mode === 'right' ? Math.min(o.fadeOut ?? 0, c.len / 2) : o.fadeOut; c.extOut = o.extOut;
      } else if (mode === 'fadein') {
        c.fadeIn = Math.max(0, Math.min(o.len / 2, (o.fadeIn ?? 0) - (o.extIn ?? 0) + dt)) + (o.extIn ?? 0);
      } else if (mode === 'fadeout') {
        c.fadeOut = Math.max(0, Math.min(o.len / 2, (o.fadeOut ?? 0) - (o.extOut ?? 0) - dt)) + (o.extOut ?? 0);
      }
      this.render();
      this.dispatchEvent(new Event('preview'));
    };

    // Am Rand: die Zeitleiste rollt mit
    let raf = 0;
    const roll = () => {
      const rect = this.scroll.getBoundingClientRect(), px = last.clientX;
      const v = px < rect.left + 40 ? -(rect.left + 40 - px) : px > rect.right - 40 ? px - (rect.right - 40) : 0;
      if (v && moved) { this.scroll.scrollLeft += v * 0.5; apply(last); }
      raf = requestAnimationFrame(roll);
    };
    raf = requestAnimationFrame(roll);

    this.drag(e, apply, () => {
      cancelAnimationFrame(raf);
      if (!moved) {
        if (toggleOnClick) {
          const ids = new Set(this.sel);
          if (wasSelected) ids.delete(c.id); else ids.add(c.id);
          this.setSelection([...ids]);
          return;
        }
        const wordEl = e.target.closest('.tl-word');
        if (wordEl && mode === 'move' && !c.take && wordEl.dataset.si != null) {
          this.dispatchEvent(new CustomEvent('srcword', { detail: { clip: c, si: Number(wordEl.dataset.si), x: e.clientX, y: e.clientY } }));
          return;
        }
        if (wordEl && mode === 'move' && c.take) {
          // erst das ganze Wort; die Silben wählt man im Feld, das sich öffnet
          const wi = Number(wordEl.dataset.wi), si = -1;
          this.dispatchEvent(new CustomEvent('word', { detail: { clip: c, wi, si, x: e.clientX, y: e.clientY } }));
        }
        // nur auswählen: Abspielkopf und Ansicht bleiben, wo sie sind
        return;
      }
      this.history.push(before); this.future = [];
      if (copy) {
        // Originale bleiben an ihrem Platz, an die neue Stelle kommen Kopien
        const moved = group.map(y => ({ ...y }));
        this.clips = this.clips.filter(y => !ids.has(y.id)).concat(group.map(y => ({ ...orig.get(y.id) })));
        const added = this.paste(moved, Math.min(...moved.map(y => y.at)));
        this.setSelection(added.filter(y => !y.ref).map(y => y.id));
      } else {
        // Was die bewegten Clips jetzt überdecken, weicht
        for (const y of group) this.clear(y.track, y.at, y.len, ids);
      }
      this.changed();
    });
  }

  /** Mittlere Maustaste: die Zeitleiste waagrecht schieben. */
  pan(e) {
    e.preventDefault();
    const x0 = e.clientX, l0 = this.scroll.scrollLeft;
    this.lane.classList.add('panning');
    this.drag(e, ev => { this.scroll.scrollLeft = l0 - (ev.clientX - x0); }, () => this.lane.classList.remove('panning'));
  }

  /** Rahmen ziehen: alle berührten Clips auswählen; ohne Ziehen: Abspielkopf setzen. */
  marquee(e, t0) {
    const lr = this.lane.getBoundingClientRect(), x0 = e.clientX - lr.left, y0 = e.clientY - lr.top;
    const add = e.shiftKey || e.ctrlKey || e.metaKey, base = add ? new Set(this.sel) : new Set();
    let moved = false;
    this.drag(e, ev => {
      const x1 = ev.clientX - lr.left, y1 = ev.clientY - lr.top;
      if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      moved = true;
      const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)], [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
      Object.assign(this.box.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
      this.box.hidden = false;
      const ids = new Set(base);
      this.tracks.forEach((tr, i) => {
        const top = RULER + i * ROW;
        if (b < top || t > top + ROW) return;
        for (const c of this.clips) if (c.track === tr.id && c.at * this.pps < r && endOf(c) * this.pps > l) ids.add(c.id);
      });
      this.setSelection([...ids]);
    }, () => {
      this.box.hidden = true;
      if (!moved) { if (!add) this.setSelection([]); this.setPlayhead(t0); this.dispatchEvent(new Event('seek')); }
    });
  }

  drag(e, move, up) {
    const target = this.lane;                     // bleibt stehen, auch wenn Clips neu gezeichnet werden
    target.setPointerCapture?.(e.pointerId);
    const done = ev => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', done);
      target.removeEventListener('pointercancel', done);
      up?.(ev);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', done);
    target.addEventListener('pointercancel', done);
  }
}

/** Spitzenwerte je 256 Samples, einmal pro Tonquelle berechnet. */
const PEAKS = new WeakMap();
function peaks(data) {
  let p = PEAKS.get(data);
  if (p) return p;
  const B = 256, n = Math.ceil(data.length / B), lo = new Float32Array(n), hi = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let a = 0, b = 0;
    for (let i = k * B, e = Math.min(data.length, i + B); i < e; i++) { const v = data[i]; if (v < a) a = v; if (v > b) b = v; }
    lo[k] = a; hi[k] = b;
  }
  p = { lo, hi };
  PEAKS.set(data, p);
  return p;
}

export function clock(t, tenths = true) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${(tenths ? s.toFixed(1) : String(Math.floor(s))).padStart(tenths ? 4 : 2, '0')}`;
}
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
