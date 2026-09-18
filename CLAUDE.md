@AGENTS.md

# 508This — orientation for Claude Code

508This is a Section 508 remediation service. A customer sends a document –
PDF, Word, PowerPoint – and gets back a version that conforms to the Revised
Section 508 Standards, with an Accessibility Conformance Report that says so
and can be handed to a federal buyer. Next.js (App Router) + TypeScript; this
repository is the whole product, client and server.

**`README.md` is the real document.** It argues why each non-obvious decision
is what it is. Read the section covering whatever you are about to touch before
you touch it. This file is the short orientation; it does not repeat the README.

The line at the top pulls in `AGENTS.md`, which `next dev` writes and re-adds.
Leave both where they are; the Next.js in `node_modules` is newer than any
training data and its docs under `node_modules/next/dist/docs/` win.

## Commands

```bash
npm test              # domain tests — Node's built-in runner, no framework
npm run typecheck     # tsc --noEmit
npm run lint          # eslint, including the jsx-a11y rules
npm run dev           # http://localhost:3000
npm run build         # what Vercel runs
```

## Where things are

| Path | What lives there |
|---|---|
| `src/app/` | App Router pages and layouts, one folder per route; `jobs/[id]/review` is the queue |
| `src/domain/` | pure functions: the criteria catalogue and coverage, findings, the Word and PDF detectors, the Word remediator, the PDF reader, the job model, the conformance report |
| `src/server/` | Node-only code: the zip reader and writer, the .docx part reader, the PDF reader's inflate, the job store, the report packer |
| `__tests__/` | tests, against the domain layer and the server layer's pure parts |
| `scripts/ts-resolve.mjs` | lets Node run the TypeScript domain with no bundler |
| `docs/` | project-level state and the leadership standup log |

## Invariants — do not break these silently

- **`npm test` runs with zero dependencies installed.** Nothing under
  `src/domain/` may import React, Next or a Node API; `src/server/` may use
  Node's own modules and nothing from npm. This is what makes the build
  verifiable from a sandbox with no npm access, and it is worth keeping.
- **One source of truth per concept, pinned by a test.** `domain/criteria.ts`
  is the list of what "508 conformant" means – WCAG 2.0 A and AA, 38 criteria,
  plus the E205.4 exception for non-web documents. `domain/findings.ts` owns
  both a criterion's status *and* the sentence that states it in the report.
  A value defined in two places drifts; it drifted repeatedly in Loadsy.
- **Coverage is per format, and so is what may be claimed.** `COVERAGE` in
  `domain/criteria.ts` has a table for each of `docx` and `pdf`, because they
  can be checked for different things: a PDF's text colour lives in a content
  stream nobody here interprets, so contrast is a reviewer's job for a PDF
  and a machine check for a Word file. Never report one format against the
  other's table.
- **"Supports" is never said on nothing.** `DOCUMENT_COVERAGE` in
  `domain/criteria.ts` gives every criterion a basis – an automated check, a
  static document having nothing the criterion governs, or a reviewer – and a
  reviewer-class criterion nobody has confirmed reads "Needs Review". The
  verdict has three states and the middle one, "passes every automated
  check", is where a document lands after remediation. Collapsing it into
  "Conforms" is a false statement to a federal buyer.
- **A finding is remediated only when re-detection no longer finds it.**
  `rebuild` in `src/server/jobs.ts` is the one path: original, automatic
  remediation, the reviewer's applied decisions, re-detection. It marks
  findings from re-detection, never from what a fix or a button claims.
  Every change to a job's record goes back through it. Keep it that way.
- **A dismissal is a judgement, not a change.** A reviewer can dismiss a
  finding with a reason; that removes it from the count and puts the name
  and reason in the report. It never touches the document.
