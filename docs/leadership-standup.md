# 508This — Leadership Standup Log

Running log of leadership round-tables. Newest first. Josh is Chairman of the
Board and sole human authority; every "decision needed" below waits on him.
Entries are kept as they were written – a standup is a record of what the team
believed on a date, and editing it after the fact destroys the only thing it is
for. Where an entry has since been overtaken, `docs/build-state.md` says so.

---

## 2026-09-18, late — "mostly PDF" changes the company, not just the sprint

### What the Chairman said

The documents will mostly be PDFs.

### What that means, plainly

The sprint was built around Word, on the reasoning that a `.docx` is XML and
nearly everything the standard asks about is readable and rewritable. That
reasoning is sound and now largely irrelevant. Tagged PDF export – next in
the plan this morning – only matters when the input is a Word file, and has
been dropped from the front of the queue.

The harder consequence, which the team should not soften: **on the two real
PDFs in hand, the service cannot make either one conformant.** The
infographic goes from six open findings to four and the logo sheet from four
to two, and both remain, correctly, non-conformant. A business whose inputs
are mostly PDFs is a business whose product, as built, improves documents it
cannot certify.

### Decided by engineering, for the Chairman to overturn

**Triage before more engineering.** `npm run triage` classifies a folder of
real documents into scan, untagged, tagged and structured. The share in the
last two is the share that any structure editing could ever reach. Two files
is not a sample, and the two in hand are one of each. Building heading-level
editing on a guess about that ratio is how a remediation service ends up
able to fix the files nobody sends.

**What the service may say per tier lives in the code**, in
`promiseFor(tier)`, not in sales copy – so it cannot drift from what the
software does. Two of the four tiers say in as many words that the document
cannot be certified, and a test holds them to it.

### The decision that is no longer queued

**Pricing for untagged PDFs is not a pending item any more; it is the
offer.** If most documents arrive untagged, "508This makes your document
conformant" is false for most customers, and what replaces it has to be
decided before anyone is sold anything. Marketing and sales both wait on
this, and so does the landing page.

### What was asked of the Chairman, and could not be done

He asked for the PDF folder on his desktop to be used. This session runs in
a cloud container, not on his Mac, and cannot reach it. Building the triage
as a command he runs locally is the better answer anyway: the files are
federal records, retention is still undecided, and the repository's own rule
is that a customer document's contents never leave the box. The triage
prints counts and tags and nothing else.

---

## 2026-09-18, late — what a demo found that the tests did not

### Done

The review queue asks for the reviewer's name once, and means it. It asked
fifteen times on the Chairman's own infographic, under a heading promising
once.

### Worth the team's attention

**This was found by running the product for somebody, not by a test, and
every test was green while it was true.** 148 of them. What they check is
what the code computes; nobody had looked at the screen with a real document
on it since the queue was built, and the document that exposed it was the
first one with four figures in it. Design's standing request — that a
screen gets looked at with a real customer file before it is called done —
is granted, and `docs/build-state.md` now records the browser check for each
screen rather than only the test count.

**The name moved to the record.** Engineering's reasoning, and it is the
repo's usual one: the name was in two places at once, and the fact in
question is whose name goes on a representation to the federal government.
One writer, one reader, and a decision form that cannot supply a name at all.

**Deciding now waits on a name.** Product's call. A decision nobody's name
is on is not worth recording, so there is nothing to decide with until there
is a name to record it under. The findings are still readable before that;
only the controls wait.

**Handing over does not rewrite history.** A second reviewer taking a job
over is ordinary. Re-attributing what the first one vouched for would be
forging a signature, so decisions keep the name they were made under and a
test pins it.

### Decisions needed from the Chairman

The third contractor file is **withdrawn** at the Chairman's instruction; the
two in hand are the scope. Retention and third-party calls, and pricing for
untagged PDFs, are unchanged and still with him.

---

## 2026-09-18, night — the deliverable is a file

### Done

