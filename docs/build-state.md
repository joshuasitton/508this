# 508This — Build State

The running project-level record. Sections are dated and kept in order rather
than rewritten, so the reasoning stays readable. Decisions live in
`docs/leadership-standup.md`; this file says where the code stands.

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
