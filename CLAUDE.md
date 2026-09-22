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
npm run triage -- DIR # classify a folder of PDFs; prints no document content
npm run sweep         # delete the documents whose retention window has run out
```

## Where things are

| Path | What lives there |
|---|---|
| `src/app/` | App Router pages and layouts, one folder per route; `jobs/[id]/review` is the queue |
| `src/domain/` | pure functions: the criteria catalogue and coverage, findings, the Word and PDF detectors, the Word remediator, the PDF reader, the job model, the conformance report, the triage, the prices, and the identity, session and audit policy |
| `src/server/` | Node-only code: the zip reader and writer, the .docx part reader, the PDF reader's inflate, the job store, the report packer, and the account, session, password and audit stores |
| `__tests__/` | tests, against the domain layer and the server layer's pure parts |
| `scripts/ts-resolve.mjs` | lets Node run the TypeScript domain with no bundler |
| `docs/` | project-level state and the leadership standup log |

## Invariants — do not break these silently

- **`npm test` runs with zero dependencies installed.** Nothing under
  `src/domain/` may import React, Next or a Node API, and **no file any test
  imports may take an npm dependency.** `src/server/` is Node's own modules
  and nothing from npm, with exactly one exception: `src/server/vision.ts`
  imports the Anthropic SDK, because it is the one module that talks to
  something outside this service and writing an HTTP client by hand to
  preserve a slogan would be worse than the slogan is worth. No test imports
  it – `src/server/jobs.ts` reaches it through `await import('./vision')`
  inside `propose`, precisely so the SDK stays out of the test suite's
  import graph. A static import there was the first attempt and **CI caught
  it on the first push**, which is the guarantee working and the reason it
  is stated as a property of the import graph rather than as a claim about
  one file. Add a second such module only with the same two properties: no
  test reaches it, and `npm test` still passes with `node_modules` absent –
  which is worth checking by actually moving the folder aside, since that is
  what CI does.
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
- **Four functions in `src/server/jobs.ts` touch a customer's bytes, and
  nothing else does.** `readRecord`, `writeRecord`, `readBlob`, `writeBlob`.
  That is what makes encryption at rest a property of the store rather than
  something nine call sites remember, and it is the seam an object store
  replaces.
- **Everything stored is sealed with AES-256-GCM, with the job id as
  associated data.** A blob moved into another job's directory will not
  open. The authentication matters as much as the secrecy: a job record
  decides who may open a document. No key means plaintext in development and
  a refusal in production; a blob written before a key existed still opens.
- **The retention clock starts at download, not at upload**, and taking the
  delivered file also scrubs the record. `RETENTION_DAYS = 7`. A document
  nobody downloads has no deletion date — a named gap, not an oversight.
  `npm run sweep` deletes what is due; **the record outlives the file.**
- **The detectors quote the document inside curly quotes, and that is
  load-bearing.** `scrubText` finds the customer's words by them. A detector
  that quotes with straight quotes puts a sentence where the scrub cannot
  reach, and a test says so.
- **Customer documents are the customer's, and retention is now decided.**
  Nothing about a document's contents goes into a log, an analytics event or
  an error report. The Chairman settled the rest on 21 September 2026
  (`docs/leadership-standup.md`), and these are the lines code must hold:
  documents are deleted seven days after the customer downloads the package;
  **the job record is scrubbed of its quotations at delivery**, because the
  Word detector puts the customer's own sentences in every finding and a
  record full of them is retention by another name; a single figure's image
  may go to a vision model under zero data retention and **nothing else ever
  leaves** – never the whole document, never its text; and **never anything
  at all for a document the customer marks CUI**, because zero data retention
  is a storage commitment and not a FedRAMP authorisation.
- **v1 accepts CUI, so a reviewer is an account and not a typed name.** The
  Chairman's decision brings NIST SP 800-171 into scope, and identification
  and authentication is one of its controls. `setReviewer` taking a name a
  person types is right for a service run by one person and is not
  authentication; it is the seam where real accounts go. Nothing that stores
  a CUI document in production merges before that exists. It exists:
  `src/domain/account.ts`, `session.ts`, `audit.ts`, `viewer.ts` and their
  server modules.
- **An audit record has no free-text field, and `auditEvent` throws on a
  subject that is not a UUID.** 800-171 wants records sufficient to trace a
  user's actions; this file's oldest rule says no document content reaches a
  log. The two pull apart the moment somebody adds a `detail` field and a
  dismissal note — which quotes the customer — lands in it. There is nowhere
  for prose to go, a test proves it by trying, and adding a field that takes
  text breaks the guarantee rather than extending it.
- **A failed sign-in answers one way and costs one price.** Wrong
  passphrase, unknown address and disabled account all return `'no'` and all
  spend the same scrypt work (`spendTime`), because a fast answer is an
  answer: it says there is no such account, and the customer list is worth
  something. What really happened goes to the audit log. The email index is
  keyed by SHA-256 for the same reason.
- **Every job has an owner, and `createJob` requires one.** An account or a
  visitor — one browser, one cookie, no name — and never neither. A record
  with no owner fails closed. A visitor may upload and read their own
  assessment; marking CUI, deciding anything, remediating and downloading
  all need an account, which is the same line `pricing.ts` draws between
  the free assessment and everything bought.
- **`src/server/access.ts` is the only door onto a job, and a test counts
  the doors.** Nothing under `src/app/` calls the job store to reach one; a
  test walks the directory and fails on any import of `@/server/jobs`
  outside a three-name allowlist. "Not yours" and "no such job" are the same
  404 with the same page, because telling a stranger a document exists tells
  them who the customer is.
- **A letter is a fixed template plus at most one link, and the link must be
  on our own origin.** `letterFor` in `src/domain/mail.ts` throws otherwise.
  A reset link is a credential, so a template that renders whatever link it
  is handed is a phishing page with our return address on it — and the same
  hole is how a filename or a finding's text gets mailed out of the building.
  No free-text field, same as the audit record.
- **The origin in a link comes from `PUBLIC_BASE_URL`, never from a request
  header.** `src/server/origin.ts` refuses to guess in production. A reset
  link built from the `Host` header is a credential mailed to the right
  person pointing at somebody else's server.
- **A reset lasts thirty minutes, is spent on use whether or not the new
  passphrase was accepted, and ends every session the account has.** People
  reset because they think somebody else has the passphrase; leaving that
  session alive makes it theatre.
- **Mail goes out by HTTPS `fetch`, never SMTP and never a package**, and
  falls back to `accounts/outbox/` when unconfigured — which is **refused in
  production**, because a service quietly writing reset links to local disk
  looks like it is working.
- **A session token is never stored, only its SHA-256.** A leaked session
  file is then not a set of live sessions. Fast hash here, scrypt for
  passphrases: a token is 256 bits of randomness and cannot be guessed, so
  the cost would buy nothing and be paid on every request.
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
- **A drafted description is a proposal and never a fix.** `propose` in the
  job store writes `finding.proposal` and changes nothing in the document;
  only a reviewer pressing apply, under their name, turns it into a
  decision. The screen says a draft was written by a model every time it
  shows one. A wrong description is a finding, not a remediation, and the
  service's promise is conformance.
- **One figure's image is all that ever leaves.** `src/server/vision.ts` is
  the only module that talks to anything outside this service. It sends the
  picture and the instruction, never the document, its text, its filename or
  a Word file's XML – and **`propose` refuses outright for a job marked
  `cui`**, before any of that, because zero data retention is a storage
  commitment and not a FedRAMP authorisation. The review page also hides the
  button for such a job, but the page is a thing a person can navigate
  around and the store is not.
- **A reviewer is shown the figure they are describing.** `/jobs/<id>/figure`
  serves it from the customer's own document, private and no-store, above
  the box they type in. This is what makes a drafted description reviewable
  rather than rubber-stamped, and it is not optional garnish: without it the
  screen asks a person to vouch for a sentence about something they cannot
  see. When there is no picture, the same place says why.
- **A figure has no stored image more often than it has one, and is now
  drawn instead.** PDF artwork out of Illustrator or InDesign is vector —
  three real files, eighty-odd figures, not one raster image. `src/server/
  render.ts` draws it with pdf.js, and **the crop is the whole safety
  argument**: it renders one figure, never a page, because a rendered page
  is a picture of the page's text and that may not leave. The box comes from
  the tag tree (`figureBox`), PDF/UA requires it on a figure, and **no box
  means no render** — the reviewer is told, exactly as before.
- **The renderer is Apache-2.0 and MIT, not AGPL.** `pdfjs-dist` and
  `@napi-rs/canvas`. MuPDF renders better and linking it into a commercial
  service means publishing the service. Both load through `await import`
  from a file no test imports, and both are in `serverExternalPackages`
  because a native binding cannot be bundled.
- **A price is never returned without the promise it buys.** `quoteFor` in
  `src/domain/pricing.ts` hands back the number and the sentence together,
  and nothing in the repository returns the number alone. `PRICES` is one
  table; a price written into prose — a refusal, a page, a caveat — is a
  price nothing keeps in step with it, and a test asserts the refusals carry
  no price literal. The invariant underneath: **no tier the service cannot
  certify is charged the certifiable price**, with a negative control so the
  test cannot pass by refusing everything.
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
