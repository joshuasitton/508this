# 508This — Build State

The running project-level record. Sections are dated and kept in order rather
than rewritten, so the reasoning stays readable. Decisions live in
`docs/leadership-standup.md`; this file says where the code stands.

## 2026-09-25 — the second clock

72 hours to collect, then the files go. `retention.ts` had named this as its
one open gap since the policy was written — a document nobody downloads had
no clock at all — and the Chairman closed it. 345 tests.

The two clocks sit alongside each other rather than replacing one another,
so a customer who does download still has seven days to fetch the file
again. Untouched documents go 72 hours after upload.

**One refinement the literal instruction did not cover, and it matters.**
Nothing is deleted while a reviewer is working on the document. A clock from
upload deletes the file in the middle of a fortnight's review, which is the
exact failure the 21 September reasoning was written to avoid and which is
still at the top of that file. `reviewer` is set the first time a person
decides anything, so it is precisely the signal for "somebody is working on
this"; the 72 hours start when there is something to collect. **This is
engineering's judgement rather than the Chairman's instruction, and it is
flagged as such.**

`dueAt` is the single place that answers when a job's files go, so the
sweep, the job page and the report cannot drift apart. `daysLeft` returns
null while no clock runs, which is not the same as plenty of time and should
not be rendered as a number.

A test that read `sweepExpired(now)` as `[]` started failing, and it was
right to: a fixture record dated 17 September is genuinely past due under
the new policy. The assertion was implicitly claiming nothing else in the
store could ever be sweepable; it now asks about the job under test.

Verified live, both states: a fresh upload reads *"deleted on 28 September
2026, 72 hours after you uploaded it, unless a review starts before then"*,
and naming a reviewer changes it to *"stays here while it is being
reviewed"*.

## 2026-09-25 — the sentences a reviewer has to judge, found for them

1.3.3 and 1.4.1 keep their reviewer, and the PDF path now flags what the
Word path has always flagged. The same criterion used to mean "confirm
these three sentences" for a .docx and "read the whole document" for a PDF.
`pdfSignals.ts`, over the same `phrases.ts`. 353 tests.

**Colour as emphasis needed a narrower rule than Word's.** Word flags a
coloured run among plain ones, which works because a .docx is mostly plain.
A designed PDF is the opposite — brand colour in every subhead and callout,
none of it "colour as the only means" — so flagging all of it would bury
the reviewer, which is the failure being avoided rather than an edge case
of it. This flags only colour used *inline*: a run differing from the rest
of its own line, at the same size, with no weight to carry it. A coloured
heading is set apart by being a heading.

Measured on the real infographic, which has brand colour everywhere: **one
finding**, `@vaequity`, a handle coloured differently from the words beside
it. That was the risk and it did not materialise.

## 2026-09-25 — 1.3.2, and teaching a check to keep quiet

Meaningful Sequence is checked for a PDF. **A PDF now needs a person for
four criteria — the same four as a Word file.** 341 tests, green with
`node_modules` moved aside.

`readingOrder` in `pdfDetect.ts` walks `/K` for marked-content ids, which
the tree walk beside it skips because it is building elements and a number
is not one. `painted.ts` joins those ids to boxes on the drawn page, and
`pdfSequence.ts` decides. Two independent readers agreeing was the first
good sign: our parser found 32 marked refs on the test file and pdf.js
reported 32 ids.

**Most of the work was in what it refuses to say.** The naive version sorts
blocks top to bottom and calls any difference a failure, which fails every
correct two-column document. A check that cries wolf on correct documents
is worse than none: the reviewer learns to click past it and then misses
the real one. So it reports an inversion no layout could justify — read
later, sitting entirely above an earlier block, clear by more than a line —
and otherwise hands a multi-column page to a person with the column count
named. Superscripts, footnote markers and table cells tagged right to left
all pass, and each has a test saying so.

**Two ways it could have claimed a pass it had not earned**, both closed:
an untagged PDF has no reading order to be wrong (blocking finding saying
so), and a tagged document whose tags cannot be matched to the page would
otherwise pass for want of evidence (escalated).

Verified live and both ways: the tagged infographic reads **Supports** —
and that is a real pass, checked by hand, with 29 of 32 refs joined, one
column, and the tag order tracking steadily down the page — while the
untagged logo sheet reads **Does Not Support**.

Two test expectations of mine were wrong again, not the code: a regex
demanding a double negative, and an assertion that a document of nothing
but bullets should pass when escalating is right.

