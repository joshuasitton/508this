/**
 * Finding the sentences a reviewer has to judge, so they do not have to
 * find them.
 *
 * 1.3.3 Sensory Characteristics and 1.4.1 Use of Color stay reviewer
 * criteria, and should: "no instruction relies on shape, size, position or
 * sound" and "colour is never the only way information is conveyed" are
 * judgements about meaning, and a machine that claimed them would be
 * claiming to have understood the document.
 *
 * What a machine can do is narrow the reading. The Word path has done this
 * since the detector was written — its remarks say the screen flags every
 * sentence that names a position or a colour — and the PDF path had none of
 * it, so the same criterion meant "confirm these three sentences" for a
 * .docx and "read the whole document" for a PDF.
 *
 * The phrase matching is `phrases.ts`, which is pure and has never known
 * what format it is reading. Nothing here is new judgement; it is the Word
 * path's reach, applied to text that had to be drawn before it could be
 * read.
 *
 * ## Colour used as emphasis, and why this is narrower than Word's
 *
 * Word flags a coloured run among plain ones with no bold, italic or
 * underline to go with it. A .docx is mostly plain with occasional colour,
 * so that is a small, sharp signal.
 *
 * A designed PDF is the opposite: brand colour is everywhere, in subheads,
 * callouts and pull quotes, none of which is "colour as the only means of
 * conveying information". Flagging every coloured run would bury the
 * reviewer, which is the failure mode this whole file exists to avoid.
 *
 * So this flags only colour used **inline**: a run that differs in colour
 * from the rest of its own line, at the same size as the text around it,
 * with no weight to go with it. That is emphasis mid-sentence, which is the
 * case the criterion is actually about. A coloured heading is not flagged,
 * because a heading is set apart by being a heading.
 */

import { findColourWords, findSensory } from './phrases';
import { KINDS, type Kind } from './kinds';
import type { Finding, Severity } from './findings';
import type { PaintedRun, TextBlock } from './pdfPainted';
import type { Rgb } from './contrast';

function finding(kind: Kind, location: string, description: string, severity: Severity): Finding {
  return { kind, criterion: KINDS[kind].criterion, location, description, severity, remediated: false };
}

const SNIPPET = 70;

function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > SNIPPET ? `${t.slice(0, SNIPPET - 1)}…` : t;
}

/** The same sentence as the Word path uses, so the two reports read alike. */
function sensorySentence(kind: 'position' | 'shape' | 'size' | 'sound', phrase: string, sentence: string): string {
  const relies = kind === 'position' ? 'a position on the page' : kind === 'sound' ? 'a sound' : `a ${kind}`;
  const cannot = kind === 'sound' ? 'hear it' : 'see the page';
  return `The instruction “${snippet(sentence)}” relies on ${relies} (“${phrase}”), which a person who cannot ${cannot} has no way to follow.`;
}

/**
 * 1.3.3 and the prose half of 1.4.1.
 *
 * One finding per sentence, and a sentence is only reached at all if it
 * reads as an instruction — `INSTRUCTION` in `phrases.ts`. "The chart is
 * green" is a description; "click the green button" is the failure.
 */
export function proseFindings(blocks: readonly TextBlock[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    for (const hit of findSensory(block.text)) {
      if (!once(seen, `sensory:${block.page}:${hit.sentence}:${hit.phrase}`)) continue;
      out.push(finding('sensory', `page ${block.page}`, sensorySentence(hit.kind as never, hit.phrase, hit.sentence), 'partial'));
    }
    for (const hit of findColourWords(block.text)) {
      if (!once(seen, `colour:${block.page}:${hit.sentence}:${hit.phrase}`)) continue;
      out.push(
        finding(
          'colour-words',
          `page ${block.page}`,
          `“${snippet(hit.sentence)}” uses colour as the signal (“${hit.phrase}”), which a screen reader does not ` +
            'announce and a colour-blind reader may not see.',
          'partial',
        ),
      );
    }
  }

  return out;
}

function once(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/** Two colours are the same ink if every channel is within this. */
const SAME_INK = 24;

/** And the same size if their point sizes are within this much of each other. */
const SAME_SIZE = 1.5;

const alike = (a: Rgb, b: Rgb): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= SAME_INK);

const readable = (text: string): boolean => (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;

/**
 * 1.4.1, colour used as emphasis inside a line.
 *
 * A run whose ink differs from the rest of its own line, at the same size,
 * with no weight to carry the emphasis instead. One finding per page per
 * colour: a document that emphasises in red has one habit, not forty
 * instances of it.
 */
export function colourOnlyFindings(runs: readonly PaintedRun[]): Finding[] {
  const out: Finding[] = [];
  const pages = new Map<number, PaintedRun[]>();
  for (const run of runs) {
    if (!readable(run.text) || !run.foreground) continue;
    const list = pages.get(run.page);
    if (list) list.push(run);
    else pages.set(run.page, [run]);
  }

  for (const [page, all] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
    const seen = new Set<string>();
    for (const line of linesOf(all)) {
      if (line.length < 2) continue;
      const ink = dominant(line);
      if (!ink) continue;

      for (const run of line) {
        if (!run.foreground || alike(run.foreground, ink.colour)) continue;
        // A heading is set apart by being a heading; this is about a word
        // inside a sentence.
        if (Math.abs(run.points - ink.points) > SAME_SIZE) continue;
        // Bold or italic is the other cue the criterion asks for.
        if (run.bold) continue;

        const key = run.foreground.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(
          finding(
            'colour-only',
            `page ${page}`,
            `“${snippet(run.text)}” is set apart from the words around it by colour alone, with no bold, italic or ` +
              'other cue. A screen reader announces it like any other word.',
            'partial',
          ),
        );
      }
    }
  }

  return out;
}

/** Runs grouped into the lines they sit on, by vertical overlap. */
function linesOf(runs: readonly PaintedRun[]): PaintedRun[][] {
  const sorted = [...runs].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: PaintedRun[][] = [];

  for (const run of sorted) {
    const line = lines.at(-1);
    const last = line?.at(-1);
    // Same line if their vertical spans overlap by most of the shorter one:
    // a superscript shares its line, a new paragraph does not.
    const overlap = last ? Math.min(last.bottom, run.bottom) - Math.max(last.top, run.top) : 0;
    const shorter = last ? Math.min(last.bottom - last.top, run.bottom - run.top) : 1;
    if (line && shorter > 0 && overlap / shorter > 0.5) line.push(run);
    else lines.push([run]);
  }

  return lines;
}

/** The ink most of a line is set in, by how much text carries it. */
function dominant(line: readonly PaintedRun[]): { colour: Rgb; points: number } | null {
  const buckets = new Map<string, { colour: Rgb; points: number; weight: number }>();
  for (const run of line) {
    if (!run.foreground) continue;
    const key = run.foreground.map((v) => Math.round(v / SAME_INK)).join(',');
    const weight = run.text.trim().length;
    const bucket = buckets.get(key);
    if (bucket) bucket.weight += weight;
    else buckets.set(key, { colour: run.foreground, points: run.points, weight });
  }

  let best: { colour: Rgb; points: number; weight: number } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  // One colour on the line is not emphasis, it is just the line.
  return best && buckets.size > 1 ? best : null;
}
