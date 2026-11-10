// Aussprache (Graphem → Phonem) für Slinky-Cut, in den Symbolen des
// Phonemmodells. Läuft im Browser und in Node.
//
// 1. Lexikon (Englisch: CMUdict, Deutsch: Wiktionary über WikiPron)
// 2. Deutsch: Komposita aus Lexikonwörtern zerlegen („Dinosaurierpizza“)
// 3. Regeln als Rückfall für alles, was dann noch fehlt
//
// Ergebnis pro Wort: [{ t, stress }], stress 1 = Hauptton, 2 = Nebenton.

import { isVowel } from './phones.js';
export { isVowel };

const lexica = new Map();

/** Lexikon aus dem Textformat „wort\tlaute“ (ˈ/ˌ vor dem betonten Vokal). */
export function parseLexicon(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

export async function loadLexicon(lang, url = `/data/slinky/lex-${lang}.txt`) {
  if (!lexica.has(lang)) lexica.set(lang, fetch(url).then(r => r.text()).then(parseLexicon));
  return lexica.get(lang);
}

export function setLexicon(lang, map) { lexica.set(lang, Promise.resolve(map)); }

const decode = s => s.split(' ').map(x => (x[0] === 'ˈ' ? { t: x.slice(1), stress: 1 } : x[0] === 'ˌ' ? { t: x.slice(1), stress: 2 } : { t: x, stress: 0 }));


// Schwache Formen englischer Funktionswörter (wie in Misheard)
const EN_WEAK = { a: 'ə', an: 'ə n', and: 'ə n d', as: 'ə z', at: 'ə t', for: 'f ɚ', from: 'f ɹ ə m',
  of: 'ə v', than: 'ð ə n', the: 'ð ə', to: 't ə' };

export const clean = (word, lang) => (lang === 'en'
  ? word.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}']/gu, '').replace(/^'+|'+$/g, '')
  : word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));

/**
 * @param {string} word  Wort, wie getippt (Satzzeichen erlaubt)
 * @returns {Promise<{toks: {t:string, stress:number}[], source: 'lexicon'|'compound'|'rules'}>}
 */
export async function pronounce(word, lang) {
  const lex = await loadLexicon(lang);
  return pronounceSync(word, lang, lex);
}

export function pronounceSync(word, lang, lex) {
  const r = pronounceRaw(word, lang, lex);
  return lang === 'de' ? { ...r, toks: vocalizeEr(r.toks) } : r;
}

// „-er“ ohne folgenden Vokal spricht man [ɐ] (Wasser, immer, Jägerin bleibt [ər]):
// Manche Wörterbucheinträge schreiben es als „ə r“, gehört wird es so nie.
function vocalizeEr(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], n = toks[i + 1], nn = toks[i + 2];
    if (t.t === 'ə' && n && /^(r|ʁ|ɾ)$/.test(n.t) && !(nn && isVowel(nn.t))) { out.push({ ...t, t: 'ɐ' }); i++; continue; }
    out.push(t);
  }
  return out;
}

function pronounceRaw(word, lang, lex) {
  const w = clean(word, lang);
  if (!w) return { toks: [], source: 'rules' };
  // Ziffern so, wie man sie spricht: 66 → sechs und sechzig
  if (/^\d{1,9}$/.test(w)) {
    const parts = numberWords(Number(w), lang).map(p => pronounceRaw(p, lang, lex));
    return { toks: parts.flatMap((p, i) => p.toks.map(x => ({ ...x, stress: i === parts.length - 1 ? x.stress : x.stress ? 2 : 0 }))),
      source: parts.every(p => p.source === 'lexicon') ? 'lexicon' : 'compound' };
  }
  if (lang === 'en' && EN_WEAK[w])return { toks: decode(EN_WEAK[w]), source: 'lexicon' };
  if (lex.has(w)) return { toks: decode(lex.get(w)), source: 'lexicon' };
  if (lang === 'de') {
    const parts = splitCompound(w, lex);
    if (parts) {
      const toks = parts.flatMap((p, i) => decode(lex.get(p)).map(x => ({ ...x, stress: i === 0 ? x.stress : x.stress ? 2 : 0 })));
      return { toks, source: 'compound' };
    }
    // Unbetonte Vorsilbe + bekanntes Wort: ge|fangen, ver|laufen, be|kommen
    const m = w.match(DE_PREFIX);
    if (m && w.length - m[1].length >= 3) {
      const rest = w.slice(m[1].length), restParts = lex.has(rest) ? [rest] : splitCompound(rest, lex);
      const pre = decode(DE_PREFIX_TOKS[m[1]]);
      if (restParts) return { toks: [...pre, ...restParts.flatMap((p, i) => decode(lex.get(p)).map(x => ({ ...x, stress: i === 0 ? x.stress : x.stress ? 2 : 0 })))], source: 'compound' };
      if (/^(ge|ver|zer|ent|emp)$/.test(m[1]) && !(m[1] === 'ge' && DE_GE_STEM.test(w))) return { toks: [...pre, ...rulesDe(rest)], source: 'rules' };
    }
    return { toks: rulesDe(w), source: 'rules' };
  }
  return { toks: rulesEn(w), source: 'rules' };
}

