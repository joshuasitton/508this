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

## Intake

`/start` is one form with one file input and no client JavaScript. The
browser posts, the server action checks and redirects, and a problem comes
back as a query parameter rendered in a live region. That is deliberate: a
form that needs a script to submit is a form some assistive technology cannot
submit, and an accessibility service's front door has to open for everyone.

The checks in `src/domain/job.ts` run in the order a person can act on – pick
a file, pick a Word file, pick a smaller one – and the zip signature last,
because the most common bad upload is a legacy `.doc` renamed to `.docx`. The
name says Word; the bytes say otherwise; the person gets the sentence that
tells them to open it in Word and save it again, rather than a zip error
from three layers down. Each problem has exactly one sentence, in the same
file as the check, for the reason `findings.ts` keeps status and wording
together.

The size limit is 25 MB in the domain and 26 MB in `next.config.ts`, so the
domain's friendlier message fires before the framework's generic one.

---

## Word detection

`src/domain/docx.ts` takes the XML text of a document's parts and returns
findings. It does not take the file: unzipping is `src/server/docx.ts`'s job,
and the split is what lets every check run under `npm test` against XML
written inline in the test, with nothing installed. It is also why every
check is deterministic. A finding here can be reproduced from the document
alone. Alternative text a model *drafts* is a proposed fix, not a finding,
and belongs to the review queue.

Seven checks, each named for the criterion it serves:

- **2.4.2 Page Titled** – no `dc:title` in the core properties. Blocking: a
  screen reader announces the filename instead.
- **3.1.1 Language of Page** – no default language in the style defaults or
  the settings. Blocking: pronunciation is guessed.
- **1.1.1 Non-text Content** – a drawing with no `descr` and no decorative
  mark. Word's decorative flag is honoured, because an image marked
  decorative is correctly silent and flagging it would make the customer
  write alt text for a border.
- **1.3.1 Info and Relationships** – a table whose first row is not marked
  as a header row; a heading that skips a level; a document of twenty or more
  paragraphs with no headings at all. Heading level comes from the style's
  outline level, not its name, because that is what assistive technology
  reads and templates rename styles freely.
- **2.4.4 Link Purpose** – link text that is "click here", a bare URL, or
  nothing.
- **1.4.3 Contrast** – a coloured run against its shading, or the paragraph's,
  or white, below 4.5:1 (3:1 for 18pt, or 14pt bold). Reported once per
  paragraph and colour pair, not once per run, or a paragraph with forty runs
  of the same grey would produce forty findings.

Locations are paragraph numbers in document order, tables included, with a
short quotation, because a .docx has no pages until it is laid out and a
reviewer finds a place by its words. The quotation is the customer's own text
going into the customer's own report. It goes nowhere else.

The XML reader (`src/domain/xml.ts`) is our own and matches elements by local
name. A document round-tripped through another editor can write the main
namespace under a different prefix, and a detector that looked for the
literal string `w:tblHeader` would miss a header row that is there.

### Reading order and language, without a person

Two criteria that looked like judgement calls turned out to have
deterministic rules in Word, and moved from "reviewer" to "checked".

**1.3.2 Meaningful Sequence.** A screen reader reads a Word document in body
order. That order is wrong only when text lives somewhere else: a floating
text box, a positioned frame, or a table being used to put prose side by
side. Each of those is findable. Text boxes are `w:txbxContent`; frames are
`w:framePr`; a layout table is borderless, has more than one column, and has
a cell with more than one paragraph of text – conservative on purpose,
because a data table with borders switched off is rare and a false flag
costs a reviewer's time on every document. A document with none of these
reads in order by construction, and the report says so.

Word writes every text box twice, once in `mc:Choice` for modern readers and
once in `mc:Fallback` for old ones, with the same content. Everything under
a Fallback is invisible to every check, or each box, link, image and run in
one would be found twice. Paragraphs inside a box are not body paragraphs
either; they are located by their box, and the box's text is not part of the
paragraph it floats in. The first version got both wrong and the test for
this is the one that caught it.

**3.1.2 Language of Parts.** A passage in a language other than the
document's has to be marked, so the screen reader switches voice.
`src/domain/language.ts` finds those passages with no dependency: script
first (Han, Hangul, Cyrillic, Arabic, Thai, Devanagari decide the language
outright), then function words – the, of, and, to; el, la, de, que; le, les,
des – counted against short lists for the languages that turn up in US
federal documents. Function words are the right signal because they are
frequent, closed-class and nearly disjoint between languages once a passage
has twenty of them.

