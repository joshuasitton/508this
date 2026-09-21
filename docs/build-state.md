# 508This — Build State

The running project-level record. Sections are dated and kept in order rather
than rewritten, so the reasoning stays readable. Decisions live in
`docs/leadership-standup.md`; this file says where the code stands.

## 2026-09-21 — Retention decided; what it obliges the code to do

The Chairman settled retention (`docs/leadership-standup.md`). Nothing is
built yet; this records what the code now owes, so the next commits are
measured against it rather than against a memory of a conversation.

| Decided | What the code owes |
|---|---|
| Deletion seven days after download | A sweep in the job store, and a delivery timestamp to count from |
| The record scrubbed at delivery | Findings keep their `location` – the quotation inside it does not. The Word detector's `where()` is the only place that writes one |
| One figure to a vision model, ZDR | A pass-through endpoint, the key server-side only, a cropped image in and a draft out, nothing stored or logged |
| Never for a CUI document | A flag on the job, set at intake, that the vision path checks before it runs |
| v1 accepts CUI | Accounts and audit logging, which 800-171 requires and which were previously deferred to v1.1 |

**The one that is easy to miss:** the job record is not free of document
content. `where()` in `src/domain/docx.ts` writes the customer's own sentence
into every Word finding, because a reviewer finds the place by eye. PDF
findings are page numbers and are already clean. Deleting documents while
keeping a record of their sentences would be a policy with a hole in it.

**The one that reorders the sprint:** accepting CUI makes a reviewer an
account rather than a typed name. Yesterday's change, which moved that name
out of fifteen form fields and onto the job record, is the seam it goes
through — which is luck rather than foresight, and worth saying so.

## 2026-09-18, late — PDF triage, before building any more

The Chairman said the documents will mostly be PDFs. That changes the
roadmap more than any code did today: a PDF is four different products
wearing one file extension, and the tagged PDF export that was next in the
sprint only matters when the input is a `.docx`.

`npm run triage -- <folder>` classifies a folder into scan / untagged /
tagged / structured and prints what the service can honestly promise for
each. `src/domain/triage.ts` is the pure part, `scripts/triage.ts` walks the
folder. It prints counts, page numbers and tags and **no document content**:
it runs on the customer's machine over federal records, and the output is
the kind of thing that gets pasted into a chat. 162 tests.

**Why it was built before the next feature.** Structure editing only reaches
the tagged and structured tiers. The share of real documents in those two
decides whether the next build is heading levels in a tag tree or a
different offer entirely, and two files is not a sample – the two in hand
are one of each.

**What the two known files say:**

```
HK-Hokua-LogoIdeas-v01.pdf      untagged     1 page,  0 figures,  0 paragraphs,  4 issues
VA_CHERP_Infographic_v6.pdf     tagged       1 page,  4 figures, 12 paragraphs,  6 issues
```

**The finding behind it.** The infographic's tag tree was read directly: 12
`P`, 13 `Span`, 7 `Sect`, 4 `Figure`, and InDesign role-maps a single
`NormalParagraphStyle` to `P` for every paragraph. There are no headings in
the structure because there were none in the source. Promoting one to `H2`
is not the one-field edit alt text was: the `Figure` elements are indirect
objects (25, 26, 27), which is why `/Alt` works, but the paragraph elements
are **inline dictionaries inside their parent's `/K` array** with no object
number to anchor to. It needs a path anchor, a rewrite of the parent object,
and per-paragraph text extraction – content-stream parsing and ToUnicode
decoding – so a reviewer can see which paragraph they are promoting. That is
the biggest single piece since the reader, and it is not worth starting
until the triage says what share of documents it would reach.

## 2026-09-18, night — one name field, and where the name lives

Found by demonstrating the product, not by a test. The review queue asked for
the reviewer's name in a hidden field on every decision form, so on the VA
infographic – four undescribed figures, three forms each – there were
**fifteen “Your name” boxes on one screen**, under a heading promising “type
it once; each button below carries it”. The field at the top of that section
was inert: it carried `form="none"` and submitted nothing.

`setReviewer` in the job store is now the only thing that writes the name,
and `decideAction` and `confirmAction` read it back from the record instead
of taking it from the form. `reviewerName` in `domain/job.ts` normalises it
in one place, because the same string is printed into the job record and into
a text run of the Word conformance report, which rejects control characters
outright. The decision controls appear only once there is a name; before
that the findings are listed to read with a line saying what unlocks them.
Handing over is a form under a disclosure, and decisions already made keep
the name they were made under. 154 tests.

**Verified in the browser**, because that is where the bug was: one name
input before identifying and one after (the handover form), **zero hidden
name fields**, thirteen decision buttons and seven Confirm buttons that only
appear once a name exists, a decision correctly attributed with no name field
in its form, and a handover that leaves the earlier decision attributed to
the earlier reviewer.

**A regression caught in the same pass:** `.reviewerLine` was a flex
container from when it held a label beside an input. Leaving it flex once it
became a sentence put every text node in its own flex item, so the name sat
on one line and “. This name goes on the statement” began the next. It is a
plain paragraph now.