const DE_PREFIX = /^(ge|be|ver|zer|ent|emp|er)(?=[^aeiouäöüy]|[aeiouäöü][^aeiouäöüy])/;
const DE_PREFIX_TOKS = { ge: 'ɡ ə', be: 'b ə', ver: 'f ɛ ɾ', zer: 'ts ɛ ɾ', ent: 'ɛ n t', emp: 'ɛ m p', er: 'ɛ ɾ' };
// „ge…“, das keine Vorsilbe ist: geben, gehen, gelb, Geld, gelten, gern, gestern, gegen …
const DE_GE_STEM = /^ge(b|h|l[bdt]|rn|ste|gen|nt|ist)/;

/** Deutsches Kompositum in Lexikonwörter zerlegen (mit Fugen-s/-n/-es/-en). */
function splitCompound(w, lex, depth = 0) {
  if (lex.has(w)) return [w];
  if (depth > 3) return null;
  for (let i = w.length - 3; i >= 3; i--) {
    const head = w.slice(0, i);
    for (const fuge of ['', 's', 'es', 'n', 'en', 'er', 'e']) {
      if (!head.endsWith(fuge)) continue;
      const stem = fuge ? head.slice(0, -fuge.length) : head;
      if (stem.length < 3 || !lex.has(stem)) continue;
      const rest = splitCompound(w.slice(i), lex, depth + 1);
      if (rest) return fuge ? withFuge(stem, fuge, rest, lex) : [head, ...rest];
    }
  }
  return null;
}

// Fugenlaut an den ersten Teil hängen: als eigenes Pseudo-Wort im Lexikon
function withFuge(stem, fuge, rest, lex) {
  const key = `${stem}+${fuge}`;
  if (!lex.has(key)) {
    const add = { s: 's', es: 'ə s', n: 'n', en: 'ə n', er: 'ɜ', e: 'ə' }[fuge];
    lex.set(key, `${lex.get(stem)} ${add}`);
  }
  return [key, ...rest];
}

// ---------- Regeln Deutsch ----------
const DE_SHORT = { a: 'a', e: 'ɛ', i: 'ɪ', o: 'ɔ', u: 'ʊ', ä: 'ɛ', ö: 'œ', ü: 'y', y: 'y' };
const DE_LONG = { a: 'aː', e: 'eː', i: 'iː', o: 'oː', u: 'uː', ä: 'ɛː', ö: 'øː', ü: 'yː', y: 'yː' };
const isV = c => !!c && 'aeiouäöüy'.includes(c);

