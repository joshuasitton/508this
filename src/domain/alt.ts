/**
 * Drafted alternative text: what a model is asked, and what comes back.
 *
 * A draft is a **proposal, never a fix.** That is the product's central rule
 * and the reason the review queue exists: a wrong description is a finding,
 * not a remediation, and the service's promise is conformance. Nothing here
 * writes into a document. A draft is stored beside the finding, the reviewer
 * sees it in the box they were going to type in, and it becomes a decision
 * only when they press the button with their name on the job.
 *
 * What may be sent is settled and narrow (the Chairman's retention decision,
 * 21 September): the cropped image of **one figure**, never the whole
 * document, never its text, never a Word file's XML — and nothing at all for
 * a document the customer marks CUI. The caller enforces that; this module
 * only knows what to ask and how to read the answer.
 *
 * `normaliseDraft` exists because a model's first sentence is often the one
 * thing alternative text must not contain. A screen reader already announces
 * that it is on an image, so "Image of a bar chart…" is announced as "image,
 * image of a bar chart", and the standard's own guidance is to describe the
 * content rather than the medium. Stripping that opener is not cosmetic: it
 * is the difference between a draft a reviewer accepts and one they retype.
 */

/** The longest a description should run before it stops being alternative text. */
export const MAX_ALT = 250;

/**
 * Openers that describe the **medium** rather than the content. A screen
 * reader has already said "image"; saying it again is the most common fault
 * in alternative text and the one a model is most likely to produce.
 *
 * The list is only medium words, and that boundary matters. "Chart",
 * "diagram", "map" and "logo" name what the thing *is*, which is content: a
 * reader is better served by "Bar chart of enrolment by year" than by
 * "Enrolment by year", because the shape of the data is part of the
 * information. Stripping those was the first version of this and it turned
 * good descriptions into worse ones.
 */
const MEDIUM_OPENER =
  /^\s*(?:(?:a|an|the|this)\s+)?(?:image|picture|photo|photograph|graphic|figure|illustration|screenshot)\s+(?:is\s+)?(?:of|showing|shows|depicts?|depicting|that shows|which shows)\s+/i;

/** A model declining, or hedging so hard the sentence carries nothing. */
const NOT_A_DESCRIPTION =
  /^\s*(?:i\s+(?:can(?:'|’)?t|cannot|am unable|do not|don(?:'|’)?t)\b|sorry\b|unable to\b|as an ai\b|it(?:'|’)?s not possible\b)/i;

export interface Draft {
  /** The text to put in the reviewer's box. */
  text: string;
  /** True when the model's answer was unusable and there is nothing to show. */
  refused: boolean;
}

/**
 * A model's raw answer, turned into something worth putting in front of a
 * reviewer — or marked refused so the screen says so rather than showing a
 * shrug as if it were a description.
 */
export function normaliseDraft(raw: string): Draft {
  let text = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Models like to wrap an answer in quotation marks. The quotes are not
  // part of the description and would be read out.
  const quoted = /^["“”'‘’](.*)["“”'‘’]$/.exec(text);
  if (quoted?.[1]) text = quoted[1].trim();

  if (!text || NOT_A_DESCRIPTION.test(text)) return { text: '', refused: true };

  text = text.replace(MEDIUM_OPENER, '');
  // Stripping the opener can leave a lower-case first letter.
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);

  if (text.length > MAX_ALT) {
    // Cut at a sentence end if there is one in range, so the draft does not
    // stop mid-clause; otherwise at a word boundary.
    const head = text.slice(0, MAX_ALT);
    const sentence = head.lastIndexOf('. ');
    const cut = sentence > MAX_ALT / 2 ? sentence + 1 : head.lastIndexOf(' ');
    text = (cut > 0 ? head.slice(0, cut) : head).trim();
  }

  if (!text) return { text: '', refused: true };
  return { text, refused: false };
}

/**
 * What the model is told. Deliberately short: it says what the description
 * is for, what it must not begin with, and how long it may be, and it gives
 * the model no document context because none is sent.
 *
 * It also says to decline rather than guess. A figure that cannot be read
 * from the image alone — a dense table rendered as a picture, a chart with
 * no legible labels — produces a confident invention if the model is asked
 * to produce something regardless, and a confident invention is the worst
 * output this product can generate: a reviewer accepts it because it reads
 * well, and the document ships with a lie in it where a description belongs.
 */
export const ALT_INSTRUCTION = [
  'You are drafting alternative text for one image from a document, for a reader who cannot see it.',
  '',
  'Write one or two sentences saying what the image conveys — its information, not its appearance.',
  `Keep it under ${MAX_ALT} characters.`,
  'Do not begin with "Image of", "Picture of", "Graphic showing" or similar: a screen reader already announces that it is an image.',
  'If the image carries data, give the point the data makes rather than reading every value aloud.',
  'Reply with the description alone — no preamble, no quotation marks, no explanation.',
  '',
  'If you cannot tell what the image shows, reply with exactly: CANNOT DESCRIBE',
].join('\n');

/** The sentinel the instruction asks for, matched before anything else. */
export function isRefusal(raw: string): boolean {
  return /^\s*CANNOT DESCRIBE\s*$/i.test(raw);
}

/** Media types a vision model accepts, and therefore the only ones worth extracting. */
export const SENDABLE_MEDIA = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type SendableMedia = (typeof SENDABLE_MEDIA)[number];

export function isSendable(mediaType: string): mediaType is SendableMedia {
  return (SENDABLE_MEDIA as readonly string[]).includes(mediaType);
}

/**
 * The picture a draft is made from: bytes, and what they are. Kept as a type
 * so the two formats that carry one — a part in a `.docx` archive, an image
 * XObject in a PDF — hand back the same thing.
 */
export interface FigureImage {
  bytes: Uint8Array;
  mediaType: SendableMedia;
}

/**
 * Why no image could be produced for a figure. These are shown to the
 * reviewer, because "nothing happened" is the least useful thing a button
 * can do, and because the commonest reason is one the product cannot fix:
 * the artwork is vector, and there is no picture in the file at all.
 */
export type NoImage =
  | 'vector'
  | 'no-box'
  | 'render-failed'
  | 'not-found'
  | 'unsupported-filter'
  | 'unsupported-colour'
  | 'too-large'
  | 'no-anchor';

export function describeNoImage(reason: NoImage): string {
  switch (reason) {
    case 'vector':
      return 'This figure is drawn as vector artwork rather than stored as a picture. Where the document says where it sits on the page, 508This draws it; this one could not be. Describe it yourself.';
    case 'no-box':
      return 'This figure is vector artwork and the document does not say where on the page it sits, so there is nothing that can be drawn without sending the whole page. Describe it yourself.';
    case 'render-failed':
      return 'This figure could not be drawn. Describe it yourself.';
    case 'not-found':
      return 'The figure could not be found in the document. Describe it yourself.';
    case 'unsupported-filter':
      return 'The picture is stored in a format this service does not decode. Describe it yourself.';
    case 'unsupported-colour':
      return 'The picture uses a colour space this service does not decode. Describe it yourself.';
    case 'too-large':
      return 'The picture is too large to send. Describe it yourself.';
    case 'no-anchor':
      return 'This finding has nothing to point a description at. Describe it yourself.';
  }
}

/** 5 MB. Comfortably above a document figure and well inside the API's limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