## 2026-09-18, night — the statement as a Word file

`src/domain/acr.ts` computes the Accessibility Conformance Report from a job:
the facts, the verdict, one row per criterion, the notes, and whether it is a
statement or a draft. `src/domain/acrDocx.ts` writes it as WordprocessingML
by hand — document, styles, relationships, content types, core properties,
no template file checked in — and `src/server/acr.ts` encodes and zips it.
`/jobs/<id>/report/download` serves it; the report page and the job page link
to it. 148 tests.

**The report page no longer computes anything.** It was building its own
criterion table alongside the one the Word file would build, which is the bug
this repository keeps finding in other clothes: one concept, two definitions.
Both renderings now lay out `buildAcr` and decide nothing.

**Verified.** The whole way round in `__tests__/acrDocx.test.ts`: build the
report, zip it, unzip it, read the parts, run `detectDocx`, expect no
findings — for a Word job, a PDF job, a job with open findings and a
remediated one. A negative control was run against each fix in turn (strip
the language, the title, the header rows, the heading styles) and each
produced exactly the finding it should, so the green is not green because the
test is looking at nothing.

Then through the production build in Chromium: the infographic uploaded,
fixed, its statement downloaded as a .docx and opened with python-docx —
title, language `en-US`, eight headings, five tables, 38 criterion rows, every
first row a header row. Then the strongest check available: **that generated
report was uploaded back into the running product as a customer document, and
came back "Passes every automated check — no open issues"**, with the four
reviewer criteria outstanding, which is the honest verdict for a Word file
nobody has read yet.

**Word and not PDF**, deliberately. The customer's next move is to paste the
statement into a proposal or their own VPAT, and a PDF is where text goes to
stop being editable. Nothing in the file is marked by colour either: tinting
the rows that wait on a reviewer would be a 1.4.1 failure of exactly the kind
the report flags in other people's documents.

## 2026-09-18, evening — PDF remediation