- **The reviewer's name lives on the job, not on a form.** `setReviewer` is
  the only thing that writes it; `decideAction` and `confirmAction` read it
  back from the record rather than trusting a field the form supplied. It was
  a hidden input on every decision form once, which put fifteen “Your name”
  boxes on one screen and two copies of one fact that could go out of step –
  and the fact is whose name goes on a representation to the government.
  Changing the reviewer never rewrites decisions already made.
- **The catalogue is WCAG 2.0, not the newest WCAG.** The regulation
  incorporates 2.0 by reference. Adding a 2.1 or 2.2 criterion makes the report
  claim a legal requirement that does not exist. If a customer wants 2.2, that
  is a separate, labelled scope, not a change to this list.
- **The product must itself pass what it sells.** Every page meets WCAG 2.0 AA:
  real headings, a skip link, visible focus, `lang` on the document, contrast
  checked. `npm run lint` carries the jsx-a11y rules and they are not to be
  disabled. A remediation service with an inaccessible website is over.
- **Customer documents are the customer's.** They are federal, often
  sensitive, sometimes Controlled Unclassified Information. Nothing about a
  document's contents goes into a log, an analytics event or an error report.
  Where they are stored, for how long, and whether any of it leaves the
  service is a decision that waits on the Chairman (see the standup log) – do
  not make it in code by accident. `src/server/jobs.ts` is the local-disk
  store for development and hand-run jobs; it is the one file to replace,
  and nothing that stores a document in production merges before the decision.
- **A remediated file is the original with changes appended or overlaid,
  never a rebuild.** `writeDocx` writes changed parts over the original
  archive; `incrementalUpdate` appends changed objects and a new cross
  reference to a PDF, matching the original's cross reference kind. Both keep
  every untouched byte, which is the honest answer to "what did you do to my
  document".
- **The conformance report is one model with two renderings.**
  `domain/acr.ts` computes the statement from the job; the report page and
  the Word file (`domain/acrDocx.ts`) lay out what it produced and decide
  nothing – not a status, not a remark, not the date. The customer reads one
  and hands over the other, and the two saying different things about the
  same document is the failure this product cannot survive.
- **The conformance report must itself pass `detectDocx`, and a test says so.**
  `__tests__/acrDocx.test.ts` builds the report, zips it, unzips it and runs
  the detector over it, expecting nothing. That is why the file carries a
  title and a language, why its headings are real and unskipped, why every
  table names its header row – and why **nothing in it is marked by colour**.
  Tinting the rows that wait on a reviewer would be a 1.4.1 failure of the
  exact kind the report flags in other people's documents.
- **Never put a secret in a `NEXT_PUBLIC_` variable** — they are bundled into
  the browser in plaintext.

## Environment

Compiling and running are jobs for Josh's own Terminal, which is where Claude
Code runs, so run them. Cloud sessions can reach npm through a proxy in this
project's environment, which is more than Loadsy's could; a failing
`npm install` in a cloud session is still not a bug in the repo.

## Conventions

- **Commit subjects are a sentence** saying what changed and why it matters.
  No `feat:` / `fix:` prefixes.
- **Branches are `area/what`**: `domain/acr-export`, `intake/upload-limits`.
  `main` is the default branch.
- **Documentation here argues; it does not list.** When you add to the README
  or to `docs/`, explain the reasoning and name the failure the decision
  prevents.
- Prose in this repo uses en dashes and real punctuation. Match it.
- **Never pipe `npm run build` or `npm run typecheck` into `head`.** The pipe
  closes, the command takes SIGPIPE, and it dies partway through having
  printed enough to look successful. It cost a debugging round when
  `next start` then reported no production build, and a type error in a test
  reached the build because a truncated `typecheck` had "passed". Redirect to
  a file and grep that.

## How the project is run

Josh is Chairman of the Board and the sole human authority. 508This is run the
way Loadsy is: an AI-operated company with a standing leadership team whose
round-tables are logged in `docs/leadership-standup.md`. Anything marked
"decision needed" there waits on Josh; nothing in that file is a commitment
until he makes it one.