The conformance statement now downloads as a **Word file** from the job page
and the statement page. It is built from the same model the screen renders,
so the copy the customer reads and the copy they hand to a contracting
officer cannot disagree.

### Decided by product and engineering, for the Chairman to overturn

**Word, not PDF.** Sales argued for PDF on the grounds that it looks final.
Product's answer carried: the customer's next move is to paste the statement
into a proposal, into their own VPAT, or into the spreadsheet of criteria
their compliance office keeps, and a PDF is where text goes to stop being
editable. A remediation service handing over an inaccessible PDF of its own
conformance report is the second reason, and the one that would end up in a
screenshot.

**An unconfirmed statement is stamped a draft.** Design asked for the draft
banner to be dropped from the downloaded file, on the grounds that it makes
the deliverable look unfinished to the customer's buyer. Refused: it looks
unfinished because it is. A statement with criteria nobody has confirmed is
an honest working document and a dishonest deliverable, and the moment it can
leave the building without saying so is the moment the product starts lying
for the customer instead of for them. Confirming the four criteria takes a
reviewer minutes; the banner disappears on its own.

**Nothing in the report is marked by colour.** Raised by design as a
readability question and settled on the standard: the rows waiting on a
reviewer are the obvious thing to tint, and tinting them would be a 1.4.1 Use
of Color failure of the exact kind the report flags in other people's
documents. The status word carries it.

### The engineering note worth keeping

The report is a document, so it is held to the product's own standard: a test
builds the .docx, unzips it and runs the Word detector over it, expecting
nothing. Then the generated report was uploaded back into the running product
as if a customer had sent it, and came back clean. Marketing may use that; it
is true and it is checkable.

### Decisions needed from the Chairman

Unchanged from this evening.

1. **The third contractor file, still not arrived.** The two attached again
   this afternoon are byte-identical to the two already in hand. Sales cannot
   scope the third case, and if it is a scan rather than a document it is a
   different product: there is no text to fix, only OCR to run, and no version
   of this service makes that file conformant without someone retyping it.
2. **Retention and third-party calls.** Still the gate on production storage
   and on the next build step: model-drafted alternative text means sending a
   customer's figure to a vision model, and nothing leaves the box until the
   Chairman says what may.
3. **Pricing for untagged PDFs.** Unchanged, and the logo sheet is still the
   worked example.

---

## 2026-09-18, evening — PDFs are fixed as well as checked

### Done

Writing fixes back into a PDF, by incremental update: the original bytes are
untouched and the changed objects are appended with a new cross reference. On
the Chairman's two files the whole change is about 350 bytes on the end of a
file of 400 KB or 1 MB, and both open in an independent reader with the
language, the title and the display-title flag set and every word of text
still extracting.

The logo sheet goes from four open findings to two; the infographic from six
to five. Neither reaches conformance, correctly: what is left is a missing tag
tree, missing headings and four figures with no description, and none of those
has one right answer.

### Decided by the engineering lead, for the Chairman to overturn

**Automatic tagging of an untagged PDF is not on the roadmap as an automatic
fix.** It is not remediation with one right answer; it is deciding what every
mark on a page is and in what order a person reads it. It belongs to a
reviewer with a tool, and that tool is a larger product than the one being
built. This is the same line already drawn at alternative text, and the logo
sheet is the proof it sits in the right place.

### Decisions needed from the Chairman

1. **The third file**, described but never attached.
2. **Retention**, still the gate on production storage.
3. **Pricing for untagged PDFs**, sharper now: the service can improve an
   untagged file but cannot make it conformant, and a customer has to be told
   that before they pay rather than after.

---

## 2026-09-18, later — Real contractor files arrive, and they are PDFs

The Chairman sent example contractor files the app has to handle. He
described three; two arrived: an Adobe Illustrator logo sheet and an InDesign
infographic for a VA research centre. **Both are PDFs.** The third has not
been seen and may change the picture again.

### What they showed

