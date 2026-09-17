# 508This

**Send us the document. Get it back conformant.**

508This is a Section 508 remediation service. A customer uploads a PDF, Word or
PowerPoint document; the service finds everything in it that fails the Revised
Section 508 Standards, fixes it, and returns the fixed document with an
Accessibility Conformance Report that a federal buyer will accept. Next.js
(App Router) + TypeScript. This repository is the whole product.

`CLAUDE.md` is the short orientation for anyone – or anything – arriving cold.
`docs/build-state.md` is where the project stands, `docs/leadership-standup.md`
is the decision log. This file is the reasoning behind the code.

---

## Getting it running

```bash
npm install
npm run dev
```

That opens the app on <http://localhost:3000>. Node 22.6 or later; nothing else
is needed, and there is no backend to point at yet.

The domain tests need no install at all:

```bash
npm test
```

They run on Node's built-in test runner, with TypeScript stripped by Node itself
and extensionless imports resolved by `scripts/ts-resolve.mjs`. The reason to
keep them dependency-free is practical: a session with no npm access – and
cloud sessions for Loadsy have never had it – can still prove the domain layer
correct, and a change that adds a dependency to the domain is caught by CI
running `npm test` *before* `npm ci`.

---

## What the product is, and is not

**A remediation service, not a checker.** The Chairman decided this at founding
(standup, 2026-09-17). A checker's output is a list of problems; the customer
still has to fix them, and the buyer still cannot accept the document. A
remediation service's output is the document itself, conformant, with the list
attached as proof. That decision shapes everything below: the unit of work is
a *job*, the things in it are *findings*, and a finding exists to be *closed*.

**Documents first.** The domain distinguishes `'web'` from `'document'` content
because the standard does (see the exception below), but whether 508This ever
takes a web page is an open question in the standup log. The product need not
offer everything the domain can model.

---

## What "conformant" means, and why the list is frozen

The Revised Section 508 Standards (36 CFR Part 1194, Appendix A, in force
since January 2018) do not define their own technical criteria for content.
E205.4 incorporates **WCAG 2.0 Level A and Level AA** by reference: 25 Level A
criteria and 13 Level AA, 38 in all. That list is `src/domain/criteria.ts`, and
a test pins the count.

It is deliberately WCAG **2.0**, not 2.1 or 2.2. Later versions add criteria
that are good ideas and are not the law. A report that marked a document "Does
Not Support" on 2.4.11 Focus Not Obscured would be asserting a legal
requirement that does not exist, and a customer who believed it would pay for
work they do not owe. Some agencies do ask for 2.1 or 2.2 AA in solicitations;
if 508This ever reports against those, it is a separate, labelled scope with its
own catalogue, never an addition to this one. `appliesTo` returns `false` for
any id outside the catalogue for the same reason: unknown ids must not
silently count.

### The E205.4 exception

Four criteria – 2.4.1 Bypass Blocks, 2.4.5 Multiple Ways, 3.2.3 Consistent
Navigation, 3.2.4 Consistent Identification – are about navigating a *set* of
web pages, and E205.4 says outright that non-web documents need not meet them.
`DOCUMENT_EXEMPT` holds those four, `appliesTo` applies the exemption, and
nothing else in the code is allowed to know about it. A document with a finding
mis-filed under 2.4.1 is still Not Applicable on 2.4.1: the standard exempts
it, and our bookkeeping does not get a vote. The test for that is the one to
read first.

---

## Findings and the report

`src/domain/findings.ts` owns two things that must never be split up: the
**status** a criterion gets in the report, and the **sentence** that states it.

The status vocabulary is the one federal buyers expect from the VPAT 2
template: Supports, Partially Supports, Does Not Support, Not Applicable. The
rules are small and the tests state them in full:

- A criterion with no *open* findings Supports. Remediated findings do not
  count, because the report describes the document we deliver, not the one we
  received. Counting them would mean a perfectly remediated document could
  never be reported conformant, which is the one thing the customer buys.
- One `partial` finding makes Partially Supports; any `blocking` finding makes
  Does Not Support. A scanned PDF with no text layer is blocking on 1.1.1; one
  chart without alt text is partial.
- An exempt criterion is Not Applicable for a document, whatever is filed
  against it.

`describeAssessment` and `describeFinding` are the only places those sentences
are written. When the wording changes, one test changes. Loadsy's history has
several bugs that were the same bug – a value defined in two places that
drifted apart – and the status/sentence pair is exactly the kind of thing that
does.

`progress` reports 0 of 0 as complete, not `NaN`. A clean document has nothing
left to do, and "NaN%" on the best possible outcome would be the first thing a
customer noticed.

---

## The site must pass what it sells

Every page of 508This meets WCAG 2.0 AA, and that is an invariant, not an
aspiration. Concretely:

- `lang="en"` on the document (3.1.1); a skip link that is the first focusable
  element on every page (2.4.1 – the *site* owes it even though the documents
  it remediates do not); one focus ring, defined once in `globals.css` and
  never removed (2.4.7); real headings, tables with captions and scoped
  headers (1.3.1).
- The colour tokens in `globals.css` carry their contrast ratio in a comment,
  in both schemes, so a change can be checked by reading. Nothing below 4.5:1
  is used for text (1.4.3).
- `eslint-config-next` brings the jsx-a11y rules and `npm run lint` fails on
  them. They are not to be disabled, per file or per line, without the reason
  written next to the disable.

Plain CSS with tokens, no Tailwind: an auditor reading this site's styles
should be able to find the focus ring and the contrast pairs in one file.

---

## Customer documents

Documents sent to 508This are federal records – often sensitive, sometimes
Controlled Unclassified Information. Two things follow now, and one waits.

Now: nothing about a document's *contents* goes into a log, an analytics
event or an error report, ever. And `/documents/` is gitignored as a whole
folder, so no real agency PDF can become a "test fixture" with a commit hash.

Waiting on the Chairman: where documents are stored, for how long after
delivery, and whether any part of one is ever sent to a third-party model. The
intake form can be built before that is answered; the handler that stores a
file cannot be merged.

---

## What's built

- The Next.js scaffold, ESLint, TypeScript in strict mode with
  `noUncheckedIndexedAccess`.
- The criteria catalogue and the findings model, tested.
- A landing page that renders the catalogue from the domain – partly so the
  list a customer reads is the list the report is built from, and partly to
  prove on the first page that `src/domain/` has no idea React exists.
- CI: test (before install), typecheck, lint, build.

### Architecture

```
src/app/         App Router – pages, layout, styles. Imports from src/domain.
src/domain/      Pure TypeScript. No React, no Next, no Node APIs.
__tests__/       node:test against src/domain.
scripts/         ts-resolve.mjs, the loader hook that makes npm test work bare.
docs/            build-state.md and the standup log.
```

The order to build the rest is in `docs/build-state.md`: intake, detection,
the review queue, delivery. Detection – reading a PDF's tag tree, reading
order and text layer into findings – is where the product is hard, and it is
the reason the findings model came first: it is the contract detection has to
fill.

---

## Tests

```bash
npm test
```

Each test says in a comment *why* the behaviour is the behaviour, naming the
failure it prevents. A test that only asserts is half a test; the next person
cannot tell whether a red run means a bug or a changed decision.
