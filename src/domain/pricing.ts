/**
 * What 508This charges, and — inseparably — what the money buys.
 *
 * The triage established that a PDF is four different products wearing one
 * file extension, and `promiseFor` put the sentence describing each of them
 * in the code rather than in sales copy, so the promise could not drift
 * from what the software does. A price is the same kind of claim and it
 * drifts the same way, so it lives beside the promise and is returned with
 * it: `quoteFor` hands back a number and the sentence together, and there
 * is no function anywhere that returns the number alone.
 *
 * That is the whole design. A remediation service that quotes one price for
 * every document is quoting for work it cannot do on most of them, and the
 * moment the price is separable from the promise, a landing page will
 * separate them.
 *
 * ## Why the offers are shaped this way
 *
 * Three offers, and each one maps onto a capability the code actually has:
 *
 * - **Assessment, free.** Detection and triage: every finding, the tier,
 *   and the promise. It costs pennies to run and it is the only honest way
 *   to sell this — the customer learns *before* paying whether the service
 *   can help them. For a scan it is the entire relationship, and it should
 *   be: charging for "we cannot help you" is how a compliance vendor earns
 *   a reputation it does not recover from.
 * - **Statement.** The reviewer-attested conformance report, in the layout
 *   a contracting officer files. A contractor with a deliverable needs this
 *   document whatever the verdict is — "does not conform, and here is
 *   exactly which of the 34 criteria and why" is a filing, not a failure.
 * - **Remediation.** The statement, plus the review queue, the drafted
 *   descriptions and the changed file.
 *
 * ## Why remediation costs less on a tagged PDF
 *
 * Because it delivers less, and the price is where that has to show. A
 * tagged PDF with no headings gets its figures described and still cannot
 * be certified; that is worth real money and it is not worth the same money
 * as a document the service can carry to conformance. The invariant a test
 * holds: **no tier the service cannot certify is charged the certifiable
 * price.**
 *
 * ## Why figures and not pages
 *
 * The market quotes per page and the market is wrong about this product.
 * The work here does not scale with pages — a 200-page untagged report is
 * one language fix — it scales with figures, because every figure is a
 * human decision a machine cannot make for them. A six-page infographic
 * with 76 figures is an afternoon; per-page pricing would charge it like a
 * pamphlet. So the flat price covers the first ten and each one after that
 * is priced at about what two minutes of a reviewer's time costs.
 *
 * The drafted description a figure gets is not what the surcharge pays for.
 * One draft costs one to three cents of model time at current rates; the
 * surcharge is two orders of magnitude above that because it is buying the
 * reviewer's attention, which is the scarce thing.
 */

import type { Finding } from './findings';
import type { Format } from './job';
import { promiseFor, type Tier } from './triage';

export type Offer = 'assessment' | 'statement' | 'remediation';

export const OFFERS: readonly Offer[] = ['assessment', 'statement', 'remediation'];

/**
 * How far into a document the service can reach. Both formats land here,
 * which is the point: a Word file has no PDF tier, and pricing still has to
 * have an opinion about it.
 */
export type Reach = 'nothing' | 'metadata' | 'figures' | 'most';

/**
 * Every number the company charges, in cents, in one table.
 *
 * They are here rather than spread through the code so that changing what
 * 508This costs is a diff a person can read in one screen, and so that the
 * next person to ask "what do we charge for an untagged PDF?" gets the
 * answer from the software rather than from somebody's memory of a meeting.
 */
export const PRICES = {
  assessment: 0,
  statement: 4_900,
  /** Remediation, by what the service can reach. */
  remediation: {
    /** Word, and a PDF with tags and headings: conformance is reachable. */
    certifiable: 14_900,
    /** A tagged PDF with no headings: the figures get described, and that is all. */
    partial: 9_900,
  },
  figures: {
    /** Covered by the flat price. */
    included: 10,
    /** Each figure beyond that, at roughly two minutes of a reviewer's time. */
    each: 300,
  },
} as const;

/**
 * What the service can reach in this document. A Word file passes `null`
 * for the tier, because `.docx` is XML and nearly everything the standard
 * asks about is readable and rewritable — the four-way split is a fact
 * about PDFs, not about documents.
 */
export function reachOf(format: Format, tier: Tier | null): Reach {
  if (format === 'docx') return 'most';
  switch (tier) {
    case 'scan':
      return 'nothing';
    case 'untagged':
      return 'metadata';
    case 'tagged':
      return 'figures';
    case 'structured':
      return 'most';
    default:
      // A PDF whose tier was never established is not a document to quote
      // on. Saying so beats guessing generously.
      return 'nothing';
  }
}

/** Whether a document of this reach can be carried to a conformance claim. */
export function certifiable(reach: Reach): boolean {
  return reach === 'most';
}

/** The document being quoted on, in the only three terms the price uses. */
export interface Work {
  format: Format;
  /** `null` for a Word document, which has no PDF tier. */
  tier: Tier | null;
  /**
   * Figures a person has to describe: one human decision each, and the only
   * thing in a document whose count changes the price.
   */
  figures: number;
}

export interface QuoteLine {
  label: string;
  cents: number;
}

export type Quote =
  | {
      available: true;
      offer: Offer;
      cents: number;
      lines: readonly QuoteLine[];
      /** What the document is, in the words the triage already uses. */
      promise: string;
      /** What this money does *not* buy. Absent when there is nothing to warn about. */
      caveat?: string;
    }
  | {
      available: false;
      offer: Offer;
      /** Why the service will not sell this, in the customer's words. */
      because: string;
    };

