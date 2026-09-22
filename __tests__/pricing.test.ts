import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Finding } from '../src/domain/findings';
import {
  OFFERS,
  PRICES,
  bestOffer,
  certifiable,
  describeQuote,
  money,
  quoteAll,
  quoteFor,
  reachOf,
  workFor,
  type Offer,
  type Work,
} from '../src/domain/pricing';
import { TIERS, type Tier } from '../src/domain/triage';

const pdf = (tier: Tier, figures = 0): Work => ({ format: 'pdf', tier, figures });
const word = (figures = 0): Work => ({ format: 'docx', tier: null, figures });

function priceOf(offer: Offer, work: Work): number {
  const quote = quoteFor(offer, work);
  assert.ok(quote.available, `${offer} should be available for ${work.tier ?? work.format}`);
  return quote.cents;
}

test('every price comes with the sentence saying what it buys', () => {
  const works = [...TIERS.map((t) => pdf(t)), word()];
  for (const work of works) {
    for (const quote of quoteAll(work)) {
      if (!quote.available) {
        assert.ok(quote.because.length > 40, 'a refusal explains itself');
        continue;
      }
      assert.ok(quote.promise.length > 40, `${quote.offer} on ${work.tier ?? work.format} carries a promise`);
    }
  }
});

test('the assessment is free for every document, including the ones nothing can be done with', () => {
  for (const work of [...TIERS.map((t) => pdf(t)), word()]) {
    const quote = quoteFor('assessment', work);
    assert.ok(quote.available);
    assert.equal(quote.cents, 0);
    assert.equal(money(quote.cents), 'Free');
  }
});

test('a scan is not sold anything but the assessment', () => {
  const scan = pdf('scan');
  assert.equal(bestOffer(scan), 'assessment');
  for (const offer of ['statement', 'remediation'] as const) {
    const quote = quoteFor(offer, scan);
    assert.equal(quote.available, false);
    assert.ok(!quote.available && /OCR/.test(quote.because));
  }
});

test('an untagged PDF is sold the statement and refused remediation', () => {
  const untagged = pdf('untagged');
  assert.equal(bestOffer(untagged), 'statement');
  assert.ok(quoteFor('statement', untagged).available);

  const quote = quoteFor('remediation', untagged);
  assert.equal(quote.available, false);
  assert.ok(!quote.available && /no tag tree/i.test(quote.because));
});

/**
 * The invariant this file exists for. A tier the service cannot carry to a
 * conformance claim must not be charged as though it could, and the way
 * that goes wrong is not malice — it is one price constant reused because
 * the two cases looked similar in a hurry.
 */
test('no document the service cannot certify is charged the certifiable price', () => {
  for (const tier of TIERS) {
    const quote = quoteFor('remediation', pdf(tier));
    if (!quote.available) continue;
    if (certifiable(reachOf('pdf', tier))) {
      assert.equal(quote.cents, PRICES.remediation.certifiable);
    } else {
      assert.ok(
        quote.cents < PRICES.remediation.certifiable,
        `${tier} is not certifiable and must cost less than one that is`,
      );
      assert.ok(quote.caveat && /not conform/i.test(quote.caveat), `${tier} says so in the caveat`);
    }
  }
});

/**
 * The negative control. The test above would pass just as happily if the
 * service refused remediation on all four tiers, which would prove nothing
 * about the prices and everything about a broken switch.
 */
test('at least one tier is certifiable, so the test above is not vacuous', () => {
  const sold = TIERS.filter((t) => quoteFor('remediation', pdf(t)).available);
  assert.deepEqual(sold, ['tagged', 'structured']);
  assert.ok(TIERS.some((t) => certifiable(reachOf('pdf', t))));
  assert.ok(certifiable(reachOf('docx', null)), 'a Word file is the case the service takes furthest');
});

test('a Word document is priced as the format the service takes furthest', () => {
  assert.equal(bestOffer(word()), 'remediation');
  const quote = quoteFor('remediation', word());
  assert.ok(quote.available);
  assert.equal(quote.cents, PRICES.remediation.certifiable);
  assert.equal(quote.caveat, undefined);
  assert.match(quote.promise, /Word document/);
});

test('the first ten figures are covered and the rest are priced one by one', () => {
  const flat = PRICES.remediation.certifiable;
  assert.equal(priceOf('remediation', word(0)), flat);
  assert.equal(priceOf('remediation', word(PRICES.figures.included)), flat);
  assert.equal(priceOf('remediation', word(PRICES.figures.included + 1)), flat + PRICES.figures.each);

  // The submission that raised the question: 76 figures, every one of them a
  // decision somebody has to make.
  assert.equal(priceOf('remediation', word(76)), flat + 66 * PRICES.figures.each);
  assert.equal(money(priceOf('remediation', word(76))), '$347');
});

test('figures do not change the price of a statement, because they are not its work', () => {
  assert.equal(priceOf('statement', word(0)), PRICES.statement);
  assert.equal(priceOf('statement', word(76)), PRICES.statement);
});

test('the quote itemises what it is charging for', () => {
  const quote = quoteFor('remediation', pdf('tagged', 12));
  assert.ok(quote.available);
  assert.equal(quote.lines.length, 2);
  assert.equal(quote.lines[0]?.cents, PRICES.remediation.partial);
  assert.equal(quote.lines[1]?.cents, 2 * PRICES.figures.each);
  assert.equal(
    quote.cents,
    quote.lines.reduce((n, l) => n + l.cents, 0),
  );
});

test('the count that moves the price is the figures nobody has described', () => {
  const findings = [
    finding('image-alt'),
    // A figure already decided still counted: a quote that fell while the
    // reviewer worked would change under the person reading it.
    { ...finding('image-alt'), decision: { action: 'dismiss' as const, by: 'J. Sitton', at: '', note: 'decorative' } },
    finding('language'),
    finding('title'),
  ];
  assert.equal(workFor({ format: 'pdf', tier: 'tagged', findings }).figures, 2);
  assert.equal(workFor({ format: 'docx', findings }).tier, null);
});

test('money reads the way a price is written', () => {
  assert.equal(money(0), 'Free');
  assert.equal(money(4_900), '$49');
  assert.equal(money(14_900), '$149');
  assert.equal(money(34_700), '$347');
  assert.equal(money(4_950), '$49.50');
});

test('every offer describes itself, and the descriptions do not repeat', () => {
  const said = OFFERS.map((o) => describeQuote(quoteFor(o, word(0))));
  assert.equal(new Set(said).size, OFFERS.length);
  for (const sentence of said) assert.ok(sentence.length > 60);
});

/**
 * A refusal says what cannot be done, and a price written into that prose
 * is a price nothing keeps in step with `PRICES`. So none of them contains
 * one — the argument for not selling something has to stand without a
 * number, and if it needs one, the number comes from the table.
 */
test('a refusal describes itself, and names no price while doing it', () => {
  const said = describeQuote(quoteFor('remediation', pdf('untagged')));
  assert.match(said, /tag tree/i);

  for (const work of TIERS.map((t) => pdf(t, 40))) {
    for (const quote of quoteAll(work)) {
      if (quote.available) continue;
      assert.ok(!/\$\d/.test(quote.because), `the refusal for ${work.tier} carries no price literal`);
    }
  }
});

function finding(kind: string): Finding {
  return {
    kind,
    criterion: '1.1.1',
    severity: 'blocking',
    location: 'somewhere',
    description: 'something',
  } as unknown as Finding;
}
