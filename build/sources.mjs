import fs from 'node:fs';
import path from 'node:path';

export const CACHE = path.join(import.meta.dirname, 'cache');

export const SOURCES = {
  // CMU Pronouncing Dictionary — ~126k Wörter, ARPAbet mit Betonung. Frei (BSD-artig).
  'cmudict.dict': 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict',
  // Worthäufigkeiten aus OpenSubtitles 2018 (hermitdave/FrequencyWords, MIT).
  // Gesprochene Sprache — besserer Natürlichkeitsindikator als Buchkorpora.
  'en_full.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt',
  // Profanitätsliste (hypernewbie/vbw). Wird in build-data.mjs kuratiert:
  // Slurs fliegen ganz raus, harmlose Fehltreffer gelten nicht als derb.
  'profanity.txt': 'https://raw.githubusercontent.com/hypernewbie/vbw/main/profanity-list-main/list/en.txt',
};

export async function ensureSources() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [name, url] of Object.entries(SOURCES)) {
    const dest = path.join(CACHE, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`  ✓ ${name} (bereits vorhanden)`);
      continue;
    }
    process.stdout.write(`  ↓ ${name} … `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
  }
  return CACHE;
}

if (import.meta.filename === process.argv[1]) await ensureSources();