## 2026-09-25 — two criteria a PDF could not answer, and now can

1.4.3 Contrast and 3.1.2 Language of Parts were **checked** on the Word
path and **reviewer** on the PDF one. The difference was never the
standard: a .docx says `<w:color w:val="767171"/>` and a PDF paints. The
renderer taken on 22 September made the second measurable, and the
arithmetic was already here — `contrast.ts` is pure and knows nothing about
formats. 330 tests, green with `node_modules` moved aside.

A PDF now waits on **five** reviewer criteria instead of seven.

**A claim we were shipping was false.** The PDF remark for 1.4.3 read *"A
PDF paints text with content-stream operators, so this is not measured by
machine."* The premise is true and the conclusion stopped being true when
the renderer landed. It was inside customers' conformance statements.

**Uncertainty escalates; it never silently passes.** A conformance
statement is worth something because "checked" means checked, and a
heuristic that quietly says Supports for the hard cases launders a guess
into a claim the customer sells onward. A run that is not painted on one
solid colour becomes a finding saying so, and the reviewer decides it. The
criterion is still fairly called checked: every run was either measured or
handed to a person, and delivery waits on the person either way.

**Nothing leaves the machine.** Contrast is arithmetic on pixels this
process drew and discards; language detection is local n-grams. No vendor
sees any of it, so both run on documents marked CUI — where the drafting of
alternative text is refused outright.

**Two bugs found by running it on real files, not by reasoning about it.**
The catalogue's `/Lang` is a locale (`en-US`) and the detector answers in
primary subtags (`en`), so every English paragraph in an English document
looked foreign. And the first thing it reported on a real infographic was
a grey full stop — true, useless, and the sort of row that teaches a
reviewer to skim the queue. Text now needs two letters or digits before its
contrast is judged. Both are pinned by tests.

Verified live through the running app: 3.1.2 reads **Supports**, 1.4.3
reads **Partially Supports — 1 open issue (page 1)**, which is the text
painted over the hospital illustration being escalated rather than guessed.

## 2026-09-23 — AWS, and the addressing branch that had no test

The Chairman chose AWS over R2, on the CUI question rather than on price.
`docs/deploy.md` now has the AWS steps: region first because it is inside
every signature, Block Public Access fully on, versioning and Object Lock at
creation, and an IAM policy scoped to the four verbs this service uses.

**The IAM policy has a trap worth knowing about.** `ListObjectsV2` is an
operation on the bucket, so `s3:ListBucket` has to be granted on the bucket
ARN with no `/*`. Granting it on the objects ARN instead fails listing only —
uploads and downloads work, and the retention sweep silently never finds
anything to delete. That is the failure this service would notice last.

**Virtual-hosted addressing had no test**, which mattered because choosing
AWS made it the production path: every existing S3 test sets `S3_ENDPOINT`
and therefore exercises path style. `locate` is exported now, for the same
reason `sign` is, and both branches are pinned — the bucket in the host, the
region in the host, and the empty key that `s3List` uses resolving to the
bucket itself rather than to an object called nothing. 315 tests.

The host is inside the signature, so a wrong region or a wrong host is a 403
that explains nothing rather than a 404 that does. That is the whole reason
this is worth a test rather than a comment.

## 2026-09-23 — `npm run check:store`, and a question the price comparison skipped

`scripts/check-store.ts`. It runs PUT, GET, ListObjectsV2 and DELETE against
a real bucket with the real signature code, then checks that what it wrote
came back sealed and that a sealed object cannot be moved to another key and
still open. One probe object under `check/` — a prefix the retention sweep
cannot see, because it is not a job id — deleted on the way out including out
of a failure. No secret and no bucket contents in the output.

It exists because a mistyped secret, a bucket in the wrong region and a
read-scoped token all deploy cleanly and fail on the first upload, and the
first upload is a federal record.

**Every failure path was exercised here rather than described**: nothing
configured, configured without `STORAGE_KEY`, an endpoint nothing listens on,
a host that does not resolve, a store answering 403, and one answering 404.
`fetch` reports every transport failure as "fetch failed" and hides the cause,
so the unreachable-endpoint case — the likeliest mistake of the six — said the
least by default and now names `ECONNREFUSED` or `ENOTFOUND` and what to check.
Exit code is 1 on any failure, so it can go in a deploy script.

