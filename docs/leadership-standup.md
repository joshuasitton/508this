# 508This — Leadership Standup Log

Running log of leadership round-tables. Newest first. Josh is Chairman of the
Board and sole human authority; every "decision needed" below waits on him.
Entries are kept as they were written – a standup is a record of what the team
believed on a date, and editing it after the fact destroys the only thing it is
for. Where an entry has since been overtaken, `docs/build-state.md` says so.

---

## 2026-09-25 — retention, decided

### What the Chairman said

Give 72 hours to download and then delete. Asked how it meets the existing
rule: alongside it, not replacing it. Asked about an assessment nobody
remediates: the same 72 hours, from upload.

### Done

The gap `retention.ts` has named since the policy was written is closed. A
document nobody downloads no longer lives forever.

| The job | When the files go |
|---|---|
| downloaded | seven days after the download |
| remediated, not collected | 72 hours |
| nobody has touched it | 72 hours after upload |
| a reviewer is working on it | no clock yet |

### The one thing engineering decided, not the Chairman

**That last row.** The instruction, read literally, would delete a document
72 hours after upload whether or not a reviewer was part-way through
deciding its findings — and that is the precise failure the 21 September
reasoning was written to prevent, still at the top of the file: *a clock
that started at upload deletes the file in the middle of the job.*

So nothing is deleted while a reviewer has it. `reviewer` is set the first
time a person decides anything, which makes it the signal; the 72 hours
start when there is something to collect. **The Chairman should overrule
this if he meant the harder line** — it is the difference between losing a
fortnight's review work and not.

### What the customer is told

The page says it plainly and names the date: *"deleted on 28 September 2026,
72 hours after you uploaded it, unless a review starts before then."* Once a
reviewer is named it changes to *"stays here while it is being reviewed."*
Both read on the running app rather than asserted.

### Still with the Chairman

The four prices. The first live drafted description. The deployment. And
whether the reviewer exemption above is what he meant.

---

## 2026-09-25 — flagging, which is not checking, and is worth having anyway

### What the Chairman said

Do 1.3.3 and 1.4.1.

### Done, and what "done" means here

**These two keep their reviewer, deliberately.** "No instruction relies on
shape, size, position or sound" and "colour is never the only way
information is conveyed" are judgements about meaning. A machine claiming
them would be claiming to have understood the document, and this company
sells a statement whose value is that it does not do that.

What changed is the reviewer's job. The Word path has flagged the candidate
sentences since the detector was written; the PDF path never did. **The
same criterion meant "confirm these three sentences" for a .docx and "read
the whole document" for a PDF** — a difference nobody had noticed because
the review screen shows one document at a time.

### The judgement worth defending

Word flags a coloured run among plain ones, which is a sharp signal because
a .docx is mostly plain with occasional colour. **A designed PDF is the
opposite.** Brand colour is in every subhead, callout and pull quote, and
none of it is "colour as the only means of conveying information".

Porting Word's rule unchanged would have produced dozens of rows per
document and buried the reviewer — the same failure as a check that cries
wolf, reached by a different route. So the PDF rule is narrower: colour
used *inline*, differing from the rest of its own line, at the same size,
with nothing else carrying the emphasis. A coloured heading is set apart by
being a heading.

Measured on the real infographic, which has brand colour on every element:
**one finding.** That was the risk and it did not materialise.

### Still with the Chairman

The four prices. The first live drafted description, which has still never
run. And the deployment.

Retention is now decided and being built: 72 hours to collect, then the
existing seven days from download for anyone who does; and an assessment
nobody remediates loses its original 72 hours after upload.

---

## 2026-09-25 — 1.3.2, and a PDF that costs what a Word file costs

### What the Chairman said

Do 1.3.2 next.

### Done

Meaningful Sequence is checked for a PDF. **A PDF now needs a person for
four criteria, which is the same four a Word document needs.** The format
penalty this service has carried since the coverage tables split is gone:
1.3.3, 1.4.1, 1.4.5 and 2.4.6, either way.

That is the third criterion the renderer paid for. The dependency was taken
on 22 September to draw figures for the drafting feature; it has since made
contrast, language of parts and reading order measurable, none of which was
the argument for it.

### The decision worth defending

**A check that cries wolf is worse than no check.** The obvious build sorts
blocks down the page and calls any difference a failure — and fails every
correctly tagged two-column document in the process. The reviewer learns to
click past the row, and then misses the real one, and we have made the
product worse while reporting a higher automation rate.

So it claims only an inversion no layout could justify, and hands a
multi-column page to a person with the reason named. Superscripts, footnote
markers and table cells tagged right to left all pass, deliberately, each
with a test.

Security and product both asked the same question: what stops this passing
something it never checked? Two answers, both built. An untagged PDF has no
reading order to be wrong, so it is a blocking finding rather than a pass.
And a tagged document whose tags cannot be matched to the page is escalated
rather than passed for want of evidence.

### Commercial consequence

The certifiable tier was costed against seven reviewer criteria for a PDF.
It is four. **PDF and Word now cost the same to certify**, which was not
true when the prices were drawn up and which removes the reason to price
them apart.

### Still with the Chairman

The four prices, now against a materially cheaper document. What happens to
a document nobody downloads. The first live drafted description, which has
still never run. And the deployment.

---

## 2026-09-25 — taking two criteria off the reviewer

### What the Chairman asked

Looking at the review queue: is there no way to address these without a
reviewer? Then: do 1.4.3 and 3.1.2.

### What the question exposed

