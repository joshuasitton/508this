# 508This — Build State

The running project-level record. Sections are dated and kept in order rather
than rewritten, so the reasoning stays readable. Decisions live in
`docs/leadership-standup.md`; this file says where the code stands.

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