**The question the recommendation skipped.** R2 was recommended on cost, and
this service accepts CUI. The README already draws the line for the model
vendor — a zero-data-retention commitment is not a FedRAMP authorisation —
and the same argument applies to the bucket, which holds the documents rather
than seeing one figure of them. R2 is not FedRAMP authorised; AWS commercial
is Moderate and GovCloud High. `docs/deploy.md` now puts the choice to the
Chairman instead of settling it on price. The code is identical either way;
moving documents that already exist is the part that is not.

`scripts/sweep.ts` had a comment saying nothing in the service has a
scheduler, which stopped being true this morning. Corrected.

## 2026-09-23 — ready to deploy, and the promise that was not being kept

`docs/deploy.md` is the runbook: every variable the code actually reads
(derived by grepping `process.env` out of `src/`, not from memory), the two
orderings that matter, the bucket settings, and four things to check after
the first deploy. 314 tests, green with `node_modules` moved aside.

**The deploy itself is not done, and cannot be from here.** `api.vercel.com`
is denied by this environment's network policy and no Vercel token exists in
it. Everything that does not depend on that is done.

**What was checked rather than assumed**, because these are what break at
deploy time:

- `@napi-rs/canvas` ships a prebuilt `linux-x64-gnu` binary and the lockfile
  carries that platform, so the renderer works on Vercel's Node runtime with
  nothing to install.
- The heaviest route traces to 67 MB against a 250 MB function limit, so the
  build's "dynamic filesystem access causes tracing of the whole project"
  warning costs nothing.
- The production build was run **in the object-store configuration** against
  a local S3-compatible server — the config a deploy uses, not the disk one.
  Sign-up, sign-out, sign-in, a second session and a document upload all
  worked, everything landed sealed under the right prefixes, session records
  and index entries matched one for one, and the job page said *"Stored in
  object storage, encrypted at rest."* — the page told the truth about a
  different store with no code change, which is the seam working.
- With no `STORAGE_KEY`, production **refuses**: sign-up fails through the
  browser, nothing at all is written, and the log names the reason. Checked
  through the browser after a plain form POST turned out not to invoke the
  server action — the first attempt proved nothing.

**The gap the runbook found, and closed.** `sweepExpired` was written, tested
and called by nothing. "Documents are deleted seven days after you download
them" was true of the code and false of the service — a promise in the shape
that reads as kept. `vercel.json` now schedules `/api/sweep` daily; the route
takes Vercel's cron bearer token against `CRON_SECRET` in constant time,
404s everything else including every request when that variable is unset,
and answers with a count rather than the job ids it swept.

It is the one exception to the `access.ts` door, argued in the allowlist:
a sweep has no viewer by construction, and putting it behind the door would
mean giving that door a function that deliberately checks nobody.

**A test expectation of mine was wrong, not the code.** `Bearer <secret> `
with a trailing space is accepted — HTTP defines a header value as trimmed
and the Headers API strips it before the route sees it, so the two are the
same header value. Asserting a refusal would have been asserting a bug. A
trailing `x` is refused.

## 2026-09-22, night — the credentials, and the end of local disk

`accounts.ts`, `sessions.ts` and `resets.ts` are on the blob seam. **Nothing
the service persists is on local disk any more**, which is the sentence that
makes Vercel's ephemeral filesystem survivable. 311 tests, still green with
`node_modules` moved aside.

Each record is sealed with its own key as associated data, and the binding
matters more here than the secrecy does. A passphrase is already a scrypt
hash; what the seal protects is *where a record sits*. A session record is
what the server accepts instead of a passphrase, so one that could be copied
onto the digest of a token an attacker holds is a sign-in as somebody else
without a credential. A reset record names the account its link resets.
Tests move all three and watch them stop opening.

**`endAllSessions` needed an index.** It read every session record in the
service to find one account's — linear and fine on a disk, and against a
bucket a listing of everything plus a fetch each, on the path that runs when
somebody thinks their account is compromised. Now it is an empty object at
`sessions/by-account/<account>/<digest>.json` whose name carries what is
needed. **The entry is written before the record**: an entry with no record
is a no-op to delete, a record with no entry is a session that survives the
reset meant to end it. Every path that ends a session removes both, or the
index becomes a permanent list of every session ever issued — tested.

**A broken seal throws in `accounts.ts` and returns null in `sessions.ts`
and `resets.ts`.** An account is fetched by an id the server resolved, so a
failed check is a real problem and should be loud. A session or reset key
comes from a cookie or a URL, so throwing would turn any forged token into a
500 — a way to knock the service over and a way to tell a stranger their
guess landed on something.