- The infographic is tagged and still fails: four figures with no alternative
  text, no headings at all, and a title the reader is never told to display.
  Its entire structure tree lives inside an object stream, so a reader that
  could not open object streams would have reported it clean. That is the
  most dangerous failure this product can have and it was one library
  feature away.
- The logo sheet is untagged. Tags are the only structure a PDF has, so it
  fails at the first hurdle and nothing in it can carry a description until
  it is tagged.

### Decided by the engineering lead, for the Chairman to overturn

**PDF moves ahead of PowerPoint and ahead of the ACR as a Word file.** The
sprint deferred PDF on the reasoning that an untagged PDF has no structure to
fix, only to rebuild. That reasoning still holds for remediation and is
wrong for *detection*: both files produce accurate, useful findings today,
and the customers who exist send PDFs. Reading and reporting landed this
session; writing fixes back is the next branch.

**Coverage is now per format.** A PDF cannot be checked for the things a Word
file can – contrast is the clear case, since a PDF paints text with content
stream operators rather than naming a colour. Seven criteria need a person
for a PDF against four for a Word file. Reporting a PDF against the Word
table would have claimed seven checks that never ran.

### Decisions needed from the Chairman

1. **The third file.** It was described but not attached.
2. **Retention** – still open, still the gate on production storage, and now
   more pressing: these are a real agency's files.
3. **Untagged PDFs: scope and price.** Tagging a document from nothing is not
   the same job as fixing a tagged one, and the logo sheet is the cheap end
   of it – one page, one figure. A forty-page untagged report is a different
   product. Recommended: price them separately from the start.

---

## 2026-09-18 — The review queue

### Done

The screen that stands between a remediated document and one that can be
reported as conformant. A person decides each open finding – alternative
text or a decorative mark for an image, new wording for a link, both
written into the document; a dismissal with a reason for everything else –
and confirms the four criteria only a person can judge. Their name is asked
once and goes on the statement. Every decision rebuilds the delivered
document from the original and re-detects it, so the record never says more
than the document shows. When nothing is open and nothing waits, the job is
delivered and the statement says "Conforms to Section 508", under the
reviewer's name. That sentence was unreachable before today.

### Decided by the engineering lead, for the Chairman to overturn

- **The reviewer is a typed name, not an account.** Right for a service one
  person runs; wrong the day there are two. Accounts are the change when a
  second reviewer exists.
- **Judgement findings take a dismissal only.** The fix for "click the
  button on the left" is a change to the prose, which a person makes in
  Word. The queue records the judgement and does not pretend to edit prose.

### Decisions needed from the Chairman

1. **Retention and third-party calls** – now on the critical path. The next
   step drafts alt text with a vision model, which sends an image out. The
   recommended posture is unchanged: only the fragment a fix needs, never a
   whole document, nothing retained by the provider.
2. **The first customer document.** The pipeline is complete end to end for
   Word. Sprint item 9 – ask one team for one document – is now the highest
   leverage thing anyone can do.

---

## 2026-09-18 — The judgement criteria, screened

### Done

- **1.3.3 and 1.4.1 are screened.** Pattern checks find every sentence
  whose instruction depends on a position, shape, size or sound, and every
  sentence that uses colour as the signal; a markup check finds text set
  apart by colour alone; every embedded chart is flagged. The criteria stay
  reviewer-class – a match needs a person's judgement and a non-match is not
  proof – but the reviewer now reads the flagged sentences, not the
  document. Verified on a python-docx file: the instruction on the left,
  the fields marked in red, the red deadline and the green/amber/red status
  line are found; "see the table below" and "the Red Cross" are not.
- **1.4.5 Images of Text waits.** OCR needs an engine and none is available
  without a dependency. It joins the vision-model pass that the review
  queue brings.

### Next

The review queue. Every finding kind now exists; what is missing is the
screen where a person confirms, edits or dismisses each one, and confirms
the four reviewer criteria, so that a document can be reported as
conformant.

---

## 2026-09-17, night — Two of the six reviewer criteria turn out to be checkable

