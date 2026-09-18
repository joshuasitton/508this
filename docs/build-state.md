# 508This — Build State

The running project-level record. Sections are dated and kept in order rather
than rewritten, so the reasoning stays readable. Decisions live in
`docs/leadership-standup.md`; this file says where the code stands.

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
