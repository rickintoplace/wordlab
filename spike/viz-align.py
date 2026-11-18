"""Spektrogramm eines Quellausschnitts mit Laut- und Wortgrenzen.
   python3 viz-align.py media/terra 9.3 13 out.png"""
import json, sys
import numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
d, t0, t1, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
ph = json.load(open(f'{d}/phones.json')); SR = 16000
a = np.memmap(f'{d}/a16.f32', dtype='<f4', mode='r')[int(t0*SR):int(t1*SR)]
fig, (ax0, ax1) = plt.subplots(2, 1, figsize=(max(10, (t1-t0)*5), 6), sharex=True, gridspec_kw={'height_ratios': [1, 3]})
t = t0 + np.arange(len(a))/SR
ax0.plot(t, a, lw=.4, color='k')
ax1.specgram(a, NFFT=400, Fs=SR, noverlap=320, cmap='magma', xextent=(t0, t1), vmin=-130)
ax1.set_ylim(0, 8000)
for p in ph['phones']:
    if p['e'] < t0 or p['s'] > t1: continue
    for ax in (ax0, ax1): ax.axvline(p['s'], color='c', lw=.6)
    ax1.text((p['s']+p['e'])/2, 7500, p['t'], color='w', ha='center', fontsize=9)
for w in ph['words']:
    if 'as' not in w or w['ae'] < t0 or w['as'] > t1: continue
    for ax in (ax0, ax1): ax.axvline(w['as'], color='lime', lw=1.4)
    ax0.text(w['as'], ax0.get_ylim()[1]*.8, w['w'], color='g', fontsize=10)
    ax0.axvspan(w['s'], w['e'], ymin=0, ymax=.08, color='orange', alpha=.7)
plt.tight_layout(); plt.savefig(out, dpi=80)
