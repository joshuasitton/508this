/**
 * Phrases that make an instruction depend on something a reader may not
 * have: a position on the page, a shape, a size, a sound, or a colour.
 *
 * 1.3.3 Sensory Characteristics covers shape, size, visual location,
 * orientation and sound; 1.4.1 Use of Color covers colour, which the
 * standard deliberately keeps separate. Both are judgement criteria – only a
 * person can say whether "the box on the left" also has a label a screen
 * reader gets – so neither is "checked". What a pattern *can* do is find
 * every sentence that needs the judgement, so the reviewer reads twelve
 * sentences instead of forty pages. That is what these lists are for.
 *
 * "Above" and "below" are not here on purpose. WCAG's own guidance treats
 * "see the section below" as a reference to reading order, not to a
 * position on a page, and nearly every long document says it. Flagging it
 * would bury the real findings.
 *
 * A sensory phrase counts only in a sentence that is telling the reader to
 * do something. "The chapel on the left of the plaza" is description; "click
 * the button on the left" is an instruction that fails without sight.
 */

export const INSTRUCTION =
  /\b(click|press|select|choose|tap|use|see|refer to|go to|find|locate|look for|check|sign|fill in|fill out|enter|complete|return|submit|open|read|follow|pick|mark|tick|indicate|write|type|call|dial|listen|wait|note|review)\b/i;

const POSITION = [
  /\b(on|to|at|in|from|under|near) the (far |top |bottom |upper |lower )?(left|right)(-hand)?( side| column| corner| margin| panel| pane| edge| end)?\b/i,
  /\b(upper|lower|top|bottom)[- ](left|right)\b/i,
  /\bin the (top|bottom) (corner|of (the|this) (page|screen|window|form))\b/i,
  /\b(left|right)-hand (side|column|corner|margin|panel|menu|box)\b/i,
  /\b(in|on|to) the (side ?bar|margin|header|footer) (on|to|at) the (left|right)\b/i,
];

const SHAPE = [
  /\b(round|circular|square|rectangular|triangular|oval|star-shaped|arrow-shaped|diamond-shaped|striped|checkered) (button|icon|box|symbol|checkbox|tab|marker|field)\b/i,
  /\bthe (circle|square|triangle|arrow|star|diamond|checkmark|check mark|hourglass|magnifying glass) (button|icon|symbol|marker)\b/i,
  /\b(icon|button|symbol|marker) (shaped like|in the shape of)\b/i,
];

const SIZE = [
  /\bthe (large|larger|largest|big|bigger|biggest|small|smaller|smallest|wide|widest|narrow|narrowest|tall|short|thick|thin) (button|icon|box|arrow|text|print|circle|square|bar|marker)\b/i,
];

const SOUND = [
  /\b(when|after|until|once) you hear (a|the|an)\b/i,
  /\b(beep|chime|tone|bell|buzzer|alarm|sound) (plays|sounds|rings|goes off)\b/i,
  /\blisten for (a|the|an)\b/i,
  /\bat the (beep|tone|chime)\b/i,
];

export const SENSORY: Array<{ kind: 'position' | 'shape' | 'size' | 'sound'; patterns: RegExp[] }> = [
  { kind: 'position', patterns: POSITION },
  { kind: 'shape', patterns: SHAPE },
  { kind: 'size', patterns: SIZE },
  { kind: 'sound', patterns: SOUND },
];

const COLOUR_NAMES =
  '(?:bright |dark |light |pale |bold )?(?:red|green|blue|yellow|orange|purple|violet|grey|gray|pink|brown|black|white|amber|teal|navy|maroon|gold|silver)';

/**
 * Colour as the signal in prose. These do not need an instruction verb:
 * "Required fields are marked in red" is an instruction in effect, and
 * "figures in red are provisional" is a legend nobody who cannot see red
 * can use.
 */
export const COLOUR = [
  new RegExp(
    `\\b(in|marked in|marked|shown in|shaded|shaded in|highlighted in|highlighted|displayed in|printed in|appear in|appears in|appearing in|indicated in|indicated by|denoted by|coloured|colored|colou?r-coded|colou?r coded)\\s+${COLOUR_NAMES}\\b`,
    'i',
  ),
  new RegExp(
    `\\bthe ${COLOUR_NAMES} (button|buttons|text|link|links|field|fields|item|items|cell|cells|row|rows|column|columns|bar|bars|line|lines|dot|dots|arrow|arrows|box|boxes|section|sections|area|areas|highlight|highlights|tab|tabs|icon|icons|marker|markers|circle|circles|shading|border|region|regions|zone|zones|entries|entry|values|value|numbers|number|figures|figure|dates|date)\\b`,
    'i',
  ),
  new RegExp(`\\b(status|indicated|shown|coded|marked|flagged|identified|distinguished) by colou?r\\b`, 'i'),
  new RegExp(`\\b(shown|displayed|coded|marked|indicated|represented) as ${COLOUR_NAMES}\\b`, 'i'),
];

/**
 * A legend: two or more colour names joined by a comma, slash, "and" or
 * "or", in a sentence that also says what they mean. "Green, amber or red"
 * on its own could be a paint chart; with "status" or "indicates" it is a
 * traffic light nobody colour-blind can read.
 */
const COLOUR_PAIR = new RegExp(`\\b${COLOUR_NAMES}\\s*(?:\\/|,|\\band\\b|\\bor\\b)\\s*(?:${COLOUR_NAMES}\\s*(?:\\/|,|\\band\\b|\\bor\\b)\\s*)*${COLOUR_NAMES}\\b`, 'i');
const COLOUR_SIGNAL = /\b(status|indicates?|indicating|means?|meaning|shows?|showing|denotes?|represents?|signals?|priority|risk|rating|level)\b/i;

/** Sentences of a paragraph, roughly: split on terminal punctuation. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface PhraseHit {
  sentence: string;
  /** The matched phrase, for the report. */
  phrase: string;
  kind: 'position' | 'shape' | 'size' | 'sound' | 'colour';
}

export function findSensory(text: string): PhraseHit[] {
  const out: PhraseHit[] = [];
  for (const sentence of sentences(text)) {
    if (!INSTRUCTION.test(sentence)) continue;
    for (const group of SENSORY) {
      for (const re of group.patterns) {
        const m = re.exec(sentence);
        if (m) {
          out.push({ sentence, phrase: m[0], kind: group.kind });
          break;
        }
      }
    }
  }
  return out;
}

export function findColourWords(text: string): PhraseHit[] {
  const out: PhraseHit[] = [];
  for (const sentence of sentences(text)) {
    let hit: PhraseHit | undefined;
    for (const re of COLOUR) {
      const m = re.exec(sentence);
      if (m) {
        hit = { sentence, phrase: m[0], kind: 'colour' };
        break;
      }
    }
    if (!hit && COLOUR_SIGNAL.test(sentence)) {
      const m = COLOUR_PAIR.exec(sentence);
      if (m) hit = { sentence, phrase: m[0], kind: 'colour' };
    }
    if (hit) out.push(hit);
  }
  return out;
}
