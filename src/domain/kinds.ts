/**
 * The kinds of thing detection finds, in the customer's words.
 *
 * A criterion number tells a Section 508 specialist everything and a
 * communications lead nothing. "1.3.1 Info and Relationships" covers both a
 * table without a header row and a heading that skips a level, which are
 * different problems with different fixes, so findings carry a *kind* as well
 * as a criterion. The kind is what the report groups by; the criterion is
 * what the ACR is scored on.
 *
 * Each kind owns three sentences: what it is called, why it matters to a
 * person using assistive technology, and what the service does about it. They
 * live here, next to the criterion they map to, and a test pins that every
 * kind maps to a criterion in the catalogue and every finding the detector
 * produces has a kind that is listed here. The job page and the delivered
 * report both read from this table, so they cannot explain the same finding
 * two different ways.
 */

import type { Finding } from './findings';

export type Kind =
  | 'no-title'
  | 'no-language'
  | 'image-alt'
  | 'table-header'
  | 'heading-skip'
  | 'no-headings'
  | 'link-text'
  | 'contrast'
  | 'media'
  | 'forms';

export interface KindInfo {
  criterion: string;
  /** A plural noun phrase naming the problem: "Images without alternative text". */
  title: string;
  /** Why it matters, to a person who has never used a screen reader. */
  why: string;
  /** What remediation does about it. Present tense, first person plural. */
  fix: string;
}

export const KINDS: Record<Kind, KindInfo> = {
  'no-title': {
    criterion: '2.4.2',
    title: 'No document title',
    why: 'A screen reader announces the title when the document opens and lists it when switching between windows. Without one it reads the filename, which is often something like "final_v3_JS_edits".',
    fix: 'We set the title from the first heading and you confirm it.',
  },
  'no-language': {
    criterion: '3.1.1',
    title: 'No document language',
    why: 'A screen reader chooses its voice and pronunciation from the document language. Without one it guesses, and English read with the wrong voice is close to unintelligible.',
    fix: 'We set the document language, in English unless you tell us otherwise.',
  },
  'image-alt': {
    criterion: '1.1.1',
    title: 'Images without alternative text',
    why: 'A person who cannot see the image hears nothing at all where it is, or the word "image". If a chart carries the finding, they never get the finding.',
    fix: 'We draft a description of each image for your reviewer to approve, or mark it decorative if it carries no information.',
  },
  'table-header': {
    criterion: '1.3.1',
    title: 'Tables without a header row',
    why: 'Without a marked header row, a screen reader reads each cell as a bare value: "Housing. Met." A marked one is announced with every cell: "Programme: Housing. Outcome: Met."',
    fix: 'We mark the first row as the header row. It looks the same and repeats at the top of each page the table crosses.',
  },
  'heading-skip': {
    criterion: '1.3.1',
    title: 'Skipped heading levels',
    why: 'People who navigate by heading hear the outline of the document. A jump from level 1 to level 3 sounds like a section is missing, and some readers stop and look for it.',
    fix: 'We adjust the heading levels so the outline runs in order, without changing how the headings look.',
  },
  'no-headings': {
    criterion: '1.3.1',
    title: 'No headings at all',
    why: 'Bold text looks like a heading and is not one. Assistive technology cannot jump to it, list it, or skip past it, so a long document has to be read from the top every time.',
    fix: 'We apply real heading styles to the visual headings, at the levels the document’s structure implies.',
  },
  'link-text': {
    criterion: '2.4.4',
    title: 'Links that do not say where they go',
    why: 'Screen reader users often pull up a list of every link in a document. Twelve links that all say "here" tell them nothing, and a bare web address is read out letter by letter.',
    fix: 'We rewrite each link’s text to name what it points to, and keep the address underneath.',
  },
  contrast: {
    criterion: '1.4.3',
    title: 'Text that is hard to read against its background',
    why: 'Light grey on white, or white on yellow, disappears for people with low vision, on a poor screen, or in daylight. The standard sets a minimum contrast of 4.5:1 for body text.',
    fix: 'We darken the text colour just enough to meet the minimum and keep the design.',
  },
  media: {
    criterion: '1.2.1',
    title: 'Embedded audio or video',
    why: 'A recording carries information a person who cannot hear it, or cannot see it, has no other way to get. Captions and an audio description are what make it available to them.',
    fix: 'We flag each recording for a reviewer, who confirms captions and a description are present or arranges them.',
  },
  forms: {
    criterion: '3.3.2',
    title: 'Form fields',
    why: 'A field with no label is announced as "edit text" and nothing more. A person filling it in by ear does not know what goes in it, or what went wrong when it is rejected.',
    fix: 'We flag each field for a reviewer, who confirms it has a label and clear instructions.',
  },
};

export const ALL_KINDS = Object.keys(KINDS) as Kind[];

export interface KindGroup {
  kind: Kind;
  info: KindInfo;
  findings: Finding[];
  open: number;
  blocking: boolean;
}

/**
 * Findings grouped for reading: anything blocking first, then the kinds with
 * the most places to fix, then catalogue order. The customer reads the worst
 * news first and the longest list next; the tail is the easy part.
 */
export function groupByKind(findings: readonly Finding[]): KindGroup[] {
  const groups = new Map<Kind, Finding[]>();
  for (const f of findings) {
    const list = groups.get(f.kind) ?? [];
    list.push(f);
    groups.set(f.kind, list);
  }
  const order = new Map(ALL_KINDS.map((k, i) => [k, i]));
  return [...groups.entries()]
    .map(([kind, list]) => ({
      kind,
      info: KINDS[kind],
      findings: list,
      open: list.filter((f) => !f.remediated).length,
      blocking: list.some((f) => !f.remediated && f.severity === 'blocking'),
    }))
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) || b.open - a.open || (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0),
    );
}

export function kindInfo(kind: Kind): KindInfo {
  return KINDS[kind];
}
