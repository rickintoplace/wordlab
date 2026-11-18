"""Spektrogramm einer Ausgabe plus Quellkontext jedes Stücks, mit Lautgrenzen.

    python3 viz.py out/dino 1-engine.wav media/dino  → out/dino/1-engine.png
"""
import json, sys, wave
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

out_dir, name, src_dir = sys.argv[1:4]
report = json.load(open(f'{out_dir}/report.json'))
ph = json.load(open(f'{src_dir}/phones.json'))
phones, words = ph['phones'], ph['words']
src = np.memmap(f'{src_dir}/a48.f32', dtype='<f4', mode='r')
SR = 48000

def read_wav(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2') / 32768.0

def spec(ax, x, t0=0.0):
    ax.specgram(x, NFFT=1024, Fs=SR, noverlap=896, cmap='magma', vmin=-130, xextent=(t0, t0 + len(x) / SR))
    ax.set_ylim(0, 8000)
    ax2 = ax.twinx(); ax2.plot(t0 + np.arange(len(x)) / SR, x, lw=.3, color='cyan', alpha=.6); ax2.set_ylim(-1, 1); ax2.set_yticks([])

ver = next(v for t in report for v in t['versions'] if v['file'] == name)
detail = ver.get('detail') or []
y = read_wav(f'{out_dir}/{name}')
fig, axes = plt.subplots(1 + len(detail), 1, figsize=(14, 2.6 * (1 + len(detail))), squeeze=False)
ax = axes[0][0]; spec(ax, y); ax.set_title(f'{name}  ({len(y)/SR:.2f} s)')
pos = 0.0
for d in detail[:-1]:
    pos += d['len']; ax.axvline(pos, color='lime', lw=1)
for k, d in enumerate(detail):
    ax = axes[k + 1][0]
    a, b = d['at'], d['at'] + d['len']
    c0, c1 = a - 0.35, b + 0.35
    spec(ax, np.asarray(src[int(c0 * SR):int(c1 * SR)]), c0)
    ax.axvspan(a, b, color='white', alpha=.18)
    ax.axvline(a, color='lime'); ax.axvline(b, color='red')
    for p in phones:
        if c0 < p['s'] < c1:
            ax.axvline(p['s'], color='white', lw=.4, ls=':')
            ax.text((p['s'] + p['e']) / 2, 7300, p['t'], color='white', ha='center', fontsize=9)
    for w in words:
        if c0 < w['s'] < c1:
            ax.text(w['s'], 400, w['w'], color='yellow', fontsize=8)
    ax.set_title(f"Stück {k+1}: {d['sounds']}  aus „{d['words']}“", fontsize=9)
    ax.set_xlim(c0, c1)
fig.tight_layout()
fig.savefig(f"{out_dir}/{name.replace('.wav', '.png')}", dpi=80)