**The development mail outbox stays on disk**, and `ACCOUNTS_DIR` now names
only that. It holds letters carrying live reset links, and in production no
letter is written at all. Moving credentials somewhere more exposed to tidy
a folder would be the wrong trade.

Verified live on both servers. On the production build: sign-up, sign-out,
sign-in, a second session, and the sealed account record reading back with
the audit sequence to match — including `mail.failed`, because production
with no mail token deliberately sends nothing. On the dev server, where the
outbox exists, the whole reset cycle: link minted, followed, passphrase
changed, **the other browser context signed out by the reset** — that is
`endAllSessions` through the new index — old passphrase refused, new one
accepted. Records and index entries matched one for one afterwards.

## 2026-09-22, night — the audit log, one object per event

`src/server/audit.ts` is on the blob seam. It was `appendFile` to one file
per account and that shape does not port: **an object store has no append**,
and the nearest thing — read the log, add a line, write it back — is a
read-modify-write race that loses records under exactly the concurrency an
audit log exists to capture. 302 tests, still green with `node_modules`
moved aside.

**The key carries the order**, because a bucket does not:
`audit/<account>/<time>-<within>-<nonce>.json`. The time is the event's own
`at` with the punctuation stripped, so it is fixed width and sorts
chronologically on both stores and a date range can filter before a single
object is fetched. `within` counts events sharing a millisecond in this
process, so back-to-back records keep the order they were written in — a
file being appended to gave that away free. The nonce is against two
processes writing in the same millisecond: they must not overwrite each
other, and a lost record is worse than an ambiguous ordering between two
genuinely concurrent events, for which there is no true order to lose. The
test that covers this asserts that some of its fifty records really did
share a millisecond, so it cannot pass vacuously on a faster machine.

**Each record is sealed to its own key.** That is the part local disk could
never have: re-file a record under another account's prefix, or rename it
to an earlier time to back-date it, and the associated data changes and it
no longer opens. Tests both ways.

**`history` now returns a count of records that would not open.** The old
file skipped a corrupt line silently, which meant the one thing an audit
log exists to reveal — that something has been got at — was the one thing
it could not say.

**The store root is `store/`, not `documents/`.** Documents and the audit
log share it now, so the folder name had to stop lying; `STORE_DIR` moves
it and `DOCUMENTS_DIR` is still honoured. The retention sweep only ever
looks at keys whose first segment is a job id, so it cannot reach the audit
prefix — if that ever stopped being true a retention policy would become an
evidence shredder, quietly, so there is a test rather than a comment. The
disk listing now prunes by prefix as well; it used to walk the whole store
and throw away what did not match, which was invisible with one caller
wanting every key and would have become a full scan per log read.

**No migration.** There are no audit records anywhere — the service has
never been deployed. A local `accounts/<id>/audit.log` from development
stays on disk and stops being read; nothing deletes it.

**Still on local disk:** accounts, sessions and reset tokens. Those are
credentials rather than records, and none of them has a design question in
the way — they are a port. *(Overtaken the same night: ported, and the one
thing that was not a straight port was the session index.)*

## 2026-09-22, night — the object store

`src/server/blobs.ts` and `src/server/s3.ts`. Documents now live in an
object store when `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` are set, and on disk otherwise. No `STORAGE=s3`
switch: a switch set without credentials is a service that starts and then
cannot read anything. 295 tests, still green with `node_modules` moved
aside.

The seam paid for itself. Encryption, retention, scrubbing and the
ownership check all happen above the four functions that were written to be
replaced, so none of them changed and the 287 tests that covered them went
on passing throughout.

**Signature Version 4 is written by hand, and the reason that is defensible
is that it is checked.** AWS publishes a worked example with a fixed key, a
fixed timestamp and the exact signature the algorithm must produce, and the
test reproduces `get-vanilla` byte for byte. The service name is a
parameter rather than a constant specifically so that vector runs against
the real code path instead of a copy — it names a service called `service`,
and a hard-coded `s3` would have made the strongest available check
impossible. A second implementation, written from the specification in
Python, agrees on every S3 case as well.

The alternative was the AWS SDK: four hundred-odd transitive dependencies
to do four verbs, on a service holding federal records.

**What the fake server proves.** `__tests__/s3.test.ts` runs a real HTTP
server speaking PUT, GET, DELETE and ListObjectsV2 with pagination, and
drives the whole job store through it — upload, read back, deliver, sweep.
It checks that `x-amz-content-sha256` is the hash of the body actually
sent, and that the bucket holds the sealed form rather than the customer's
archive or filename. What it cannot prove is that AWS agrees; that is the
vector's job, and between them the untested surface is AWS's own error
behaviour and nothing else.

