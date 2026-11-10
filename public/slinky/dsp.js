// Kleine Signalverarbeitung ohne Abhängigkeiten: FFT, MFCC, Energie, F0 (YIN).
// Läuft genauso im Browser.

export function fftReal(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function melFilters(nfft, sr, nMel, fmin = 60, fmax = 7600) {
  const mel = f => 2595 * Math.log10(1 + f / 700), inv = m => 700 * (10 ** (m / 2595) - 1);
  const pts = Array.from({ length: nMel + 2 }, (_, i) => inv(mel(fmin) + (mel(fmax) - mel(fmin)) * i / (nMel + 1)));
  const bins = pts.map(f => f / sr * nfft);
  return Array.from({ length: nMel }, (_, m) => {
    const w = new Float32Array(nfft / 2 + 1);
    for (let k = 0; k <= nfft / 2; k++) {
      if (k > bins[m] && k <= bins[m + 1]) w[k] = (k - bins[m]) / (bins[m + 1] - bins[m]);
      else if (k > bins[m + 1] && k < bins[m + 2]) w[k] = (bins[m + 2] - k) / (bins[m + 2] - bins[m + 1]);
    }
    return w;
  });
}

/**
 * MFCC (13, ohne c0) und Log-Energie, Hop `hop` Samples, Fenster 25 ms.
 * Rückgabe: { mfcc: Float32Array(frames*13), energy: Float32Array(frames), frames }
 */
export function mfcc(audio, sr = 16000, hop = 80) {
  const win = Math.round(0.025 * sr), nfft = 512, nMel = 32, nC = 13;
  const filters = melFilters(nfft, sr, nMel);
  const hann = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (win - 1)));
  // Frame f ist um f·hop zentriert (nicht dort begonnen): sonst liegen alle
  // Grenzen ein halbes Fenster (12,5 ms) zu früh.
  const half = win >> 1, frames = Math.floor(audio.length / hop);
  const out = new Float32Array(frames * nC), energy = new Float32Array(frames);
  const re = new Float64Array(nfft), im = new Float64Array(nfft), logmel = new Float64Array(nMel);
  const dct = Array.from({ length: nC }, (_, c) => Float64Array.from({ length: nMel }, (_, m) => Math.cos(Math.PI * (c + 1) * (m + 0.5) / nMel)));
  for (let f = 0; f < frames; f++) {
    re.fill(0); im.fill(0);
    let e = 0;
    for (let i = 0; i < win; i++) { const x = audio[f * hop + i - half] ?? 0; e += x * x; re[i] = x * hann[i]; }
    energy[f] = 10 * Math.log10(e / win + 1e-10);
    fftReal(re, im);
    for (let m = 0; m < nMel; m++) {
      let s = 0; const w = filters[m];
      for (let k = 0; k <= nfft / 2; k++) if (w[k]) s += w[k] * (re[k] * re[k] + im[k] * im[k]);
      logmel[m] = Math.log(s + 1e-10);
    }
    for (let c = 0; c < nC; c++) { let s = 0; for (let m = 0; m < nMel; m++) s += dct[c][m] * logmel[m]; out[f * nC + c] = s; }
  }
  return { mfcc: out, energy, frames, hop, sr, nC };
}

/** YIN-Grundfrequenz an einer Stelle; 0 = stimmlos. */
export function f0At(audio, center, sr = 16000, fmin = 65, fmax = 400) {
  const W = Math.round(0.03 * sr), maxLag = Math.round(sr / fmin), minLag = Math.round(sr / fmax);
  const start = Math.round(center - (W + maxLag) / 2);
  if (start < 0 || start + W + maxLag >= audio.length) return 0;
  const d = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = audio[start + i] - audio[start + i + lag]; s += x * x; }
    d[lag] = s;
  }
  let run = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    run += d[lag];
    const cmnd = d[lag] * lag / (run || 1);
    if (lag >= minLag && cmnd < 0.15) {
      // lokales Minimum suchen
      let l = lag;
      while (l + 1 <= maxLag && d[l + 1] * (l + 1) / (run + d[l + 1]) < d[l] * l / run) { l++; run += d[l]; }
      return sr / l;
    }
  }
  return 0;
}