Three of the seven criteria on that screen were **already machine-checked
for Word** and reviewer-only for PDF. Nobody had said so, because the
review screen shows one document at a time and the asymmetry only appears
if you read both coverage tables side by side. The Chairman found it by
looking at the product.

Worse: the PDF remark for 1.4.3 said contrast *"is not measured by
machine."* That was true when written and stopped being true on
22 September, when the renderer landed. **It was shipping inside customers'
conformance statements** — a false statement about our own capability, in
the document they hand to a federal buyer.

### Done

1.4.3 and 3.1.2 are checked for PDF. **A PDF now waits on five reviewer
criteria instead of seven**, which is roughly a third of the human time in
the certifiable tier — and the four prices still with the Chairman were
costed against seven.

### The decision worth defending

**Uncertainty is a finding, not a silent pass.** Some text cannot be
measured honestly: over a photograph, a gradient, a coloured edge. The
tempting version of this feature passes those quietly and reports a higher
automation rate. We escalate them instead, with a sentence saying what
could not be measured and why.

That is the whole commercial argument for the statement. It is worth
something because "checked" means checked; a heuristic that is right most
of the time and says Supports for the rest launders a guess into a claim
the customer sells onward to a federal buyer. On the real test file the
feature's first act was to escalate rather than pass, which is the
behaviour we want to see.

**Neither check sends anything to a vendor.** Contrast is arithmetic on
pixels we drew and discarded; language detection is local. So both run on
documents marked CUI, where the drafting of alternative text is refused.
That is the first capability this service has added that CUI customers get
in full.

### What engineering got wrong, and how it was caught

Two bugs, both found by running it on the real sample documents rather than
by reasoning about the code: an English document reported as containing
foreign passages, because a locale was compared against a language; and a
grey full stop reported as a contrast failure. The second is the more
instructive — true, useless, and precisely the sort of row that teaches a
reviewer to stop reading the queue.

### Still with the Chairman

The four prices, now costed against a cheaper document. What happens to a
document nobody downloads. And the first live drafted description, which
still has never run.

Remaining on the reviewer for a PDF: 1.3.2, 1.3.3, 1.4.1, 1.4.5 and 2.4.6.
Engineering's read on those is unchanged — 1.3.2 is partly reachable, 1.3.3
and 1.4.1 can have their flagging ported from Word to make the confirmation
a glance, and 2.4.6 is a judgement that should stay with a person.

---

## 2026-09-23 — decided: AWS

### What the Chairman said

Merge it and use AWS instead.

### The decision

**The store is AWS S3.** Not on price — R2 is cheaper and charges nothing for
egress, which for a service that hands documents back is the dominant cost —
but because this service accepts CUI and R2 is not FedRAMP authorised. That
is the Chairman reversing engineering's recommendation on the ground
engineering should have put up first, which is the right outcome by the wrong
route.

Recorded here because it is the kind of decision that gets re-litigated in
six months by somebody looking at the invoice: **the money was the reason to
choose R2, and it lost to the authorisation question.** If the CUI decision
of 21 September is ever revisited, this one is downstream of it.

### Done

`docs/deploy.md` has the AWS steps — region first, because it is inside every
signature and changing it later is a new bucket; Block Public Access fully
on; versioning and Object Lock at creation, which is what turns the audit
log's append-only claim from a statement about our source code into one about
the bucket; and an IAM policy scoped to the four verbs and nothing else.

Security's note for whoever applies that policy: **`s3:ListBucket` goes on
the bucket ARN, not the objects ARN.** Get it wrong and uploads and downloads
work while listing 403s — which means the retention sweep silently finds
nothing to delete, and a deletion policy that does not run is the failure
this service would notice last.

### The gap the decision exposed

Choosing AWS made virtual-hosted addressing the production path, and it had
no test: every S3 test in the repository sets an endpoint and therefore
exercises path style. Now pinned, both ways. The host is inside the
signature, so getting it wrong is a 403 that explains nothing.

---

## 2026-09-23 — setting up storage, and a question engineering should have asked first

### What the Chairman said

Help me set up S3. Asked which store, he chose Cloudflare R2.

### Done

`docs/deploy.md` has the R2 steps — bucket, a token scoped to **that bucket
only** with object read and write, the account-specific S3 endpoint, and
`S3_REGION=auto`, which R2 requires literally and which is a silent 403 when
it is wrong.

And `npm run check:store`, which proves a bucket before a deploy trusts it
with somebody's document: the four verbs against the real thing with the real
signature code, then that what came back is sealed and that a sealed object
cannot be moved to another key and still open. Every failure path was
exercised rather than described, including the two that say least by default —
an unreachable endpoint and a wrong region.

### The question we should have asked before quoting a price

R2 was recommended on cost. **This service accepts CUI**, decided on
21 September against the recommendation of this table, and the README already
makes the argument that settles this: *a zero-data-retention commitment is
not a FedRAMP authorisation, and the two are not substitutes.*

That was written about the model vendor, which sees one figure. It applies
with more force to the bucket, which holds the whole document. **R2 is not
FedRAMP authorised.** AWS commercial regions are Moderate, GovCloud is High,
and MinIO on infrastructure already authorised is a third answer.

Engineering put the cheap option up without putting that beside it, which was
the wrong way round for a service that accepts CUI. The runbook now states
the choice rather than making it. What the code needs is identical either
way; what is not identical is moving documents that already exist, which is
the argument for the Chairman settling it before the first upload.

### Still with the Chairman

The store, now that the question is properly framed. The four prices. What
happens to a document nobody downloads. And the first live drafted
description, which has still never run.