The Chairman asked whether the six criteria left to a reviewer were really
not automatable. The answer: mostly they are, to a proposal; what is not
automatable is the assurance. Two have deterministic rules in Word and were
moved to "checked" tonight; the rest are model proposals for the review
queue to present.

### Done

- **1.3.2 Meaningful Sequence is checked.** Reading order is document order
  unless text is in a floating box, a frame, or a layout table, and each of
  those is found. Word's duplicate fallback markup for text boxes is now
  invisible to every check; the first version found each box twice.
- **3.1.2 Language of Parts is checked and fixed.** A zero-dependency
  language detector (script, then function words, conservative thresholds
  that keep names and borrowed phrases quiet) finds passages in another
  language, and remediation marks every run in them with the tag Word
  writes. Verified on a python-docx file with an English and a Spanish
  paragraph: the Spanish one is found, marked es-US, and re-detection is
  clean; the paragraph full of Spanish names is left alone.
- The reviewer bucket is now four criteria: 1.3.3, 1.4.1, 1.4.5, 2.4.6.

### Next, in the order recommended to the Chairman

1. Pattern checks for 1.3.3 (sensory instructions) and 1.4.1 (colour-only
   emphasis), and OCR for 1.4.5 – detection only.
2. The review queue, with model-drafted proposals for alt text, link text
   and headings, one-click accept. The assurance stays with a person and the
   conformance statement keeps a person's name.

---

## 2026-09-17, evening — Remediation, and what the report is allowed to claim

### Done today

- **Remediation** of what has one right answer: title, language, table
  header rows, skipped heading levels, contrast. One button on the job page;
  the output is re-detected and a finding counts as fixed only if
  re-detection no longer finds it. On a real Word file the run changes two of
  eighteen parts and the rest are byte-identical. The downloaded file passes
  an independent CRC check and opens in python-docx with the title, header
  row, heading level and colour as claimed.
- **The conformance statement** at `/jobs/[id]/report`: every criterion,
  level, conformance and remark in the layout of an ACR, printable.

### Decided by the engineering and security leads, for the Chairman to overturn if he disagrees

**The report never says "Supports" on nothing.** The first version marked
every criterion without a finding as Supports, including the twenty-eight no
check had looked at. That is a false statement to a federal buyer. Every
criterion now has a basis – checked, static, or reviewer – and the six
reviewer-class criteria read "Needs Review" until a person confirms them. The
verdict has three states, and a document lands on the middle one after
remediation: "passes every automated check; six criteria wait on a
reviewer". It cannot reach "Conforms to Section 508" until the review queue
exists and someone has used it. This is slower to a headline the customer
wants and it is the only headline the company can stand behind.

### Decisions needed from the Chairman

1. **Retention** – still open, still the gate on production storage.
2. **The default document language is en-US** when none is set. Right for
   federal documents; wrong for a Spanish-language notice. The intake form
   could ask. Recommended: ask only when the reviewer flags it.
3. **The review queue is now the critical path.** Nothing can be reported as
   conformant without it. Recommended as the next build, ahead of PDF export.

---

## 2026-09-17 — The plan to a first delivered document

### Decided by the Chairman

The Chairman took the plan for delivering on the product's purpose quickly,
in full: Word first, a person reviewing every fix, and the ACR as the
deliverable that makes a buyer accept the document. It is written up as
`docs/sprint-2026-09-17.md`, with a definition of done and the work in order.

The plan included a recommended retention posture – encrypted at rest,
deleted 30 days after delivery, never a whole document to a third-party
model, only the fragment a fix needs. **Recorded here as the working
assumption, not as decided.** The Chairman's "yes" was to the plan; the
retention decision was queued to him separately at founding and stays queued
until he confirms it in so many words. Nothing that stores a document in
production is merged before then; the local-disk store on the intake branch
is for development and hand-run jobs.

### Done today

- Intake: `/start` takes one .docx, checks name, size and signature in the
  order a person can act on, and creates a job. Every problem is one sentence.