export function rulesDe(w) {
  const out = [];
  let i = 0;
  const push = t => out.push({ t, stress: 0 });
  while (i < w.length) {
    const r = w.slice(i), c = w[i], prev = w[i - 1] ?? '', atStart = i === 0;
    if (r.startsWith('tsch')) { push('tʃ'); i += 4; continue; }
    if (r.startsWith('sch')) { push('ʃ'); i += 3; continue; }
    if (r.startsWith('chs')) { push('k'); push('s'); i += 3; continue; }
    if (r.startsWith('ch')) { push(/[aou]$/.test(w.slice(0, i)) && !/[aeä]u$/.test(w.slice(0, i)) ? 'x' : 'ç'); i += 2; continue; }
    if (r.startsWith('ck')) { push('k'); i += 2; continue; }
    if (r.startsWith('qu')) { push('k'); push('v'); i += 2; continue; }
    if (r.startsWith('ph')) { push('f'); i += 2; continue; }
    if (r.startsWith('th')) { push('t'); i += 2; continue; }
    if (r.startsWith('tz') || r.startsWith('zz') || c === 'z') { push('ts'); i += c === 'z' && w[i + 1] !== 'z' ? 1 : 2; continue; }
    if (r.startsWith('ng')) { push('ŋ'); i += 2; continue; }
    if (r.startsWith('nk')) { push('ŋ'); push('k'); i += 2; continue; }
    if (r.startsWith('ei') || r.startsWith('ai')) { push('aɪ'); i += 2; continue; }
    if (r.startsWith('eu') || r.startsWith('äu')) { push('ɔø'); i += 2; continue; }
    if (r.startsWith('au')) { push('aʊ'); i += 2; continue; }
    if (r.startsWith('ie')) { push('iː'); i += 2; continue; }
    if ((r.startsWith('sp') || r.startsWith('st')) && atStart) { push('ʃ'); push(r[1]); i += 2; continue; }
    if (isV(c)) {
      // Endsilben -e, -en, -el, -er, -em: Schwa bzw. [ɜ]
      if (c === 'e' && i > 0 && /^(e|en|el|em|es|et|ern|ers)$/.test(r) && out.some(x => isVowel(x.t))) {
        if (r.startsWith('er')) { push('ɜ'); i += 2; if (r === 'ern' || r === 'ers') { push(r[2]); i++; } continue; }
        push('ə'); i++; continue;
      }
      const next = w[i + 1] ?? '', after = w.slice(i + 1);
      let long;
      if (next === c && 'aeo'.includes(c)) { long = true; i++; }
      else if (next === 'h' && !isV(w[i + 2] ?? '')) { long = true; i++; }
      else if (next === 'h') { long = true; i++; }
      else {
        const cons = after.match(/^[^aeiouäöüy]*/)[0];
        long = cons.length === 0 || (cons.length === 1 && isV(after[1] ?? '')) || (cons.length === 1 && i + 2 >= w.length && !'xz'.includes(cons));
        if (/^(ch|sch|ck|ng|tz)/.test(after) || /^(.)\1/.test(after)) long = false;
      }
      push(long ? DE_LONG[c] : DE_SHORT[c]); i++; continue;
    }
    if (c === 'h') { if (!isV(prev)) push('h'); i++; continue; }
    if (c === 'r') { push(isV(w[i + 1] ?? '') ? 'r' : isV(prev) ? 'ɾ' : 'r'); i++; continue; }
    if (c === 's') { push(isV(w[i + 1] ?? '') && (atStart || isV(prev) || 'lmnr'.includes(prev)) ? 'z' : 's'); i += r.startsWith('ss') ? 2 : 1; continue; }
    if (c === 'ß') { push('s'); i++; continue; }
    if (c === 'v') { push('f'); i++; continue; }
    if (c === 'w') { push('v'); i++; continue; }
    if (c === 'x') { push('k'); push('s'); i++; continue; }
    if (c === 'c') { push('eiäy'.includes(w[i + 1] ?? '') ? 'ts' : 'k'); i++; continue; }
    if (c === 'j') { push('j'); i++; continue; }
    if (c === w[i + 1] && !isV(c)) { i++; continue; }        // Doppelkonsonant = einer
    if ('bdgfklmnpt'.includes(c)) {
      // Auslautverhärtung: b/d/g am Wortende oder vor Konsonant
      const final = i === w.length - 1 || !isV(w[i + 1] ?? '') && !'lr'.includes(w[i + 1] ?? '');
      push(final && c === 'b' ? 'p' : final && c === 'd' ? 't' : final && c === 'g' ? (w.endsWith('ig') && i === w.length - 1 ? 'ç' : 'k') : c === 'g' ? 'ɡ' : c);
      i++; continue;
    }
    i++;                                                      // unbekanntes Zeichen
  }
  // -ig: [ɪç]
  return stressFirst(out, w);
}

const UNSTRESSED_PREFIX = /^(be|ge|er|ver|zer|ent|emp|miss)(?=[a-zäöüß]{3})/;
function stressFirst(toks, w) {
  const vows = toks.map((x, i) => (isVowel(x.t) && x.t !== 'ə' && x.t !== 'ɜ' ? i : -1)).filter(i => i >= 0);
  if (!vows.length) return toks;
  const k = UNSTRESSED_PREFIX.test(w) && vows.length > 1 ? vows[1] : vows[0];
  toks[k].stress = 1;
  return toks;
}