---

## 2026-09-23 — ready to deploy, and a promise that was not being kept

### What the Chairman said

Merge it and deploy it.

### The honest answer on the deploy

**It is not deployed, and it cannot be from this environment.**
`api.vercel.com` is denied by the network policy and there is no Vercel
token here. Everything that does not depend on that is done, and the deploy
is now a runbook and three accounts rather than a question.

`docs/deploy.md` names every variable the code actually reads — derived by
grepping `process.env` out of `src/`, so it cannot drift from the source the
way a remembered list would — with the two orderings that matter, the bucket
settings, and four things to check afterwards.

### What we checked so the first deploy is not the test

The production build was run **in the object-store configuration**, against
a local S3-compatible server, because the disk configuration is not the one
being deployed. The whole identity flow and a document upload went through
it; everything landed sealed under the right prefixes; and the job page said
*"Stored in object storage, encrypted at rest."* without a line of code
changing, which is the storage seam earning its keep in public.

Two things that would have failed at deploy time were checked here instead:
the renderer's native binary ships prebuilt for Vercel's runtime and the
lockfile carries that platform, and the heaviest route traces to 67 MB
against a 250 MB limit.

### The gap this found, and why we closed it rather than filing it

Writing the runbook surfaced that **`sweepExpired` was called by nothing.**
"Documents are deleted seven days after the customer downloads them" is not
a nice-to-have — it is in the data-handling story this service sells, and it
was true of the code and false of the service. That is the worst shape a
promise can be in, because it reads as kept.

Deploying a service whose retention promise silently does not hold is not a
deploy anyone should want, so it was treated as part of deploying rather
than as a follow-up. A daily cron now calls it. The route is the only thing
in the service that deletes a customer's document, so what it *accepts*
mattered more than what it does: Vercel's cron token compared in constant
time, the same 404 for every other caller, and no route at all until
somebody sets `CRON_SECRET` and thereby decides who may call it.

Security's note: it answers with a count and never the ids it swept. A job
id names a customer's document and a response body gets logged.

### Still with the Chairman

Three accounts only he can open — Vercel, a bucket, and a mail sender — plus
the network policy or a token if he wants the deploy driven from a session
rather than his own terminal.

And unchanged: the first live drafted description, the four prices, and what
happens to a document nobody downloads. The last of those is now the only
retention question without an answer in code, and the recommendation stands
at 90 days from last activity.

---

## 2026-09-22, night — the credentials, and the end of local disk

### What the Chairman said

Merge it and port the credentials.

### Done

Accounts, sessions and reset tokens are on the object store. **Nothing the
service persists is on local disk any more.** That is the milestone rather
than the diff: Vercel's filesystem does not survive a deploy, and until
tonight that was the thing standing between this service and being
deployable at all. 311 tests.

### The part that was not a port

`endAllSessions` read every session record in the service to find one
account's. On a disk that is linear and fine. Against a bucket it is a
listing of every session there is plus a fetch each — and it runs on the
passphrase-reset path, which is to say **the path that runs when a customer
thinks their account is compromised**. The slowest, most expensive thing in
the store was wired to the moment it most needs to work.

So sessions gained an index, an empty object whose name carries the digest.
The entry is written *before* the record, which is the ordering that fails
safe: an entry with no record deletes to nothing, while a record with no
entry is a session that survives the reset that was meant to end it. Every
path that ends a session takes the entry with it, or the index quietly
becomes a permanent list of every session the service has ever issued.

### The decision worth defending

Everything is sealed to its own key, and **here the binding is worth more
than the secrecy**. The passphrase is already a scrypt hash. What the seal
protects is *where a record sits*: a session record is what the server
accepts instead of a passphrase, so one that could be copied onto the digest
of a token an attacker holds is a sign-in as somebody else without a
credential ever being guessed. A reset record names the account its link
resets. Anybody with write access to the store could have done that with
files on a disk. They cannot now, and there is a test per record type
watching each moved copy refuse to open.

Security's second note: a broken seal is an error in `accounts.ts` and a
plain "no" in `sessions.ts` and `resets.ts`. An account is fetched by an id
the server already resolved, so a failure there is real and should be loud.
A session or reset key comes from a cookie or a URL. Throwing on those would
hand anybody a way to knock the service over with a forged token, and would
tell a stranger when their guess landed on something.

### What stays on disk, deliberately

The development mail outbox. It holds letters carrying **live reset links**,
and it only exists when no mail token is configured — in production nothing
is written at all. Moving credentials somewhere more exposed in order to
tidy up a folder is the wrong trade, so `ACCOUNTS_DIR` now names the outbox
and nothing else.

### Still with the Chairman

The first live drafted description — still the one thing in this product
that has never actually run, because no API key has ever existed in this
environment. The four prices. What happens to a document nobody downloads;
recommendation unchanged at 90 days from last activity, as a second and
longer clock rather than a replacement for the seven days from download.

With storage finished, the standing question for the next round-table is
what the service needs before it can take a real customer's document — and
management's read is that the answer is now a deployment and a key, not more
code.

---

## 2026-09-22, night — the audit log, and the shape a bucket forced

### What the Chairman said

Merge it and port the audit log.

### Done

The audit log is on the object store, **one object per event**, which is
the recommendation the last round-table put up and the Chairman's
instruction settled. Nothing is ever rewritten: `record` only writes a key
that did not exist, `history` only reads. 302 tests.

### Why the shape had to change