/** The plain-English name of an offer, for a heading or a button. */
export function labelFor(offer: Offer): string {
  switch (offer) {
    case 'assessment':
      return 'Assessment';
    case 'statement':
      return 'Conformance statement';
    case 'remediation':
      return 'Remediation';
  }
}

/** What the offer includes, independent of this particular document. */
export function describeOffer(offer: Offer): string {
  switch (offer) {
    case 'assessment':
      return 'Every issue in the document, which of the 34 criteria each one touches, and an honest sentence about what can be done with the file. Free, and it always will be: a customer should find out whether this service can help them before they pay for it.';
    case 'statement':
      return 'The conformance report, attested by a named reviewer, as a web page and as the Word file a contracting officer files. The verdict is whatever the document earns.';
    case 'remediation':
      return 'Everything above, plus the review queue: the issues with one right answer fixed in the file, a drafted description beside every figure that is a picture, and a person deciding the rest. You get the changed document and the report.';
  }
}

/**
 * A price and the sentence saying what it buys, or a refusal and the reason.
 *
 * Nothing in this module returns a number on its own. That is deliberate:
 * a price without its promise is the failure mode this whole file exists to
 * prevent, and the type makes writing one awkward on purpose.
 */
export function quoteFor(offer: Offer, work: Work): Quote {
  const reach = reachOf(work.format, work.tier);
  const promise = work.tier ? promiseFor(work.tier) : WORD_PROMISE;

  if (offer === 'assessment') {
    return { available: true, offer, cents: 0, lines: [{ label: 'Assessment', cents: 0 }], promise };
  }

  if (reach === 'nothing') {
    return {
      available: false,
      offer,
      because:
        'There is no text in this document to assess — it is pictures of words. It needs OCR first, which 508This does not do, and there is nothing here worth charging for until that has happened.',
    };
  }

  if (offer === 'statement') {
    return {
      available: true,
      offer,
      cents: PRICES.statement,
      lines: [{ label: labelFor(offer), cents: PRICES.statement }],
      promise,
      caveat: caveatFor(reach, offer),
    };
  }

  if (reach === 'metadata') {
    return {
      available: false,
      offer,
      because:
        'This PDF has no tag tree, so there is no structure to edit and nothing to attach a description to. The language and title can be set and that is the whole of it — not enough work to charge remediation for, and not sold as though it were. Building the tag tree is a person deciding what every mark on the page is, and 508This does not do that yet.',
    };
  }

  const extra = Math.max(0, work.figures - PRICES.figures.included);
  const base = certifiable(reach) ? PRICES.remediation.certifiable : PRICES.remediation.partial;
  const lines: QuoteLine[] = [{ label: labelFor(offer), cents: base }];
  if (extra > 0) {
    lines.push({
      label: `${extra} ${extra === 1 ? 'figure' : 'figures'} beyond the first ${PRICES.figures.included}`,
      cents: extra * PRICES.figures.each,
    });
  }

  return {
    available: true,
    offer,
    cents: lines.reduce((n, l) => n + l.cents, 0),
    lines,
    promise,
    caveat: caveatFor(reach, offer),
  };
}

/** The best offer the service will sell for this document. */
export function bestOffer(work: Work): Offer {
  for (const offer of ['remediation', 'statement'] as const) {
    if (quoteFor(offer, work).available) return offer;
  }
  return 'assessment';
}

/** Every offer, quoted, in the order a customer reads them. */
export function quoteAll(work: Work): Quote[] {
  return OFFERS.map((offer) => quoteFor(offer, work));
}

/**
 * The warning that has to travel with the price. A document the service
 * cannot certify is the case where a customer could reasonably believe they
 * are buying conformance, so that is the case that says otherwise in as
 * many words.
 */
function caveatFor(reach: Reach, offer: Offer): string | undefined {
  if (certifiable(reach)) return undefined;
  if (reach === 'metadata') {
    return 'This document cannot be made conformant by 508This. The statement will say so, and it will say exactly why.';
  }
  return offer === 'remediation'
    ? 'The figures will be described and the file will improve. It will still not conform, because it has no heading structure and creating one is a person deciding what every paragraph is. Nobody should buy this expecting a conformant document.'
    : 'The statement will say this document does not conform, because it has no heading structure.';
}

const WORD_PROMISE =
  'A Word document. Nearly everything Section 508 asks about is readable and rewritable in the file itself, which makes this the format 508This can take furthest.';

/**
 * The work in a job, as the price sees it.
 *
 * The figure count is every figure detection found without a description,
 * decided or not. Counting only the open ones would make the price fall as
 * the reviewer worked, which is a quote that changes while somebody is
 * reading it.
 */
export function workFor(job: { format: Format; tier?: Tier; findings: readonly Finding[] }): Work {
  return {
    format: job.format,
    tier: job.tier ?? null,
    figures: job.findings.filter((f) => f.kind === 'image-alt').length,
  };
}

/** `4900` to `$49`, and `14900` to `$149`. Whole dollars where they are whole. */
export function money(cents: number): string {
  if (cents === 0) return 'Free';
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** One sentence: the price, and what it is for. Never the price alone. */
export function describeQuote(quote: Quote): string {
  if (!quote.available) return quote.because;
  const head = `${labelFor(quote.offer)}: ${money(quote.cents)}.`;
  const extra = quote.lines.length > 1 ? ` ${quote.lines[1]?.label} at ${money(PRICES.figures.each)} each.` : '';
  return `${head}${extra} ${describeOffer(quote.offer)}${quote.caveat ? ` ${quote.caveat}` : ''}`;
}