**Found by the runtime, not by review:** TypeScript constructor parameter
properties are not supported in Node's strip-only mode, which is how `npm
test` runs. `S3Error` was written with them and is now written out.

**Still on local disk:** accounts, sessions, the audit log and reset
tokens. Documents went first because they are the federal records. One part
of the rest is a design question rather than a port — the audit log is
`appendFile` to one file per account, and an object store has no append.
*(Overtaken the same night: the audit log moved, one object per event.)*

## 2026-09-22, night — the renderer, and the crop that makes it allowed

The Chairman took the dependency. `src/server/render.ts`: pdf.js and a
native canvas, both loaded through `await import` from a file no test
imports, so `npm test` still passes with `node_modules` moved aside. 287
tests.

**The crop is the point.** This draws one figure and never a page, because
a rendered page is a picture of the page's text and that may not leave the
building. The box comes from the tag tree — `/A << /O /Layout /BBox >>`,
which PDF/UA requires on a figure — and **no box means no render**.

That was worth measuring before building, and measuring changed the work
again: every figure in the Chairman's infographic already carries its box.
What could have been a content-stream interpreter tracking transformation
matrices and path operators turned out to be four lines reading a
dictionary. Fourth time this week that opening the real file was cheaper
than reasoning about it.

**Licence, not quality, picked the renderer.** MuPDF is better and it is
AGPL, which means publishing this service. pdfjs-dist is Apache-2.0 and
@napi-rs/canvas is MIT.

**Verified in the browser on both real PDFs.** The CHERP infographic: four
figures, **four drawn**, zero "describe it yourself" where there used to be
four. The served PNG is 396×166 — a whole page at that scale would be about
1400×1812, which is the crop working rather than being claimed. The Hokua
logo sheet, untagged and therefore boxless, renders nothing and says why. No
page errors.

**Two build details worth remembering.** `serverExternalPackages` is
required: a native `.node` binding cannot be traced into a bundle, and
Turbopack was right to refuse. And `npm install --save` removed the
`--no-save` playwright-core again, which is the second time this week.

## 2026-09-22, night — the three things a production store has to do

Encryption at rest, deletion, and the scrub. 285 tests, still green with
`node_modules` moved aside — all of it on `node:crypto`.

**Encryption.** AES-256-GCM over every byte the store writes, with the job
id as associated data so a blob moved into another job's directory will not
open. The authentication matters as much as the secrecy here: a job record
decides who may open a document, and a record an attacker can silently edit
is an authorisation bug with extra steps. A blob written before a key
existed opens as itself; no key means plaintext in development and a refusal
in production. The whole job-store suite now runs against an encrypted
store, because encryption is a property of the store and not a mode.

**Deletion.** `RETENTION_DAYS = 7`, and the clock starts at *download*. A
clock started at upload deletes the file in the middle of a fortnight's
review. The cost — a document nobody downloads has no deletion date — is
named in the code rather than hidden. `npm run sweep` removes what is due
and **keeps the record**: a conformance statement is a claim somebody may
have to answer for years.

**The scrub**, decided on 21 September and unimplemented until now. Taking
the delivered file removes every quotation from the record. The detectors
quote the document inside curly quotes, so one function finds them all —
which makes that prose convention load-bearing, and a test now says so out
loud.

**Verified in the browser, end to end, against a real encrypted store.** On
disk: the record is not JSON, does not contain the filename, and the
document does not start `PK`. The page warns before the download button that
taking the file starts the countdown. After downloading: the deletion date
is shown, the applied change that read `Set the title to “Enrolment over
time”` reads `[removed]`, the scrub notice is shown, and the `.docx` that
arrived is a real archive. No page errors.

**A harness false positive, caught rather than reported.** The first run
checked for a curly quote anywhere on the page and said the report still
quoted the document — but the page's own copy contains `says “Conforms to
Section 508”`. The check was rewritten to look for the document's own words.
Five harness false alarms this week; this is the first that would have been
reported as a *failure* rather than as a pass, and the lesson is the same
one: check the thing, not a proxy for it.

## 2026-09-22, night — mail, and the two lies it lets the service stop telling

`/account/forgot` sends a link, `/account/reset` spends it. Thirty minutes,
once, and a completed reset ends every session the account has. The token is
32 random bytes with only its SHA-256 stored, like a session. 263 tests,
still green with `node_modules` moved aside.

Mail goes out as one HTTPS `POST` with a bearer token — `fetch` does that
with no package, and a package in the code path that carries credentials is
a supply-chain risk this repository does not have to take. Unconfigured, a
letter is written to `accounts/outbox/` instead, and that is **refused in
production**: a service silently writing reset links to local disk because
somebody forgot a variable looks like it is working, which is worse than not
working.

**The decision worth reading twice** is that `letterFor` takes a closed
`Letter` union and throws if the link it is handed is not on our own origin.
A reset link is a credential; a template that renders whatever link it is
given is a phishing page with our return address on it. Seven wrong links in
the test, including `https://508this.example.evil.test` — the prefix trick a
naive `startsWith` falls for — with a negative control.

