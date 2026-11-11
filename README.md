# wordlab

Small tools for word play that work on **sounds**, not letters.

- **[Misheard](https://wordlab.rickinto.place/misheard)** takes a phrase and
  finds other ways to cut the same sounds into words: *kiss the sky* → *kiss
  this guy*, *recognize speech* → *wreck a nice beach*, *four candles* → *fork
  handles*.
- **[Spoonerize](https://wordlab.rickinto.place/spoonerize)** swaps the first
  sounds of two words and keeps the swap only if both results are real words,
  by default only if both lines are things people actually say: *light rain* →
  *right lane*, *magic tricks* → *tragic mix*.

- **[Slinky-Cut](https://wordlab.rickinto.place/slinky-cut)** makes the person in
  a video say something new, cut from their own words, syllables and sounds
  (sentence mixing, as in YouTube Poop), in English and German.

All of them run entirely in the browser. It's a static site: HTML, CSS, ES
modules and a few text files. There's no server and no tracking. Slinky-Cut
downloads its AI models (about 650 MB) into the browser on first use; its
optional “Ideas” feature calls a language model through your own OpenRouter key.

## How Misheard works

1. Every word is looked up in the [CMU Pronouncing Dictionary][cmudict]. Inside
   a phrase, articles and prepositions use their weak forms (*an* is /ən/, not
   /æn/), because that's how they're spoken.
2. The phrase becomes one chain of phonemes with the word boundaries removed.
3. A beam search cuts the chain back into words from a 43,000-word vocabulary.
4. Exact re-cuts are rare, so single sounds may change for a price. The prices
   start from a feature model (place, manner, voicing) based on Miller & Nicely
   (1955) and mostly depend on the neighbouring sounds:
   - word-final stops barely carry voicing (*heard* / *hurt*)
   - a consonant cluster is voiced or voiceless as a unit (*used ink* /
     *you stink*)
   - a doubled consonant at a word boundary sounds like one long consonant
     (*mistake* / *miss steak*, *some others* / *some mothers*)
   - a stop before a nasal loses its release (*recognize* → *reco'nize*)
   - a stop between two consonants tends to disappear (*mints* / *mince*)
5. Readings are ranked by sound cost, word frequency, how many boundaries moved,
   and **word pairs**: how much more often the second word follows the first in
   40 million lines of film subtitles than it would by chance. Sound alone can't
   tell *wreck a nice beach* from *reckon eyes beach*. Word pairs can.

The ranking is tuned against a list of 42 known oronyms and mondegreens
(`npm run tune`): 38 appear in the top 12, 25 of them in first place. What still
fails: long sentences (the right reading gets lost among too many possible
cuts), and proper names, because names are filtered out of the output
vocabulary, so *euthanasia* can't become *youth in Asia*.

A short phrase takes about 10 ms. A nine-word sentence at the default
tolerance takes about 90 ms.

## How Spoonerize works

Every word is split into an **onset** (the consonants before the first vowel)
and a **rime** (the rest). A spoonerism is four words in a grid:

```
light rain       A = a + R1     C = b + R2
right lane       B = b + R1     D = a + R2
```

The swap works exactly when both rimes accept both onsets. With two lookup
tables (*rime → onset → words* and *onset → rimes*), generating one takes about
0.1 ms. The vocabulary allows 2.2 million spoonerisms (`npm run census`).
Almost none of them are funny, because *hero zoo* → *zero who* is four real
words but nothing anyone says.

So the default mode draws from a precomputed list instead. Starting from every
word pair that occurs in the subtitles, it swaps the onsets and checks whether
the other line occurs too. 3,891 do. The 539 with the strongest evidence (both
lines frequent and more common than chance) are in `public/data/phrases.txt`.
Untick "Only pairs people actually say" to roll freely.

The dictionary needs cleaning first. It contains about 31,000 names (filtered
with Hunspell: a word that is only correct when capitalised is dropped),
abbreviations that are pronounced like words (`st` as /stɹit/), and a long tail
of rare words, which the "how common" slider cuts at a frequency rank. A
four-step rudeness slider uses a curated profanity list. Slurs and terms around
sexual violence never get into the data (`build/blocked.mjs`).

## How Slinky-Cut works

Everything runs in the browser, one heavy model at a time in its own worker
(`public/slinky/stages.js`), and the result is cached in IndexedDB:

1. **Separate** voice and music (HT-Demucs, ONNX), so the music stays one
   clean, continuous track.
2. **Transcribe** with Whisper small (word timestamps, language detection) and
   **tell voices apart** with WeSpeaker embeddings.
3. **Hear every sound** with a phoneme recognizer (wav2vec2-xlsr-53-espeak) and
   **place each sound in time** by forced alignment against our own lexicons
   (`public/data/slinky/`, built by `npm run slinky:data`).
4. **Cut** (`engine.js`): unit selection over half-phones — whole words first,
   then syllables, then single sounds — scored by context, word position,
   phrase-final intonation, stress, loudness and spectral fit at each join;
   rendered with waveform-aligned crossfades and room tone in pauses.

The editor (`timeline.js`, `player.js`, `project.js`) has tracks for video,
lip-sync snippets, voice and music; clips can be moved, trimmed, split, faded,
crossfaded (X), reversed and sped up, and every word or syllable can be swapped
for alternatives or retyped. L puts the matching mouth from the video on the Lips track. I and O mark a range in the ruler; export then
offers just that range. “+ Audio” / “+ Video” bring back the original voice,
music or video on a track.

“Save project” writes a `.slinky` file (`projfile.js`): tracks, clips and
sentences with their sound, optionally with the whole analysis so another
computer can skip it. Load the same video there, then “Open project”.
“Add source” appends another recording of the same speaker (e.g. another
episode): it is analysed the same way, its voices are matched to the known ones
by voice embedding (you confirm), and from then on cuts can use its words and
sounds; its picture plays where its pieces are used.

“Ideas” (`ideas.js`) asks a language model for lines made mostly of words the
speaker actually says, with at most two words that have to be built from their
syllables. Every line is cut, and only the funniest whose built words still fit
together (low join cost) are kept. “AI rewrite” on selected voice clips does the
same for just that passage and replaces it with the version you pick.

### Scripting it

With a video analysed, `window.slinkyCut` lets scripts and browser agents edit:

```js
const t = slinkyCut.transcript();                     // [{w, s, e, spk}]
const { id, words } = await slinkyCut.cut('Die Wahrheit ist neu.');
const alts = await slinkyCut.alternatives(id, 1);     // word 1; add a syllable index for one syllable
slinkyCut.choose(alts.findIndex(a => !a.current));
await slinkyCut.rewrite(id, 3, 'rätselhaft');         // retype word 3
slinkyCut.place(id, 12.5);                            // onto the voice track at 12.5 s
slinkyCut.play(10, 20);
const wav = slinkyCut.wav();                          // whole mix as a WAV blob (or wav(t0, t1))
await slinkyCut.ideas('a cooking show');              // needs the OpenRouter key in the Ideas box
```

UI test without models (feeds a prepared analysis into the browser, with a
memory guard): `SLINKY_DEV_DIR=<data> npm run dev`, then
`node tools/ui-slinky.mjs <video> <script.mjs>`.

## Running it

```sh
npm install
npm run dev            # http://localhost:5173
```

The data files in `public/data/` are checked in. To rebuild them:

```sh
npm run data           # CMU dict + frequencies + filters -> words.txt, vulgar.txt
npm run bigrams:count  # streams 40M lines of OpenSubtitles (3.6 GB gzip, a few minutes)
npm run bigrams        # -> bigrams.txt (Misheard); rerun after every `npm run data`
npm run phrases        # -> phrases.txt (Spoonerize)
```

Tools:

```sh
npm run try:misheard -- "recognize speech" --tol 2
npm run tune                     # rank of each known oronym, lower total is better
npm run try -- 20                # 20 random spoonerisms
npm run check                    # generator invariants
npm run census -- --rude 4       # every spoonerism made of four rude words (there are 13)
node tools/confusion-map.mjs     # which consonant Misheard hears as which, by position (12,000 phrases, ~3 min)
node tools/post-figures.mjs      # data for the interactive figures in the blog posts
```

## Data and licenses

Code: MIT. Data in `public/data/`: CC BY-SA 4.0, derived from the
[CMU Pronouncing Dictionary][cmudict] (BSD-2),
[FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0),
[OpenSubtitles2018](https://opus.nlpl.eu/OpenSubtitles/corpus/version/OpenSubtitles)
via OPUS and [vbw](https://github.com/hypernewbie/vbw) (MIT). Details and
notices are in [DATA-LICENSES.md](DATA-LICENSES.md).

[cmudict]: https://github.com/cmusphinx/cmudict
