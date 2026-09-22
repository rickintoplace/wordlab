# Data licenses

The code in this repository is MIT-licensed (see `LICENSE`). The files in
`public/data/` are derived from third-party data and carry their licenses:

| File | Derived from | License |
| --- | --- | --- |
| `words.txt`, `lexicon-extra.txt` | CMU Pronouncing Dictionary (pronunciations), FrequencyWords by Hermit Dave (frequency ranks) | CC BY-SA 4.0, see below |
| `vulgar.txt` | hypernewbie/vbw, curated (`build/blocked.mjs`, `build/not-vulgar.mjs`) | MIT (vbw), CC BY-SA 4.0 for this selection |
| `bigrams.txt`, `phrases.txt` | Word-pair counts from 40 million lines of OpenSubtitles2018 (OPUS) | CC BY-SA 4.0 |

Because the frequency ranks come from FrequencyWords, whose content is
licensed CC BY-SA 4.0, the derived data files are released under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) as well.
If you reuse them, credit the sources below and share alike.

Hunspell's English dictionary (`dictionary-en`, MIT/BSD) is only used at build
time to filter out proper names; none of it is redistributed. The icons in
`public/icons.js` are path data from [Lucide](https://lucide.dev) (ISC).

## Sources

- **CMU Pronouncing Dictionary** — https://github.com/cmusphinx/cmudict
- **FrequencyWords** by Hermit Dave — https://github.com/hermitdave/FrequencyWords
  (content CC BY-SA 4.0)
- **OpenSubtitles2018** via OPUS — https://opus.nlpl.eu/OpenSubtitles/corpus/version/OpenSubtitles.
  P. Lison and J. Tiedemann (2016): *OpenSubtitles2016: Extracting Large
  Parallel Corpora from Movie and TV Subtitles.* LREC 2016. Only aggregate
  word-pair counts are distributed, no text.
- **vbw** by Xi Ma Chen — https://github.com/hypernewbie/vbw (MIT)

## CMU Pronouncing Dictionary notice

```
Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
   The contents of this file are deemed to be source code.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

This work was supported in part by funding from the Defense Advanced
Research Projects Agency, the Office of Naval Research and the National
Science Foundation of the United States of America, and by member
companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge
the contributions of many volunteers to the expansion and improvement of
this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND
ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