`src/domain/pdfWrite.ts` (serialization and `incrementalUpdate`),
`src/domain/pdfRemediate.ts` (language, title, display-title, and a
reviewer's alternative text by structure-element object number), `writePdf`
in `src/server/pdf.ts`, and `rebuildPdf` in the job store on the same
contract as the Word path. The fix button is offered for both formats.
126 tests.

**Verified** on both real files through the production build: uploaded,
fixed, downloaded, and the downloads opened with an independent library.
Language, title and display-title all set; the original preserved byte for
byte with 311 and 380 bytes appended; text still extracting; the tag tree
untouched.

**A bug the tests could not see:** the string helper returned the delimited
form and the serializer wrapped it a second time, so a file came back with
its language set to "(en-US)". Found by reading the output with another
library. The convention is now content bytes in, delimiters added by
`serialize`, with a round-trip test over accented, Japanese and
astral-plane text.

## 2026-09-18, later — PDFs are read, checked and reported

`src/domain/pdf.ts` (the parser: object grammar, classic and stream cross
references, PNG predictors, object streams, `/Prev` chains, scan-to-rebuild
recovery), `src/server/pdf.ts` (inflate), `src/domain/pdfDetect.ts` (the
checks), three PDF finding kinds, `PDF_COVERAGE` and a per-format
`ContentKind`. Intake accepts `.pdf` and checks the `%PDF` signature.
111 tests.

**Verified** against the two real contractor files, in the browser on the
production build. The logo sheet: four findings, three blocking, led by the
missing tag tree. The infographic: six findings across four figures with no
alternative text, no headings, and a title that is never displayed. Both show
seven criteria waiting on a reviewer and the statement says "Non-web document
(PDF)". The Word flow still reaches "Conforms to Section 508", checked in the
same run.

**A regression caught by that browser run, not by the tests:** a bulk rename
of the `'document'` content kind to `'docx'` also renamed the upload form's
field, so every upload of either format came back "Choose a document to
upload". The domain tests all passed. The browser is the only thing that saw
it.

**Next:** writing fixes back into a PDF, by incremental update.

## 2026-09-18 — The review queue

`/jobs/[id]/review` with its actions; `Decision`, `isOpen`, `findingKey`,
`stateOf` and dismissal-aware assessments in `findings.ts`; `applyDecisions`
in `remediate.ts`; `decide` / `undecide` / `confirm` / `unconfirm` and the
single `rebuild` path in the job store; anchors on image and link findings;
`REVIEW_INPUT` in `kinds.ts`. The job page links to the queue and shows
dismissals; the statement names the reviewer. Stacked on the sensory PR.

**Verified end to end** in Chromium: upload, fix, decide alt text and a link
rewrite (both land in the downloaded file), dismiss a sentence with a
reason, confirm four criteria, and the verdict reads "Conforms to Section
508" with the reviewer's name on the statement.

## 2026-09-18 — Sensory and colour screens

`src/domain/phrases.ts` (the patterns and sentence splitter), four kinds
(`sensory`, `colour-words`, `colour-only`, `chart`), the checks in
`docx.ts`. 1.3.3 and 1.4.1 remain "reviewer" with their remarks naming the
screen. 90 tests. No OCR engine here, so 1.4.5 is unchanged.

## 2026-09-17, night — Reading order and language of parts

`src/domain/language.ts` (the detector), reading-order and layout-table
checks and the language check in `docx.ts`, the language fix in
`remediate.ts`, `FIXABLE_KINDS` exported from there and read by the job
page. 1.3.2 and 3.1.2 are "checked" in `DOCUMENT_COVERAGE`; four criteria
remain "reviewer". 82 tests.

**Verified** on a python-docx file with an English paragraph, a Spanish
paragraph and a paragraph of Spanish names: one finding, on the Spanish
paragraph; remediation marks its runs es-US and leaves the others; the
output passes an independent CRC check and re-detects clean.

## 2026-09-17, evening — Remediation and the conformance statement

On the same branch. `src/domain/remediate.ts`, `src/server/zip.ts`,
`remediateJob` in the job store, the button and downloads on the job page,
and `/jobs/[id]/report`. `DOCUMENT_COVERAGE` in `criteria.ts` and the
"Needs Review" status in `findings.ts` are the honesty line; the standup log
records why.

**Verified end to end** on the production build in Chromium: upload a
python-docx document with six issues, press the button, four are fixed and
two (alt text, link text) correctly remain; the verdict moves from "does not
conform" to "does not conform" with two open and six waiting on a reviewer;
the download is named "(remediated)"; the statement lists 38 rows with six
Needs Review. The downloaded file: `zipfile.testzip()` clean, python-docx
opens it, title / header row / Heading 2 / #767676 / language all present,
16 of 18 parts byte-identical to the input.

**Next:** the review queue, which is now the critical path to a document
that can be reported as conformant. Then the ACR as a Word file and the
tagged PDF export.

## 2026-09-17, later — Intake and Word detection

On the `intake/word-detection` branch, stacked on the founding PR.

**What exists now, beyond the founding scaffold:**

- `src/domain/xml.ts`: a reader for Office Open XML, matching by local name.
  Own code rather than a dependency, so the detector still runs bare.
- `src/domain/contrast.ts`: WCAG 2.0 contrast. Used by the detector and by a
  test that recomputes the site's own token ratios.
- `src/domain/docx.ts`: the Word detector. Parts in, findings out.
- `src/domain/job.ts`: the job record, accepted formats, the upload checks
  and their sentences.
- `src/server/unzip.ts` and `src/server/docx.ts`: bytes to parts, on
  `node:zlib`, refusing what Word never writes.
- `src/server/jobs.ts`: the local-disk job store under `documents/` or
  `DOCUMENTS_DIR`. One file to replace when storage is decided. `next build`
  warns that its dynamic path causes whole-project tracing; that is the cost
  of a filesystem store and goes away with it.
- `/start` and `/jobs/[id]`. No client JavaScript on either.

**Verified end to end** on the production build with Playwright: a renamed
legacy .doc is refused with the right sentence; a sample report with seven
planted issues produces exactly those seven findings at the right paragraphs;
the report table shows 34 owed criteria; the first Tab lands on the skip
link; unknown and traversal-shaped job ids return 404.

**The report page, second pass.** After the first run on Josh's Mac, the
result was restructured for reading: verdict first, findings grouped by kind
with plain-language "why" and "what we do" sentences owned by
`src/domain/kinds.ts`, the shortfall table before a disclosure of the criteria
met, and a "what happens next". Checked in light and dark schemes and at phone
width, with a clean heading outline and no horizontal scroll.

**Next, in order:** see `docs/sprint-2026-09-17.md`.

## 2026-09-17 — Founded

**Where the code lives:** <https://github.com/joshuasitton/508this>, `main`.
The first scaffold arrived on the `claude/beautiful-ritchie-blsjv4` branch and
its pull request.

**What exists:**

- Next.js 16 App Router, TypeScript, ESLint with `eslint-config-next` (which
  brings the jsx-a11y rules), no Tailwind. Plain CSS with design tokens in
  `src/app/globals.css`, because an accessibility product's styles have to be
  read by the people auditing it and a utility class soup is not that.
- `src/domain/criteria.ts` and `src/domain/findings.ts`, with tests, run by
  Node's built-in runner through `scripts/ts-resolve.mjs`.
- A landing page that renders the catalogue from the domain.
- CI on GitHub Actions: test, typecheck, lint, build, on Node 22.

**What does not exist yet, in the order it should be built:**

1. Intake – an upload form and the job record it creates. Blocked on the
   retention decision in the standup log; the form can be built, the handler
   that stores a file cannot.
2. Detection – reading a PDF's tag tree, text layer, alt text and reading
   order into findings. This is where the product is hard.
3. The review queue – a person confirms or edits each proposed fix.
4. Delivery – the remediated document and the Accessibility Conformance
   Report, generated from `assessAll` and `describeAssessment`.

**Environment:** Node 22 is enough (`--experimental-strip-types` arrived in
22.6). npm is reachable from the cloud session for this repository, which is
not true of Loadsy's; do not assume it holds in every session.
