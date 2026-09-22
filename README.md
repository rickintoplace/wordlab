# wordlab

Two small tools for English word play that work on **sounds**, not letters.

- **[Misheard](https://wordlab.rickinto.place/misheard)** takes a phrase and
  finds other ways to cut the same sounds into words: *kiss the sky* → *kiss
  this guy*, *recognize speech* → *wreck a nice beach*, *four candles* → *fork
  handles*.
- **[Spoonerize](https://wordlab.rickinto.place/spoonerize)** swaps the first
  sounds of two words and keeps the swap only if both results are real words,
  by default only if both lines are things people actually say: *light rain* →
  *right lane*, *magic tricks* → *tragic mix*.

Both run entirely in the browser. It's a static site: HTML, CSS, ES modules and
a few text files. There's no server, no language model and no tracking.

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

The ranking is tuned against a list of 43 known oronyms and mondegreens
(`npm run tune`): 39 appear in the top 12, 25 of them in first place. What still
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
```

Detailed development notes, in German, are in
[docs/NOTES.de.md](docs/NOTES.de.md).

## Data and licenses

Code: MIT. Data in `public/data/`: CC BY-SA 4.0, derived from the
[CMU Pronouncing Dictionary][cmudict] (BSD-2),
[FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0),
[OpenSubtitles2018](https://opus.nlpl.eu/OpenSubtitles/corpus/version/OpenSubtitles)
via OPUS and [vbw](https://github.com/hypernewbie/vbw) (MIT). Details and
notices are in [DATA-LICENSES.md](DATA-LICENSES.md).

[cmudict]: https://github.com/cmusphinx/cmudict