`src/server/origin.ts` reads `PUBLIC_BASE_URL` and refuses to guess in
production, because a link built from the request's own `Host` header is a
credential mailed to the right person pointing at the wrong server.

**Verified in the browser, six steps.** Two browsers signed in as one
account; a third asks for a reset and is answered identically to an address
with no account (whose letter says so and carries no link); the letter
carries no passphrase and points at our own origin; the link sets a new
passphrase; **both other sessions are signed out**; the old passphrase
fails, the new one works, and reopening the link says it has already been
used. No page errors.

**The harness cried wolf a fourth time** — `[role=alert]` matched Next's own
route announcer as well as the page's message. The product was right and the
selector was wrong, which is now the fourth in this class and worth saying
out loud every time.

## 2026-09-22, night — the Hermes figures are vector

The Chairman ran the triage. **All 76 are vector**, which answers the
question standing since the 21st and answers it the unwelcome way: drafted
alternative text does not touch the document that motivated it, and does not
touch either of the other two real PDFs either.

Nothing is wrong with the feature — it works, it is cheap, and it reaches
Word documents, which are the format the service takes furthest. What is
now established rather than suspected is that **the PDFs this business
receives are drawn, not photographed**, and every figure in them is a
reviewer's to describe by hand until somebody writes a renderer. That is the
third time in five days that measuring a real file changed what the roadmap
means; it is recorded here and the decision it reopens is the Chairman's.

## 2026-09-22, evening — every job has an owner

The other half. Sign-in, sign-up and sign-out pages; a job owned by an
account or by a visitor and never by neither; and `src/server/access.ts` as
the one door, with a test that walks `src/app/` and fails on any import of
the job store outside a three-name allowlist. 249 tests.

The Chairman kept the anonymous upload, which is what the two-way owner is
for. A visitor uploads and reads their assessment; marking CUI, deciding a
finding, remediating and downloading all need an account. That is the same
line `pricing.ts` draws, and it falls out of the two decisions rather than
being invented: the assessment is free so it cannot need a sign-up, and a
deliverable carries a name so it cannot be signed by a cookie.

`claimJobs` runs at sign-in and moves that browser's jobs to the account.
`mayOpen` already lets a signed-in person read a job their own browser
uploaded, so nothing breaks if the claim never happens — but the cookie
expires in thirty days and the account does not.

**Verified in the browser, six steps, all passing.** An anonymous upload
works and shows the assessment with no fix button and the sign-in sentence
in its place. **The same URL in a second browser is a 404 that leaks
neither the filename nor the fact that a job exists.** A CUI upload while
signed out is refused before anything is stored. Signing up in the first
browser claims the job — it still opens, and the fix button appears. CUI
while signed in is accepted. Signing out shuts the door on the now-claimed
job. The only console errors are the two deliberate 404s.

`src/app/not-found.tsx` replaced Next's stock page, because a 404 stopped
meaning "typo" and started meaning "not yours", which is a routine and
correct outcome somebody will meet holding a link a colleague sent them.

**Found and not fixed:** `src/app/start/page.tsx` sets `encType` on a form
whose action is a server function, and React logs a warning saying it
overrides it. Pre-existing, unrelated to ownership, and one attribute to
delete — left out of this change rather than widening it.

## 2026-09-22, later — the identity layer, with nothing gated by it