An append-only file does not port. A bucket has no append, and faking one
— read the log, add a line, write it back — is a read-modify-write race
that loses records under precisely the concurrency an audit log is there to
capture, and it hands whoever holds the bucket a single object to rewrite.
The one property the log exists to have would have been the first thing the
move cost.

One object per event keeps it, and it turns out to buy something disk never
had. **Each record is sealed with its own key as associated data**, so a
record cannot be moved: re-file it under another account's prefix, or
rename it to an earlier time to back-date it, and it stops opening. The old
claim was append-only *by construction* — true of our source code and
nothing else, because anybody who could reach `audit.log` could edit a line
in it. This claim survives somebody who can reach the store. Object
versioning and an object-lock policy on the prefix are now available from
outside the application as well, which is the control 800-171 3.3.8
actually wants and which a local file could not accept.

### What the log now admits

`history` returns how many records were listed and did not come back as
events — a torn write, or one that has been moved or altered. The file it
replaces skipped a corrupt line silently, which meant the single thing an
audit log exists to reveal was the thing it could not say. The number
carries no content, so it cannot become somewhere for text to hide.

### The risk this created, and the test that holds it

Documents and evidence now share a store. Documents are deleted seven days
after download; audit records are evidence and are not. What keeps them
apart is that the retention sweep only ever looks at keys whose first
segment is a job id, and `audit` is not one. **If that ever stops being
true, a retention policy becomes an evidence shredder and it does it
quietly.** That is a test, not a comment. Security's note for the day the
bucket is created: no lifecycle rule on the `audit/` prefix, ever.

The store's folder is `store/` rather than `documents/` now, because a
folder named for one of the two things in it is how the next person files
the sessions wrongly.

### What this does not solve

**Accounts, sessions and reset tokens are still local.** They are
credentials rather than records and none of them has a design question in
the way — that is a port, not a decision. *(Done the same night. One part
was not a port after all: `endAllSessions` needed an index.)*

Reading a log is one round trip per record. Honest rather than clever, and
fine while a few thousand events is a large log; the escape hatch is in the
key, which carries the time, so a date range narrows the listing before
anything is fetched. Engineering will build that with the log page, not
before it.

### Still with the Chairman

The first live drafted description. The four prices. What happens to a
document nobody downloads — recommendation unchanged: 90 days from last
activity, as a second and longer clock rather than a replacement for the
seven days from download.

---

## 2026-09-22, night — the object store, and one thing that does not port

### What the Chairman said

Write the object store.

### Done

Documents live in an object store when the credentials are there and on
disk when they are not. The seam built this afternoon did its job: every
one of the 287 tests covering encryption, retention, scrubbing and
ownership went on passing untouched, because all of that happens above the
line.

### The decision worth defending

**Signature Version 4 is written by hand rather than taken from the AWS
SDK.** That SDK is four hundred-odd transitive dependencies to do four
verbs — PUT, GET, DELETE, LIST — on a service holding federal records, and
every package in that path is a package that can read a customer's document
on the way past.

Hand-rolled crypto is normally indefensible because nobody can check it.
This is checkable and is checked: AWS publishes a worked example with a
fixed key, a fixed timestamp and the exact signature the algorithm must
produce, and the test reproduces it byte for byte. Engineering made the
service name a parameter specifically so that vector could run against the
real code path rather than a copy of it — the published case names a
service called `service`, and a hard-coded `s3` would have put the
strongest available check out of reach.

Chairman's call if he disagrees: the SDK is one `npm install` away and the
change is one file.

### What this does not solve

**Accounts, sessions, the audit log and reset tokens are still local.**
Documents went first because they are the records the retention decision is
about. One part of the remainder is a design question rather than a port:
the audit log is an append to one file per account, and **an object store
has no append.** Either every event becomes its own object, or the log
needs a real database. Porting it without deciding that turns an
append-only log into a read-modify-write race, which is the one property
that log exists to have.