The thresholds are conservative. The criterion itself exempts proper names
and borrowed phrases, so "prepared by José García de la Cruz" must not flag
and neither must "de facto" or "ad hoc"; a passage has to be twenty words,
score clearly, and beat the document's own language by a margin. The tests
hold both those sentences quiet and a Spanish paragraph loud. Detection is
symmetric: in a Spanish document, the English paragraph is the one flagged.

The fix is deterministic: every run with text in the flagged paragraph gets
`w:lang` with the tag Word writes for that language (es-US, fr-FR, zh-CN in
the East Asian slot, ar-SA in the bidi slot), existing run properties kept.
Re-detection then finds nothing, which is the contract.

### What detection cannot see

Images of text (1.4.5), colour as the only signal (1.4.1), instructions that
rely on shape or position (1.3.3), and whether alt text is *good* are
judgement calls. They are the reviewer's,
and later a model's to propose. A check that guessed at them would produce
findings nobody can act on and, worse, a clean report on a document that
still fails.

---

## What "Supports" is allowed to mean

The report's honesty line is `DOCUMENT_COVERAGE` in `src/domain/criteria.ts`.
A criterion with no findings is not thereby met. It is met on one of three
bases, and each criterion is assigned one:

- **checked** – an automated check in `docx.ts` looked and found nothing.
  Eight criteria, plus 4.1.1 Parsing, which the reader itself vouches for.
- **static** – a Word document with no interactive or time-based content has
  nothing the criterion governs: keyboard traps, timing, flashing, focus,
  forms, captions. Twenty-two criteria. The detector emits a `media` or
  `forms` finding if it sees a recording or a form field, which moves the
  criterion out of this class for that document.
- **reviewer** – only a person can tell: colour as the only signal,
  instructions that rely on shape or position, images of text, whether
  headings describe their sections. Four criteria.

A reviewer-class criterion nobody has confirmed is **Needs Review** in the
report, never Supports. That is not a VPAT term and the statement says so in
its footnote. The alternative – counting "nobody looked" as "Supports" – is a
false statement to a federal buyer, and the verdict therefore has three states,
not two: does not conform yet; passes every automated check but N criteria
wait on a reviewer; conforms. The middle one is the honest one, and it is the
one a document lands on after automatic remediation. A test pins that with
nothing confirmed, an empty findings list is *not* conformance.

---

## Remediation

`src/domain/remediate.ts` fixes what has one right answer and leaves the rest.
Marking a table's first row as its header, setting the document language,
closing a skipped heading level, darkening a grey until it meets 4.5:1: each
is a change detection can verify afterwards. Alternative text, link wording
and which bold paragraphs are really headings have no single right answer,
and a confident wrong one is worse than a finding, so those go to a reviewer.

The contract with the job store is the honest part. After remediation the
output is re-detected, and a finding is marked remediated **only if
re-detection no longer finds it** – not because a fix claims to have handled
it. What re-detection still finds stays open; anything new it finds is added.
A fix that broke something cannot hide.

Some particulars, each the answer to a way the first version was wrong:

- The output is the original archive with the changed parts written over
  it, not a reconstruction. Images, fonts, numbering and comments are carried
  across byte for byte; a run on a real document changes two parts of
  eighteen.
- `src/server/zip.ts` writes the real CRC for every entry, from `node:zlib`.
  Word opens an archive with a wrong CRC as "corrupt", which is the one thing
  a remediation service cannot hand back. A test reads the CRCs out of both
  headers and checks them.
- The heading fix pulls a level *up* to the previous plus one, in document
  order, so H1 → H3 → H3 → H5 becomes H1 → H2 → H3 → H4 without flattening
  the outline. If the style it needs does not exist, one is added in the shape
  Word's built-in headings take.
- The contrast fix bisects along the line from the colour to black (or white
  on a dark fill) for the smallest change that passes, and drops any theme
  colour on the run, which would otherwise override the literal. #999999 on
  white lands on #767676, the well-known just-passing grey.
- A document with no `docProps/core.xml` gets one, registered in the content
  types and the package relationships, because a title nothing can find is
  not a title.

The XML goes through `parseXml` and back through `serializeXml`; a test pins
that the round trip is a fixed point, so a remediated document differs from
the original only where a fix touched it.

### Kicking it off, and what comes back

