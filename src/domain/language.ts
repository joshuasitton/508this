/**
 * Which language a passage is in, well enough to mark it.
 *
 * 3.1.2 Language of Parts asks that a passage in a language other than the
 * document's be marked as such, so a screen reader switches voice. Finding
 * those passages needs a language detector, and the domain may not take a
 * dependency, so this is one: script first, then function words.
 *
 * Script is decisive. A run of Han, Hangul, Cyrillic, Arabic, Thai or
 * Devanagari characters is in a language that uses that script, and the tag
 * chosen is the one Word most often writes for it. For Latin-script text the
 * signal is function words – the, of, and, to; el, la, de, que; le, la, les,
 * des – counted against short lists for the languages that turn up in US
 * federal documents. Function words are the right signal because they are
 * frequent, closed-class, and nearly disjoint between languages once a
 * passage has twenty of them; content words are none of those things.
 *
 * The thresholds are deliberately conservative. The criterion itself exempts
 * proper names, technical terms and words that have become part of the
 * surrounding language, so a paragraph with a Spanish name in it must not be
 * flagged, and a wrong flag costs a reviewer's time on every document. A
 * passage has to be at least twenty words, score clearly, and beat English
 * (or the document's own language) by a margin.
 */

export interface Detected {
  /** Primary language subtag: "es", "fr", "zh"… */
  language: string;
  /** The tag to write into the document: "es-US", "zh-CN"… */
  tag: string;
  /** Which `w:lang` attribute the tag belongs in. */
  slot: 'val' | 'eastAsia' | 'bidi';
  /** Human name for the report. */
  name: string;
}

const NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  de: 'German',
  it: 'Italian',
  vi: 'Vietnamese',
  tl: 'Tagalog',
  ht: 'Haitian Creole',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  ar: 'Arabic',
  th: 'Thai',
  hi: 'Hindi',
};

const TAGS: Record<string, { tag: string; slot: Detected['slot'] }> = {
  en: { tag: 'en-US', slot: 'val' },
  es: { tag: 'es-US', slot: 'val' },
  fr: { tag: 'fr-FR', slot: 'val' },
  pt: { tag: 'pt-BR', slot: 'val' },
  de: { tag: 'de-DE', slot: 'val' },
  it: { tag: 'it-IT', slot: 'val' },
  vi: { tag: 'vi-VN', slot: 'val' },
  tl: { tag: 'fil-PH', slot: 'val' },
  ht: { tag: 'ht-HT', slot: 'val' },
  zh: { tag: 'zh-CN', slot: 'eastAsia' },
  ja: { tag: 'ja-JP', slot: 'eastAsia' },
  ko: { tag: 'ko-KR', slot: 'eastAsia' },
  ru: { tag: 'ru-RU', slot: 'val' },
  ar: { tag: 'ar-SA', slot: 'bidi' },
  th: { tag: 'th-TH', slot: 'val' },
  hi: { tag: 'hi-IN', slot: 'val' },
};

const WORDS: Record<string, string> = {
  en: 'the of and to in a is that for it as with on be this by are from or an at was have not which you your all can will their more has been were if they each also must may shall any than these into other its such when where who',
  es: 'el la los las de del que y en un una es por para con no se su al lo como más pero sus le ya o este porque esta entre cuando muy sin sobre también hasta hay donde desde todo nos durante todos uno les ni contra otros ese eso ante ellos esto antes algunos qué unos otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros usted debe puede cada',
  fr: 'le la les de des du et en un une est que qui dans pour pas au aux ce cette ces il elle ils elles nous vous sur avec sont ne se son sa ses leur plus par être ont été mais ou où comme aussi tout tous très même peut doit sans entre après avant chez',
  pt: 'o a os as de do da dos das que e em um uma é não para com por se no na nos nas ao à mais mas como ou seu sua são foi pelo pela também já isso ele ela eles você deve pode cada até sem entre sobre',
  de: 'der die das und ist in den von zu mit nicht sich auf für ein eine des dem im auch als an es wird sind oder aus bei nach wie werden über hat einer einem muss kann diese dieser jeder ohne zwischen',
  it: 'il la di che e un una in per è non con sono del della le gli dei delle come anche più questo questa ma si al alla nel nella ogni deve può senza tra dopo prima',
  vi: 'và của các là có được trong không cho người này với những để tại một về theo từ đã khi như đến phải bạn chúng tôi các',
  tl: 'ang ng mga sa na at ay ito para hindi ako ikaw siya kami tayo sila kung may naman din rin lang po ninyo inyong dapat',
  ht: 'nan pou yo ak la se li ki pa te gen sa yon nou ou moun ap pral tout men avèk dwe kapab chak',
};

const LISTS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(WORDS).map(([lang, words]) => [lang, new Set(words.split(/\s+/))]),
);

const SCRIPTS: Array<[RegExp, string]> = [
  [/[一-鿿㐀-䶿]/g, 'zh'],
  [/[぀-ヿ]/g, 'ja'],
  [/[가-힯]/g, 'ko'],
  [/[Ѐ-ӿ]/g, 'ru'],
  [/[؀-ۿ]/g, 'ar'],
  [/[฀-๿]/g, 'th'],
  [/[ऀ-ॿ]/g, 'hi'],
];

export const MIN_WORDS = 20;
const MIN_SCORE = 0.12;
const MARGIN = 1.5;

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}']+/u)
    .filter((t) => t.length > 0 && !/^\d+$/.test(t));
}

function describe(language: string): Detected {
  const { tag, slot } = TAGS[language] ?? { tag: language, slot: 'val' as const };
  return { language, tag, slot, name: NAMES[language] ?? language };
}

/**
 * The language of a passage, or null when the passage is too short or too
 * mixed to say. `expected` is the primary subtag of the document's own
 * language; a passage in that language is never returned, since it needs no
 * marking.
 */
export function detectLanguage(text: string, expected = 'en'): Detected | null {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return null;

  // Script. Japanese kana beats Han, since Japanese text has both.
  for (const [re, lang] of SCRIPTS) {
    const count = (text.match(re) ?? []).length;
    if (count >= 10 && count / letters >= 0.5) {
      const language = lang === 'zh' && /[぀-ヿ]/.test(text) ? 'ja' : lang;
      return language === expected ? null : describe(language);
    }
  }

  const words = tokens(text);
  if (words.length < MIN_WORDS) return null;
  const scores: Record<string, number> = {};
  for (const [lang, list] of Object.entries(LISTS)) {
    let hits = 0;
    for (const w of words) if (list.has(w)) hits += 1;
    scores[lang] = hits / words.length;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0]!;
  const rival = Math.max(scores[expected] ?? 0, ranked[1]?.[1] ?? 0);
  if (best === expected) return null;
  if (bestScore < MIN_SCORE) return null;
  if (bestScore < rival * MARGIN) return null;
  return describe(best);
}

/** "en-US" → "en"; "zh-Hans-CN" → "zh". */
export function primarySubtag(tag: string): string {
  return tag.split(/[-_]/)[0]!.toLowerCase();
}