Engineering's read, not acted on: **one object per event.** It keeps the
append-only guarantee that 800-171 wants, it needs no database, and listing
a prefix is how a log gets read anyway. *(Acted on the same night, on the
Chairman's instruction — see the entry above.)*

### Still with the Chairman

The first live drafted description. The four prices. What happens to a
document nobody downloads.

---

## 2026-09-22, night — the rendering dependency, taken

### What the Chairman said

Merge it and take the rendering dependency.

### What it cost, and what it bought

**Bought:** the drafting feature now works on the documents this business
actually receives. The CHERP infographic went from four figures a reviewer
had to describe from scratch to four figures drawn and ready to be
described. On the Hermes submission that is 76 figures moving from
composing to reviewing — the difference between an afternoon and an hour.

**Cost:** two npm packages in `src/server/`, where there was one. The rule
they bend is the same one `vision.ts` bent and it is bent the same way:
loaded through `await import` from a file no test imports, and `npm test`
still passes with nothing installed.

### The decision inside the decision

**It renders one figure and never a page.** A rendered page is a picture of
the page's text, and the retention decision says the whole document and its
text never leave. Rendering the page and sending it would have broken that
while looking like the feature working — so the bounding box is not a
refinement, it is the thing that makes the dependency permissible.

Where a document does not say where its figure sits, nothing is drawn and
the reviewer is told. That is the untagged logo sheet, and it is the honest
answer rather than a fallback to the page.

### Measuring first paid again

Engineering expected to write a content-stream interpreter — tracking the
transformation matrix and every path operator inside a marked-content span —
to work out where a figure was. Opening the real file first showed every
figure already carries `/A << /O /Layout /BBox >>`, which PDF/UA requires.
Four lines reading a dictionary instead of a week of work.

Fourth time in five days: "mostly PDF", "mostly vector", "entirely vector",
and now "the boxes were already there". The standing instruction is earning
its keep.

### Recorded, for the record

**The renderer was chosen on licence, not on quality.** MuPDF is the better
engine and it is AGPL — linking it into a commercial service means
publishing the service, and Artifex's commercial licence is a decision
several sizes larger than this feature. pdfjs-dist (Apache-2.0) and
@napi-rs/canvas (MIT) are what shipped.

### Still with the Chairman

The first live drafted description, on his own machine — and it matters more
now than it did this morning, because the feature finally reaches the files
he sends. The four prices. And what happens to a document nobody downloads.

### Next

The object store. It is the last piece of production storage and the one
that cannot be tested from a cloud container.

---

## 2026-09-22, night — production storage, and one decision that is now overdue

### What the Chairman said

Merge it and start on production storage.

### What was built

The three things a production store has to do, all of them on Node's own
crypto and none of them adding a dependency.

**Encryption at rest.** Every byte, AES-256-GCM, with the job id as
associated data so a sealed blob cannot be moved between jobs and still
open. Engineering's note, written into the file so it cannot be quoted out
of context in a sales conversation: this protects a disk, a backup and a
mislaid volume, and it does not protect against anybody who can run the
process, because the process has the key. That is the honest limit of
encryption at rest everywhere it is deployed.

**Deletion, seven days from download.** The Chairman's decision of 21
September, built. The clock starts at download rather than upload because a
conformance review does not finish on a schedule and a clock started at
upload deletes the file in the middle of the job.

**The scrub.** The other half of that decision, and the half that had been
sitting unimplemented: the record is stripped of every quotation from the
document at delivery. Deleting the file while keeping a record that quotes
it is a deletion policy in name only.

### Decision needed from the Chairman, and it follows from his own rule

**A document nobody downloads has no deletion date.**

That is a direct consequence of starting the countdown at download, and it
is the right trade for the common case. It also means a customer who
uploads, reads the free assessment and never comes back leaves their
document on this server indefinitely. Three options:

1. **An outer limit from upload** — say ninety days — running alongside the
   seven-day one. Simple, and it deletes work somebody may still be doing.
2. **A limit from last activity**: ninety days after the job was last
   opened. More forgiving, slightly more to build, and it is what most
   services actually mean.
3. **Nothing**, and say so on the page.

Engineering's read: **(2)**, because it never deletes a document somebody is
still working on and it closes the gap. Not acted on.

### Also worth the team's attention

A prose convention became a security boundary. The detectors have always
quoted the customer's words inside curly quotes; that is now how the scrub
finds them. It is load-bearing and a test says so, because the failure mode
is silent — a detector written next month with straight quotes puts a
customer's sentence somewhere the scrub cannot reach, and nothing would go
red.

The browser harness produced its fifth false alarm of the week, and the
first that would have been reported as a failure rather than a pass: it
checked for a quotation mark anywhere on the page, and the page's own copy
contains one. Caught before it was written up. The standing instruction
stands and gains a clause: **check the thing, not a proxy for it.**

### Still with the Chairman

The first live drafted description, on his own machine. The four prices.
**Does 508This take a PDF rendering dependency?** — reopened by his own
triage. And now: what happens to a document nobody downloads.

### Next

The object store itself. The seam is built — four functions in the job store
are the only code that touches a customer's bytes — and the implementation
is deliberately not written, because it cannot be tested from a cloud
container and an untested storage backend is worse than an honest local one.

---

## 2026-09-22, night — the Hermes figures are vector, and mail exists

### What the Chairman said

Merge it and start on mail. And: the Hermes figures are vector.

### The second half of that is the bigger news

All 76. That answers the question standing since the 21st, the unwelcome
way. **Drafted alternative text does not reach the document that motivated
it**, and does not reach either of the other two real PDFs. The feature is
not broken and was not a mistake — it works, it costs one to three cents a
figure, and it reaches Word documents, which is the format the service takes
furthest. What has changed is that a suspicion is now a finding.

What is established: **the PDFs this business receives are drawn, not
photographed.** Three real documents — the Hermes submission's 76 figures,
plus the five across the infographic and the logo sheet recorded on the
21st — and not one raster image among them. Every one of those figures is a
reviewer's to describe by hand.

**This reopens the decision the Chairman made on the 21st**, and it should.
Raster-only was chosen over a PDF rendering dependency on a sample of two,
with engineering's own note that "(1) is a large commitment to make on a
sample of two". The sample is no longer two, and it is unanimous. The
arithmetic has also changed: at $3 a figure past the first ten, the Hermes
submission is $198 of surcharge for work a renderer would reduce to
reviewing rather than composing. Engineering is not asking for a decision
tonight and is recording that the evidence for one has arrived.

It is also the third time in five days that measuring a real file changed
the plan — "mostly PDF", then "mostly vector", now "entirely vector". The
standing instruction from the 21st (a feature gets checked against a real
customer file before it is *scheduled*) is doing its job, one step too late
each time.

### What was built

Mail, and the reset flow on top of it. Two answers in this service are
deliberately uninformative — a taken address at sign-up, and a reset
request for an address with no account — and both were costing an honest
person a dead end. The address itself is the only channel where the truth is
safe to say, so that is where it is now said.

Thirty minutes, once, and a completed reset ends every session the account
has. That last one is not a nicety: people reset a passphrase because they
think somebody else has it.

No SMTP and no npm package. One HTTPS `POST` with a bearer token, which
`fetch` does on its own — a dependency in the code path that carries
credentials is a supply-chain risk worth not taking.

### Decided by engineering, for the Chairman to overturn

**A letter's only variable is a link, and the link must be on our own
origin**, enforced by a throw. A reset link is a credential, and a template
that renders whatever link it is handed is a phishing page with 508This's
return address on it. The same closed shape means no filename, finding or
passphrase has a route into an email.

**Unconfigured mail writes to `accounts/outbox/` in development and is
refused outright in production.** A service that silently writes
password-reset links to local disk because somebody forgot an environment
variable looks like it is working, which is the worst of the three states.

### Still with the Chairman

The first live drafted description, on his own machine — the vision path has
still never made a real call. The four prices. And now, reopened by his own
measurement: **does 508This take a PDF rendering dependency?**

### Next

Production storage, with deletion, scrubbing and encryption built in from
the first commit rather than retrofitted — the last thing standing between
this and a service that can hold a real customer's document.

---

## 2026-09-22, evening — the door is shut, and the front door is still open

### What the Chairman said

Merge it and keep the anonymous upload.

### What that settled

It settled the collision, and the resolution is better than either half
would have been alone. A job now belongs to an **account** or to a
**visitor** — one browser, one cookie, no name:

| | A visitor | An account |
|---|---|---|
| Upload, and read the assessment | yes | yes |
| Mark it CUI | no | yes |
| Decide, name a reviewer, draft, remediate, download | no | yes |

The second column is the paid column. That is not a coincidence and it was
not designed twice: pricing already said the assessment is free and
everything producing a deliverable is bought, and 800-171 already said a
name on a conformance statement belongs to somebody the service
authenticated. They turned out to be the same line.

### What is now true that was not this morning

**A link no longer opens a document.** The same URL in a second browser is a
404 that does not leak the filename or the fact that the job exists — "not
yours" and "no such job" are the same page, because telling a stranger a
document exists tells them who our customer is.

**A CUI document cannot be uploaded by a stranger.** It is refused at the
form, before anything is stored, because by the time it is on disk it is on
disk under a promise the service cannot keep.

### The engineering decision worth recording

**One door, and a test that counts the doors.** Every page, route and action
reaches a job through `src/server/access.ts` and nothing else; a test walks
`src/app/`, reads every import of the job store, and fails on anything
outside a three-name allowlist. A check written at nine call sites is a
check missing from the tenth, and on this product the thing behind the door
is a federal contractor's document.

### Still with the Chairman

The first live drafted description, on his own machine — the vision path is
exercised and has never been proven. Whether the Hermes submission's 76
figures are raster or vector. And the four prices, whenever he wants to move
them.

### Next, and it is short

**Mail.** Password reset needs it, and so does the honest answer to a
sign-up against an address that already has an account — that page currently
tells the person plainly that no message is coming, which is true and is not
a state to leave running. After that, production storage with deletion,
scrubbing and encryption built in from the first commit.

---

## 2026-09-22, later — accounts, and the question the free assessment asks of them

### What the Chairman said

Start on accounts.

### What was built, and what deliberately was not

The identity layer: credential policy, session policy, the audit record,
and the four server modules that store them. All of it with Node's own
crypto and nothing from npm, so `npm test` still runs with nothing
installed.

**No sign-in page, and nothing gated.** A job still has no owner and
`/jobs/<id>` still answers to anyone with the link. Engineering's view is
that this is the right first half: half-built authentication is worse than
none because it looks like protection, and nothing here can look like
anything, because no page mentions it. The second half is what closes the
hole, and it is the larger of the two.

### Decided by engineering, for the Chairman to overturn

**A stranger can still upload a document without an account.**

This is the one place accounts and pricing collide, and it was settled on
the reasoning the Chairman merged this morning: the assessment is free
because *a customer should find out whether the service can help them
before they pay*. Requiring a sign-up before the first upload takes that
back. But leaving a job reachable by anyone holding its URL is the hole
CUI makes unacceptable, and a UUID identifies nobody.

The proposal is the resolution both constraints allow:

1. An anonymous upload stays possible, and the job is bound to **that
   browser's session** rather than to the link.
2. Keeping the work — the review queue, the statement, the download —
   requires an account, and the anonymous job is claimed by it.
3. **Marking a document CUI requires an account**, full stop, because that
   is what 800-171 asks for and a browser cookie is not an identified user.

The alternative is an account before the first upload, which is cleaner to
build and costs the free assessment the thing that makes it worth having.

### Also decided, and smaller

**A failed sign-in answers one way.** Wrong passphrase, unknown address and
disabled account are the same sentence and the same amount of work.
508This's customers are federal contractors; the list of who they are is
worth something, and a sign-in form that answers faster for an address with
no account hands it over.

**Lockout is fifteen minutes, not permanent.** Permanent means anyone who
knows a customer's address can take them offline by typing rubbish at a
form. A control that is also a denial of service is not a control.

**Passphrases are length, not punctuation** — twelve characters, no
composition rules, no rotation, following SP 800-63B. The blocklist is
sixteen strings and the code says so: a real one is a corpus of breached
passwords, which is a data set this company does not have and should not
invent.

### What this does not solve, and should not be believed to

No password reset, no second factor, no email. The audit log is
append-only *by construction* — nothing in the repository writes an edit or
a delete — which is honest and is not tamper-proofing. Reset needs a mail
channel; a second factor for privileged access is a real 800-171 question
and not one to answer by guessing.

### Still with the Chairman

The first live drafted description, on his own machine. Whether the Hermes
submission's 76 figures are raster or vector. And now: whether an anonymous
first upload survives.

---

## 2026-09-22 — pricing, and what a price is allowed to promise

### What the Chairman said

Work on pricing.

### What was built

Three offers, each one mapped onto something the code can actually do.

| Offer | Price | Sold for |
|---|---|---|
| Assessment | free | every document, always |
| Conformance statement | $49 | anything with a text layer |
| Remediation | $149 | Word, and a PDF with tags and headings |
| Remediation | $99 | a tagged PDF with no headings — **cannot be certified** |
| Each figure past the first ten | $3 | |

`src/domain/pricing.ts` holds all of it, beside `promiseFor`, and the
central decision is structural rather than numerical: **a quote returns the
price and the promise together, and nothing returns the price alone.** The
moment those two can be separated, a pricing page separates them, and the
company is selling "508This makes your document conformant" to the majority
of customers for whom it is false.

### The arguments, since the numbers will be argued with

**The assessment is free and should stay free.** It costs pennies and it is
the only honest way to sell this: the customer learns whether the service
can help before they pay. For a scan it is the whole relationship. Charging
for "we cannot help you" is how a compliance vendor earns a reputation it
does not get back.

**Untagged PDFs are refused remediation, not discounted.** Setting a
language and a title is a real improvement and it is not $149 of work.
Selling it as though it were is the single most available way for this
company to become dishonest, and the triage says untagged is 48 of the 114
files the Chairman ran it over.

**Tagged PDFs cost less because they deliver less.** The figures get
described and the file still cannot be certified. The price is the only
place that difference is legible to somebody who is not reading the ACR.

**The unit is the figure, not the page.** The remediation market quotes per
page; per page is wrong here. The work scales with figures, because each one
is a judgement a machine cannot make. The Hermes submission's 76 figures
price at $347, or $297 if it turns out to have no headings; per-page it
would bill like a pamphlet, and it is an afternoon of somebody's life.

### What engineering got wrong and has corrected

A comment claimed a drafted description costs "a fraction of a cent". At
current rates it is one to three cents — the output tokens, thinking
included, are priced five times the input. Nothing about the raster-only
decision changes; the arithmetic is now in the README, because a pricing
argument built on a wrong unit cost is a pricing argument that collapses in
front of a customer.

### Decision needed from the Chairman

**The four numbers.** $0, $49, $149/$99, $3. They are one table in one file
and changing them is a diff that fits on a screen. Engineering's confidence
is high on the *shape* and moderate on the *levels*: the anchor is that a
specialist spends two to four hours on a tagged PDF that 508This takes to
forty minutes, at $75–$150 an hour loaded, and $149 captures roughly a third
of what it saves. Nobody has tested a price against a customer yet.

**Volume.** A contractor sends fifty documents at once and fifty separate
charges is not the shape that relationship wants. Nothing is built, and
nothing should be until somebody asks.

### Recorded, not decided

**CUI carries no surcharge.** 800-171 is a fixed cost of being this company,
not a variable cost of one document. The consequence is not a higher price;
it is that a CUI document belongs on an account with real authentication,
which makes CUI a plan rather than a line item — and puts accounts, again,
in front of everything.

**Nothing takes payment.** The job page quotes and stops. Billing before the
numbers settle is billing built twice.

### Still with the Chairman

The first live drafted description, on his own machine — no API key has ever
existed in the cloud container, so the vision path is exercised and not
proven. And whether the Hermes submission's 76 figures are raster or vector,
which the triage's `Img` column answers and which decides whether drafted
descriptions touch the document that motivated them.

---

## 2026-09-21, night — drafted descriptions, and the invariant that paid for them

### Done

The Chairman chose raster-only over a rendering dependency. It is built: a
reviewer presses a button beside a figure and gets a description to edit,
for any figure that is already a picture. Word documents almost always
qualify. PDFs often do not, and are told so in a sentence rather than left
to fail.

The product rule holds throughout: **a draft is a proposal and never a
fix.** Nothing in a document changes until a named person applies it, and
the screen says a model wrote it every time it shows one.

### The invariant that changed

`src/server/` took its first npm dependency, the Anthropic SDK. The rule as
written was “Node's own modules and nothing from npm”; what it was
protecting is that `npm test` runs with nothing installed. Those are not the
same sentence, and the difference only showed when something had to talk to
the outside world.

The rule is now stated as the guarantee it was always for: no file any test
imports may take a dependency, and CI proves it by running the tests before
it installs anything. Engineering's view is that writing an HTTP client by
hand to preserve the older wording would have been worse than the wording
was worth. Recorded plainly because an invariant that quietly loosens is a
worse outcome than one that is argued with.

### What the Chairman should know before the demonstration

**No live call has been made.** There is no API key in the cloud container,
so every path was exercised up to and including the request, and the failure
is an authentication error. The first real drafted description will be drawn
on Josh's own machine, and it is the thing to watch: the honest question is
not whether it works but whether the descriptions are good enough that a
reviewer edits them rather than retyping them.

**The Hermes submission is still the test case**, and it is unknown whether
its 76 figures are raster or vector. If they are vector, this feature does
not touch the document that motivated it, and that is the number to get from
the triage next.

### Also

Two bugs were found by writing the tests, both in the cleaning of a model's
answer, and the second is the interesting one: stripping “chart” from “A
chart of enrolment” makes a good description worse, because “chart” names
what the thing *is* rather than the medium it arrived in. The boundary
between those two is now a test.

The end-to-end harness reported the feature broken twice before a direct
call proved the logic right and the script wrong – the third harness
false-alarm of the week. Noted because the standing instruction to check
against a real file only helps if the check itself is trustworthy.

### Still with the Chairman

Pricing per tier, unchanged, and now the only strategic item outstanding.

---

## 2026-09-21, later — the vision pass met the file

### What happened

Retention was decided this morning and drafted alternative text was the
first thing it unblocked. Work started and stopped within the hour, on a
question nobody had asked: **a vision model needs pixels, and a PDF figure
is only sometimes made of them.**

The Chairman's infographic has four figures and **not one raster image in
the entire file** – no image XObjects, no inline images, and three quarters
of a megabyte of content stream holding 9,450 curve operators. The artwork is
vector. There is nothing to send. Across both real files: five undescribed
figures, zero images.

Nobody was wrong to plan the feature; the planning assumption was simply
never checked against a file, and a day of building would have produced
something that worked on a synthetic test and did nothing for the only two
real documents the company has.

### Decision needed from the Chairman

**Does 508This take a PDF rendering dependency?** It costs an invariant
either way, which is why it is not an engineering call.

1. **Take the dependency.** A renderer turns any figure into pixels, which
   makes drafted alternative text work on vector artwork – the case that
   actually turned up. It breaks the rule `src/server/` has held since the
   first commit: Node's own modules and nothing from npm. That rule is what
   makes `npm test` run in a sandbox with no npm access, and is worth
   something real.
2. **Raster only.** Draft descriptions for figures that are already images,
   and leave vector artwork to the reviewer. No new dependency, no new
   supply chain, and the feature does nothing for either file in hand.
3. **Neither, for now.** Descriptions stay a reviewer's job, and engineering
   spends the time on the heading structure work instead.

Engineering's read, offered and not acted on: **(2) first, because it is a
week and it is honest, and the triage will say how many real documents it
reaches once it runs over a contractor's folder rather than a personal
one.** (1) is a large commitment to make on a sample of two.

### Also worth the team's attention

This is the second time in four days that measuring a real file changed the
plan – the first was "mostly PDF", this is "mostly vector". Both were
cheap to measure and expensive to assume. The standing instruction from the
18th (a screen gets looked at with a real customer file before it is called
done) is extended: **a feature gets checked against a real customer file
before it is scheduled, not only before it is shipped.**

### Still with the Chairman

Pricing per tier, unchanged.

---

## 2026-09-21 — Retention, decided

The Chairman settled the decision that has gated production storage since
founding. All three parts below are **decided**, not recommended.

### 1. Documents are deleted seven days after the customer downloads them

A deliverable that is downloaded once does not need a month at rest. The
seven days exist so a customer who loses the file is not re-reviewed from
scratch, and for no other reason.

**With one consequence the question nearly missed.** The job record is not
free of document content: the Word detector writes a quotation into every
finding by design – `paragraph 4 (“Outcomes by site”)` – because a reviewer
has to find the place by eye. PDF findings carry page numbers and are clean.
Deleting the files and keeping a record full of the customer's own sentences
would be a retention policy with a hole in it, so **the record is scrubbed of
its quotations at delivery.** The `CLAUDE.md` invariant only ever covered
logs; it now covers the record.

### 2. One figure at a time may go to a vision model, under zero data retention

Never the whole document, never its text, never a Word file's XML: the
cropped image of a single figure, to draft alternative text that a reviewer
edits or rejects. Disclosed in a customer-facing policy in plain words.

The argument was one real file. The Chairman's own desktop turned up a
12-page federal submission with **76 undescribed figures** – a day of a
reviewer's time, and well under a dollar of model time at current rates.
Drafted alt text was never a cost problem; it was a permission problem, and
the permission now exists.

### 3. v1 accepts Controlled Unclassified Information

**This one went against the recommendation, and the Chairman's call stands.**
The recommendation was to decline CUI at intake, on the reasoning that most
documents needing an ACR are bound for publication and therefore are not CUI
anyway, so refusing it would cost almost no real customers and would keep the
service out of NIST SP 800-171 scope for v1.

Accepted as decided. Two things follow that the team should not discover
later:

**The two model decisions compose conservatively.** Zero data retention is a
vendor's commitment about storage; it is not a FedRAMP authorisation, and the
two are not substitutes. So **no part of a CUI document goes to a vision
model** – a document the customer marks CUI is described entirely by hand.
Recorded as the engineering reading of decisions 2 and 3 together; the
Chairman can overturn it, but it should not be overturned silently.

**Accounts stop being a v1.1 nicety.** 800-171 requires identification and
authentication. A reviewer typing their name into a box is not
authentication, and yesterday's work that moved that name onto the job record
is exactly the seam where real accounts go. Nothing that stores a CUI
document in production merges before that exists, which puts sign-in ahead of
several things previously ranked above it.

### What this unblocks, in order

1. **Drafted alternative text.** The vision pass, one figure at a time, with
   the reviewer editing rather than writing. The Hermes submission is the
   test case and the sales demonstration.
2. **Accounts and audit logging**, now required rather than deferred.
3. **Production storage**, with deletion, scrubbing and encryption at rest
   built in from the first commit rather than retrofitted.

### Still with the Chairman

**Pricing per tier.** Unchanged and now the last strategic item outstanding:
the triage says what the service can honestly promise for each of scan,
untagged, tagged and structured, and what a customer is charged for each is
not an engineering decision.

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