One button on the job page, disabled when nothing on the page can be fixed
without a person. It runs the fixes, stores `remediated.docx` beside the
original, re-detects, and sends the customer back to the same page, which now
offers the remediated document, the original, a list of what was changed, and
the conformance statement. The download names the file "report (remediated)
.docx" so it never overwrites the original on the customer's disk, and the
customer's filename goes through a quoted, escaped header and nowhere near a
path.

`/jobs/[id]/report` is the conformance statement: every criterion, its level,
its conformance and its remark, in the layout of an Accessibility Conformance
Report, printable, with the three-state verdict on top. It is rendered by the
same functions as the job page. When nothing is open and nothing waits on a
reviewer it says "Conforms to Section 508", and not before.

---

## Reading the result

The job page is the report, and it is written in the order a customer asks
the questions, not the order the standard lists its clauses.

**The verdict first.** "Does not conform to Section 508 yet", then one sentence
with the numbers: how many of the criteria it owes have open issues, how many
issues, how many are blocking. A person who reads nothing else knows where
they stand. `summarise` and `describeSummary` in `findings.ts` produce it.

**Findings grouped by kind, not by criterion.** A criterion number means
everything to a specialist and nothing to a communications lead, and one
criterion covers different problems: 1.3.1 is both a table without a header
row and a heading that skips a level, which have different causes and
different fixes. So every finding carries a *kind* as well as a criterion.
`src/domain/kinds.ts` is the table of kinds, and each owns three sentences:
its name in plain words, why it matters to someone using assistive technology,
and what we do about it. The page groups by kind, blocking first, then the
kinds with the most places to fix. The ACR still scores by criterion. A test
pins that every kind maps to a criterion in the catalogue and that every
finding the detector emits carries a kind, so the report cannot group a
finding under one heading and score it under another.

**The criteria it meets are there, but not first.** The conformance table
lists only the shortfalls, in the Supports / Partially Supports / Does Not
Support wording a buyer expects, with the remarks the ACR will carry. The
criteria it already meets sit under a native disclosure, because the report is
a claim about all of them and a buyer may want to see the passes, but
twenty-eight rows of "no open issues" are not the news. The four E205.4
exemptions are a footnote, named, so nobody wonders why the count is 34.

**State is a word, not a colour.** Each place is labelled Blocking, Open or
Fixed in text, with a border and no fill, so the page passes 1.4.1 Use of
Color on its own report.

---

## Storage, and why it is one file

`src/server/jobs.ts` writes each job under `documents/<id>/` on local disk,
or under `DOCUMENTS_DIR`. It is right for development and for the first jobs
run by hand on one machine, and wrong for Vercel, whose filesystem does not
persist. It stays that way until the Chairman has decided retention; then it
is the one file to replace. Two rules from `CLAUDE.md` live here as code: the
job id is the only thing that ever becomes a path, and no error raised in
this module carries document content, so whatever logs it cannot leak it.

The job page reads through the same module, so what the customer sees is
whatever the store says and nothing else.

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
- Intake, Word detection, remediation, the job page and the conformance
  statement, above. Run end to end in a browser against the production build
  before merging, and the downloaded file checked with an independent reader;
  `docs/build-state.md` says what was checked.
- A landing page that renders the catalogue from the domain – partly so the
  list a customer reads is the list the report is built from, and partly to
  prove on the first page that `src/domain/` has no idea React exists.
- CI: test (before install), typecheck, lint, build.

### Architecture

```
src/app/         App Router – pages, layout, styles. Imports from src/domain and src/server.
src/domain/      Pure TypeScript. No React, no Next, no Node APIs.
src/server/      Node only – node:zlib, node:fs – and nothing from npm.
__tests__/       node:test against src/domain and the pure parts of src/server.
scripts/         ts-resolve.mjs, the loader hook that makes npm test work bare.
docs/            build-state.md, the sprint, and the standup log.
```

The order to build the rest is in `docs/sprint-2026-09-17.md`: remediation
of the deterministic findings, proposed alternative text, the review queue,
then delivery as a fixed .docx, a tagged PDF and the ACR. PDF intake comes
after all of that; an untagged PDF has no structure to fix, only to rebuild,
and it is the hardest version of the product.

---

## Tests

```bash
npm test
```

Each test says in a comment *why* the behaviour is the behaviour, naming the
failure it prevents. A test that only asserts is half a test; the next person
cannot tell whether a red run means a bug or a changed decision.