// ---------- Regeln Englisch (grober Rückfall; CMUdict deckt fast alles ab) ----------
export function rulesEn(w) {
  const out = [];
  const push = t => out.push({ t, stress: 0 });
  let i = 0;
  const magicE = (k) => /^[^aeiouy][e]$/.test(w.slice(k + 1)) || /^[^aeiouy]e[sd]?$/.test(w.slice(k + 1));
  while (i < w.length) {
    const r = w.slice(i), c = w[i];
    const rule = [
      ['tch', ['tʃ']], ['igh', ['aɪ']], ['ough', ['ʌ', 'f']], ['th', ['θ']], ['sh', ['ʃ']], ['ch', ['tʃ']], ['ph', ['f']],
      ['ck', ['k']], ['ng', ['ŋ']], ['qu', ['k', 'w']], ['wh', ['w']], ['wr', ['ɹ']], ['kn', ['n']],
      ['ee', ['iː']], ['ea', ['iː']], ['oo', ['uː']], ['ai', ['eɪ']], ['ay', ['eɪ']], ['oa', ['oʊ']],
      ['ou', ['aʊ']], ['ow', ['aʊ']], ['oi', ['ɔɪ']], ['oy', ['ɔɪ']], ['au', ['ɔː']], ['aw', ['ɔː']],
      ['er', ['ɚ']], ['ir', ['ɜː']], ['ur', ['ɜː']], ['ar', ['ɑː', 'ɹ']], ['or', ['ɔː', 'ɹ']],
    ].find(([g]) => r.startsWith(g));
    if (rule) { rule[1].forEach(push); i += rule[0].length; continue; }
    if ('aeiouy'.includes(c)) {
      if (c === 'e' && i === w.length - 1 && i > 0) { i++; continue; }      // stummes e
      if (c === 'y') { push(i === w.length - 1 ? 'i' : i === 0 ? 'j' : 'ɪ'); i++; continue; }
      const long = magicE(i);
      push(long ? { a: 'eɪ', e: 'iː', i: 'aɪ', o: 'oʊ', u: 'uː' }[c] : { a: 'æ', e: 'ɛ', i: 'ɪ', o: 'ɑː', u: 'ʌ' }[c]);
      i++; continue;
    }
    if (c === w[i + 1]) { i++; continue; }
    if (c === 'c') { push('eiy'.includes(w[i + 1] ?? '') ? 's' : 'k'); i++; continue; }
    if (c === 'g') { push('eiy'.includes(w[i + 1] ?? '') ? 'dʒ' : 'ɡ'); i++; continue; }
    if (c === 'x') { push('k'); push('s'); i++; continue; }
    if (c === 'r') { push('ɹ'); i++; continue; }
    if (c === 'j') { push('dʒ'); i++; continue; }
    if (c === "'") { i++; continue; }
    if (/[bdfhklmnpstvwz]/.test(c)) { push(c); i++; continue; }
    i++;
  }
  const v = out.findIndex(x => isVowel(x.t));
  if (v >= 0) out[v].stress = 1;
  return out;
}

// ---------- Zahlen ----------
const DE_ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf',
  'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const DE_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Zahl als einzelne Wörter, wie gesprochen (Jahre 1100–1999 als „neunzehnhundert …“). */
export function numberWords(n, lang) {
  const de = lang === 'de';
  const below100 = (x, last) => {
    if (x < 20) return [de && x === 1 && !last ? 'ein' : (de ? DE_ONES : EN_ONES)[x]];
    const t = Math.floor(x / 10), o = x % 10;
    if (!o) return [(de ? DE_TENS : EN_TENS)[t]];
    return de ? [o === 1 ? 'ein' : DE_ONES[o], 'und', DE_TENS[t]] : [EN_TENS[t], EN_ONES[o]];
  };
  const below1000 = (x, last = true) => {
    const h = Math.floor(x / 100), r = x % 100, out = [];
    if (h) out.push(...(de ? [h === 1 ? 'ein' : DE_ONES[h], 'hundert'] : [EN_ONES[h], 'hundred']));
    if (r || !h) out.push(...(h && !de ? ['and'] : []), ...below100(r, last));
    return out;
  };
  if (n >= 1100 && n <= 1999) {
    const hi = Math.floor(n / 100), lo = n % 100;
    const rest = !lo ? [] : !de && lo < 10 ? ['oh', EN_ONES[lo]] : below100(lo, true);
    return [...below100(hi, false), ...(de || !lo ? [de ? 'hundert' : 'hundred'] : []), ...rest];
  }
  const out = [];
  for (const [size, de1, en1] of [[1e6, 'millionen', 'million'], [1e3, 'tausend', 'thousand']]) {
    const k = Math.floor(n / size);
    if (!k) continue;
    if (de && size === 1e6) out.push(...(k === 1 ? ['eine', 'million'] : [...below1000(k, false), de1]));
    else out.push(...below1000(k, false), de ? de1 : en1);
    n %= size;
  }
  if (n || !out.length) out.push(...below1000(n));
  return out;
}
