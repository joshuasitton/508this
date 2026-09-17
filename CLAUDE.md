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
| `src/app/` | App Router pages and layouts, one folder per route |
| `src/domain/` | pure functions: the criteria catalogue and coverage, findings, the Word detector and remediator, the job model |
| `src/server/` | Node-only code: the zip reader and writer, the .docx part reader, the job store |
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
- **"Supports" is never said on nothing.** `DOCUMENT_COVERAGE` in
  `domain/criteria.ts` gives every criterion a basis – an automated check, a
  static document having nothing the criterion governs, or a reviewer – and a
  reviewer-class criterion nobody has confirmed reads "Needs Review". The
  verdict has three states and the middle one, "passes every automated
  check", is where a document lands after remediation. Collapsing it into
  "Conforms" is a false statement to a federal buyer.
- **A finding is remediated only when re-detection no longer finds it.**
  `remediateJob` in `src/server/jobs.ts` re-runs detection on the output and
  marks findings from that, never from what a fix claims. Keep it that way.
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

## How the project is run

Josh is Chairman of the Board and the sole human authority. 508This is run the
way Loadsy is: an AI-operated company with a standing leadership team whose
round-tables are logged in `docs/leadership-standup.md`. Anything marked
"decision needed" there waits on Josh; nothing in that file is a commitment
until he makes it one.
