// Stimmt der blinde Hörer mit dem Ohr überein? Vergleiche aus den Hörtests (besser > schlechter).
//   N=3 node loop/calibrate.mjs      (im Ordner spike)
import { execFileSync } from 'node:child_process';
import { judge, cost } from './judge.mjs';
const read48 = f => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }); return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4); };
const T = ['Der Hase hat eine Nase.', 'Kacke', 'Die Blase platzt.', 'Mein Computer frisst Pizza.'];
const clip = (d, i) => `out/${d}/${i}-${d.split('-')[1]}.wav`;
// Urteile (Nov. 2026): [Satz, besser, schlechter]
const prefs = [[0, 'g-N', 'g2-M'], [0, 'g-N', 'g-C'], [1, 'g2-M', 'g-N'], [1, 'g-C', 'g-N'], [2, 'g-C', 'g2-M'], [2, 'g-C', 'g-N'], [3, 'g2-M', 'g-N'], [3, 'g2-M', 'g-C']];
const n = +(process.env.N ?? 3);
const res = {};
for (const d of ['g-N', 'g2-M', 'g-C']) for (let i = 0; i < 4; i++) {
  const r = await judge(read48(clip(d, i)), T[i], n);
  res[`${d}/${i}`] = r;
  console.log(`${d.padEnd(5)} ${T[i].padEnd(30)} Wörter ${r.words.toFixed(2)} Zeichen ${r.chars.toFixed(2)}  ${r.heard.map(h => `„${h}“`).join(' ')}`);
}
let agreeW = 0, agreeC = 0;
for (const [i, a, b] of prefs) {
  const A = res[`${a}/${i}`], B = res[`${b}/${i}`];
  const w = A.words > B.words ? 1 : A.words === B.words ? 0.5 : 0, c = A.chars > B.chars ? 1 : A.chars === B.chars ? 0.5 : 0;
  agreeW += w; agreeC += c;
  console.log(`${T[i].slice(0, 20).padEnd(20)} ${a} > ${b}: Wörter ${w} Zeichen ${c}`);
}
console.log(`Übereinstimmung mit dem Ohr: Wörter ${agreeW}/${prefs.length}, Zeichen ${agreeC}/${prefs.length} · $${cost.spent.toFixed(4)}`);
