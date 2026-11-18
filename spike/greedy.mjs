// Greedy-CTC-Dekodierung zum Gegenlesen: was hört das Phonemmodell?
import { readFileSync } from 'node:fs';
const [bin, from = 0, to = 15] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(bin.replace(/\.bin$/, '.json')));
const b = readFileSync(bin); const P = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
let prev = -1, line = '';
for (let f = Math.round(from * 50); f < Math.min(meta.frames, to * 50); f++) {
  let best = 0; for (let v = 1; v < meta.V; v++) if (P[f * meta.V + v] > P[f * meta.V + best]) best = v;
  if (best !== prev && best !== 0) line += ` ${meta.vocab[best]}@${(f / 50).toFixed(2)}`;
  prev = best;
}
console.log(line);
