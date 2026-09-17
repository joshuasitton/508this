# 508This — Leadership Standup Log

Running log of leadership round-tables. Newest first. Josh is Chairman of the
Board and sole human authority; every "decision needed" below waits on him.
Entries are kept as they were written – a standup is a record of what the team
believed on a date, and editing it after the fact destroys the only thing it is
for. Where an entry has since been overtaken, `docs/build-state.md` says so.

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