Seven files and 35 new tests: `src/domain/account.ts` (what an address and
a passphrase have to be), `session.ts` (two clocks and a lockout, as pure
functions over a time you pass in), `audit.ts` (the record's shape),
`src/server/passwords.ts` (scrypt from `node:crypto`),
`src/server/accounts.ts`, `sessions.ts` and `audit.ts` (the stores). 240
tests, and they still run with `node_modules` moved aside — scrypt, session
tokens and the append-only log are all Node's own modules.

**Nothing is gated.** There is no sign-in page, no owner on a job, and
`/jobs/<id>` still answers to anyone holding the link. That is deliberate:
half-built authentication is worse than none because it looks like
protection, and what shipped here cannot look like anything, because no page
mentions it. The next change is the one that closes the hole.

**The decision worth reading twice** is that an audit record has no
free-text field and `auditEvent` throws on a subject that is not a UUID.
800-171 wants records sufficient to trace a user's actions; the oldest rule
in this repository says no document content reaches a log. Those pull apart
the moment somebody adds a `detail` field and a dismissal note — which
quotes the customer's own sentence — lands in it. There is nowhere for prose
to go, and a test tries six kinds of prose in both the account and the subject position, with a negative control so the
check cannot pass by refusing everything.

The rest, briefly: passphrases are 12 to 128 characters with no composition
rules and no rotation, counted in code points so a passphrase of emoji is
measured the way its author counts it; scrypt at N=32768 with the parameters
in the stored string, so raising them later does not strand the hashes
already on disk; a failed sign-in answers one way and spends the same work
whether or not the account exists; the email index is keyed by SHA-256
because a directory listing gets backed up and screenshotted; sessions store
only the token's hash and die at thirty minutes idle or eight hours
absolute, and it needs both — the first protects the reviewer who walked
away from a terminal, the second bounds a stolen token that activity would
otherwise keep alive forever.

## 2026-09-22 — prices, and the thing they are attached to

`src/domain/pricing.ts`. Three offers — assessment free, conformance
statement $49, remediation $149 or $99 where the service cannot certify —
with $3 for each figure past the first ten. The job page quotes them above
the fix button; nothing takes payment, because building billing before the
numbers are settled would be building it twice.

The shape matters more than the numbers, and the numbers are one table a
person can change in one screen. `quoteFor` returns the price and the
promise in one object and nothing returns the price alone, which is the same
move `promiseFor` made for the sentence and for the same reason. A test
holds the invariant — no tier the service cannot certify is charged the
certifiable price — with a negative control, since the test would pass
happily if remediation were refused on all four tiers. A second test asserts
that no refusal contains a price literal, because a `$149` typed into prose
is a number nothing keeps in step with `PRICES`.

An untagged PDF is refused remediation outright and told why, in the
customer's words, on the page. Setting a language and a title is real and it
is not a hundred and fifty dollars of work.

The tier is now established at intake and stored on the job record, since
the price depends on it. `redetect` had been reading Word parts
unconditionally, which would have thrown on the first PDF record an older
build wrote; it now re-runs whichever detector the job's format calls for.
205 tests.

**Verified in the browser, on all three real documents.** The Word fixture
quotes $149 with no caveat; the CHERP infographic (tagged, no headings)
quotes $99 with the sentence saying it will still not conform; the Hokua
logo sheet (untagged) is refused remediation and offered the $49 statement.
No page errors.

**A correction.** `src/server/vision.ts` said a drafted description costs "a
fraction of a cent". At $5 per million input tokens and $25 per million
output, a document figure costs one to three cents — an order of magnitude
more. It changes no decision and the comment is fixed.

## 2026-09-22 — the reviewer can see the figure

Drafting without this was half a feature. A description cannot be checked
against a picture nobody can see, and a drafted one least of all: the
failure mode named in yesterday's own notes is a confident invention that
reads well and gets accepted, and a reviewer with nothing to compare it to
is exactly the person who accepts it.

`/jobs/<id>/figure?key=` serves one figure from the customer's own document,
`private, no-store`, `nosniff`, in the reviewer's browser. It renders
directly above the box they type in. Where there is no picture the same
place carries the sentence saying why, because a broken image icon is worse
than an honest explanation.

`imagesForFindings` answers for every figure from one opening of the
document. Asked one at a time, the submission in hand – 76 figures – would
have reopened and reparsed the file 76 times to draw one screen. 191 tests.

**Verified in the browser.** The Word fixture renders its chart at its real
120×80 (`naturalWidth` non-zero, so it genuinely loaded rather than
404ing); the CHERP infographic renders no images and four explanations, one
per vector figure. No page errors.

## 2026-09-21, night — drafted descriptions, raster only

The Chairman chose raster-only over a rendering dependency, and it is built.
`src/domain/alt.ts` (the instruction and the cleaning of what comes back),
`src/domain/docxImages.ts` and `src/domain/pdfImages.ts` (finding the
picture), `src/server/images.ts` (JPEG passed through untouched, Flate
samples wrapped in a PNG), `src/server/vision.ts` (the one module that talks
to anything outside this service), `propose` in the job store, a CUI
checkbox at intake, and a button in the review queue. 188 tests.

**Verified in the browser, on three documents:**

| | | |
|---|---|---|
| Word with a real embedded PNG | button offered | reaches the API; with a deliberately bad key, “drafting is not configured” |
| The CHERP infographic | button offered on all four figures | “drafted as vector artwork, so there is no picture in the file to send” |
| Word marked CUI at intake | **no button at all** | and `propose` refuses independently, since a page can be navigated around |

The Word fixture is a real `.docx` built for the purpose and opened with
python-docx; the PDF raster path is verified against a constructed file,
because neither contractor PDF contains a raster image and LibreOffice is
installed in the cloud container but cannot load any file at all.

**The invariant that changed, and honestly.** `src/server/` took its first
npm dependency. The rule as written – “Node's own modules and nothing from
npm” – was protecting a guarantee, which is that `npm test` runs with
nothing installed. The rule is now stated as the guarantee: no file any test
imports may take a dependency, and CI proves it by running the tests before
it installs anything.

**And it proved it immediately.** The first push asserted in these very
docs that no test imported `vision.ts`, which was false: the job store
imported it at the top of the file, and the job store is in the test
suite's import graph. CI went red on a file that would not load, seven
tests never ran, and the claim was wrong in writing before it was wrong in
code. The store now reaches it through `await import('./vision')` inside
`propose`, and the fix was verified the way CI verifies it – by moving
`node_modules` aside and running the suite, which passes 188 with nothing
installed. A guarantee asserted is not a guarantee checked.

**Two bugs found by writing the tests**, both in the cleaning of a draft.
The first regex missed a leading article, so “A picture of a bar chart” kept
its opener. Broadening it then over-stripped “A chart of enrolment”, which is
a *good* description – “chart” names what the thing is, not the medium. The
list is medium words only and both halves are pinned.

**And a harness lesson, for the third time this session.** The end-to-end
script reported the feature broken twice: it read the page before the server
action had redirected. Calling `propose` directly proved the logic was right
and the script was wrong. Next's server actions take seconds on this path;
wait for the outcome to appear, never for the network to go quiet.

**Not done:** no live call has been made. There is no API key in the cloud
container, so the request is assembled and sent and the failure is an
authentication error. The first real description has to be drawn on Josh's
own machine.

## 2026-09-21, later — the vision pass, stopped by what a figure is made of

Retention was decided and drafted alternative text was unblocked, so the
vision pass was started. It stopped on the first question: **what exactly do
we send?**

Measured on the Chairman's infographic rather than assumed:

```
page 1 resources:   ExtGState Font ProcSet Properties Shading   (no XObject)
image XObjects:     0 in the entire file
inline images:      0
content stream:     753,687 bytes – 9,450 curves, 1,651 fills and strokes
figures:            4, none described
```

The figures are vector artwork. There is no image in the file to send a
model. Both real files together: **5 undescribed figures, 0 raster images.**

Getting pixels means rendering the page – graphics state, path painting,
Bézier flattening, clipping, colour spaces, the shadings this file uses,
`ExtGState` transparency, and fonts for text inside the artwork. A PDF
renderer is a product, not a feature.

**What was built instead:** the measurement. `rasterImages` on `PdfFacts`
counts image XObjects anywhere in the file plus inline images on a page;
`canDraftAltText` asks whether a document has an undescribed figure *and*
pixels for it; the triage prints an `Img` column and a sentence separating
"needs a description" from "has anything to send". 167 tests.

**Not built:** the endpoint, the prompt, the reviewer's "draft it" button.
Building them for a case that does not occur in either real file would have
demonstrated nothing. The decision that unblocks them is the Chairman's and
is recorded in the standup log.

**Note for whoever builds it:** a Word document is the easy case and was not
the blocker. An image in a `.docx` is a real part in the archive
(`word/media/image1.png`), extractable with the unzip already in the repo.
If the answer is "raster only, no renderer", Word works the day the
endpoint exists.

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
  `DOCUMENTS_DIR`. One file to replace when storage is decided. *(Since
  replaced: `blobs.ts` is the seam, and the root is `store/`/`STORE_DIR`.)* `next build`
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