- Word detection: seven deterministic checks, each producing findings with a
  paragraph number and a quotation so a reviewer can find the place by eye.
  Title (2.4.2), language (3.1.1), alternative text (1.1.1), table header rows
  and heading levels (1.3.1), link text (2.4.4), contrast of coloured runs
  (1.4.3). All from XML strings, all tested with nothing installed.
- The job page: findings and the conformance table for the 34 criteria a
  document owes, rendered by the functions the ACR will use.
- The site's own contrast claims are now tested. The test found that the
  ratios written beside the tokens at founding were estimates and two were
  wrong; they are now computed values.

### Decisions needed from the Chairman

1. **Retention**, as above. This is the one that gates production.
2. **PDF export path for v1:** LibreOffice headless on the server, or Word on
   a Mac operated by hand for the first customers. The first is automatable
   and produces adequate tags; the second produces better ones and does not
   scale. Recommended: LibreOffice for the sprint, and judge the output.

---

## 2026-09-17 — Founding: what 508This is, and what it is built on

### Decided by the Chairman

1. **508This is a Section 508 remediation service,** not a checker. A checker
   reports; this takes the customer's document and gives back a conformant one,
   with the report as proof. The distinction decides the whole product: the
   unit of work is a remediation job, the output is a document plus an
   Accessibility Conformance Report, and every finding exists to be closed.

2. **Web app, Next.js and TypeScript.** Browser-first, an API layer in the same
   repository, deployable to Vercel. Chosen over React Native, because nobody
   remediates a PDF on a phone, and over a CLI, because the buyer is a
   contracting officer or a communications lead, not a build pipeline.

3. **Loadsy's conventions carry over whole:** sentence commit subjects,
   `area/what` branches, an argued README, zero-dependency domain tests, this
   standup log. One way of working across both companies.

### Done at founding

- The `joshuasitton/508this` repository existed with a one-line README from
  31 August. It now holds the Next.js scaffold, `CLAUDE.md`, the README, and
  the first two domain modules with tests: the WCAG 2.0 A/AA catalogue that
  the Revised 508 Standards incorporate (38 criteria, with the E205.4
  exemption of four set-of-pages criteria for non-web documents) and the
  findings model that turns open and remediated findings into the report's
  Supports / Partially Supports / Does Not Support / Not Applicable vocabulary.
- The landing page renders the catalogue from the domain, so the first page
  already proves the split the invariants demand.

### Decisions needed from the Chairman

1. **Document retention and handling.** Federal documents are often sensitive
   and sometimes CUI. Before the first upload endpoint exists: where are
   documents stored, for how long after delivery, is anything ever sent to a
   third-party model, and does the service need to say so in a customer-facing
   policy? The invariant in `CLAUDE.md` forbids leaking document contents into
   logs, but it cannot decide retention. Nothing that accepts a file should be
   merged until this is answered.
2. **Which formats ship in v1.** PDF is certain – it is most of the market and
   the hardest to remediate. Word and PowerPoint are cheaper to fix and cheaper
   to receive. Recommended: PDF and Word, PowerPoint in v1.1.
3. **How much of the fix is automated.** Tagging structure, reading order and
   alternative text can be drafted by a model and must be reviewed by a
   person; the service's promise is conformance, and a wrong alt text is a
   finding, not a fix. Recommended: human-in-the-loop from day one, with the
   review queue as the second screen built.
4. **Pricing posture.** Per page, per document, or a retainer. This decides
   whether the intake form asks for a page count up front.
5. **The name and the mark.** "508This" is the repository name; whether it is
   the product name, and how it is set, is open.

### Open questions

- Whether to report against WCAG 2.1 or 2.2 AA *as well as* 2.0, since some
  agencies ask for it in solicitations even though 508 does not require it.
  The catalogue invariant says any such thing is a separately labelled scope.
- Whether HTML content (a customer's web page) is in scope at all, or whether
  508This is documents only. The domain already models the difference; the
  product need not offer both.
