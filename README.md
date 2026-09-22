# 508This

**Send us the document. Get it back conformant.**

508This is a Section 508 remediation service. A customer uploads a PDF, Word or
PowerPoint document; the service finds everything in it that fails the Revised
Section 508 Standards, fixes it, and returns the fixed document with an
Accessibility Conformance Report that a federal buyer will accept. Next.js
(App Router) + TypeScript. This repository is the whole product.

`CLAUDE.md` is the short orientation for anyone – or anything – arriving cold.
`docs/build-state.md` is where the project stands, `docs/leadership-standup.md`
is the decision log. This file is the reasoning behind the code.

---

## Getting it running

```bash
npm install
npm run dev
```

That opens the app on <http://localhost:3000>. Node 22.6 or later; nothing else
is needed, and there is no backend to point at yet.

The domain tests need no install at all:

```bash
npm test
```

They run on Node's built-in test runner, with TypeScript stripped by Node itself
and extensionless imports resolved by `scripts/ts-resolve.mjs`. The reason to
keep them dependency-free is practical: a session with no npm access – and
cloud sessions for Loadsy have never had it – can still prove the domain layer
correct, and a change that adds a dependency to the domain is caught by CI
running `npm test` *before* `npm ci`.

---

## What the product is, and is not

**A remediation service, not a checker.** The Chairman decided this at founding
(standup, 2026-09-17). A checker's output is a list of problems; the customer
still has to fix them, and the buyer still cannot accept the document. A
remediation service's output is the document itself, conformant, with the list
attached as proof. That decision shapes everything below: the unit of work is
a *job*, the things in it are *findings*, and a finding exists to be *closed*.

**Documents first.** The domain distinguishes `'web'` from `'document'` content
because the standard does (see the exception below), but whether 508This ever
takes a web page is an open question in the standup log. The product need not
offer everything the domain can model.

---

## What "conformant" means, and why the list is frozen

The Revised Section 508 Standards (36 CFR Part 1194, Appendix A, in force
since January 2018) do not define their own technical criteria for content.
E205.4 incorporates **WCAG 2.0 Level A and Level AA** by reference: 25 Level A
criteria and 13 Level AA, 38 in all. That list is `src/domain/criteria.ts`, and
a test pins the count.

It is deliberately WCAG **2.0**, not 2.1 or 2.2. Later versions add criteria
that are good ideas and are not the law. A report that marked a document "Does
Not Support" on 2.4.11 Focus Not Obscured would be asserting a legal
requirement that does not exist, and a customer who believed it would pay for
work they do not owe. Some agencies do ask for 2.1 or 2.2 AA in solicitations;
if 508This ever reports against those, it is a separate, labelled scope with its
own catalogue, never an addition to this one. `appliesTo` returns `false` for
any id outside the catalogue for the same reason: unknown ids must not
silently count.

### The E205.4 exception

Four criteria – 2.4.1 Bypass Blocks, 2.4.5 Multiple Ways, 3.2.3 Consistent
Navigation, 3.2.4 Consistent Identification – are about navigating a *set* of
web pages, and E205.4 says outright that non-web documents need not meet them.
`DOCUMENT_EXEMPT` holds those four, `appliesTo` applies the exemption, and
nothing else in the code is allowed to know about it. A document with a finding
mis-filed under 2.4.1 is still Not Applicable on 2.4.1: the standard exempts
it, and our bookkeeping does not get a vote. The test for that is the one to
read first.

---

## Findings and the report

`src/domain/findings.ts` owns two things that must never be split up: the
**status** a criterion gets in the report, and the **sentence** that states it.

The status vocabulary is the one federal buyers expect from the VPAT 2
template: Supports, Partially Supports, Does Not Support, Not Applicable. The
rules are small and the tests state them in full:

- A criterion with no *open* findings Supports. Remediated findings do not
  count, because the report describes the document we deliver, not the one we
  received. Counting them would mean a perfectly remediated document could
  never be reported conformant, which is the one thing the customer buys.
- One `partial` finding makes Partially Supports; any `blocking` finding makes
  Does Not Support. A scanned PDF with no text layer is blocking on 1.1.1; one
  chart without alt text is partial.
- An exempt criterion is Not Applicable for a document, whatever is filed
  against it.

`describeAssessment` and `describeFinding` are the only places those sentences
are written. When the wording changes, one test changes. Loadsy's history has
several bugs that were the same bug – a value defined in two places that
drifted apart – and the status/sentence pair is exactly the kind of thing that
does.

`progress` reports 0 of 0 as complete, not `NaN`. A clean document has nothing
left to do, and "NaN%" on the best possible outcome would be the first thing a
customer noticed.

---

## Intake

`/start` is one form with one file input and no client JavaScript. The
browser posts, the server action checks and redirects, and a problem comes
back as a query parameter rendered in a live region. That is deliberate: a
form that needs a script to submit is a form some assistive technology cannot
submit, and an accessibility service's front door has to open for everyone.

The checks in `src/domain/job.ts` run in the order a person can act on – pick
a file, pick a Word file, pick a smaller one – and the zip signature last,
because the most common bad upload is a legacy `.doc` renamed to `.docx`. The
name says Word; the bytes say otherwise; the person gets the sentence that
tells them to open it in Word and save it again, rather than a zip error
from three layers down. Each problem has exactly one sentence, in the same
file as the check, for the reason `findings.ts` keeps status and wording
together.

The size limit is 25 MB in the domain and 26 MB in `next.config.ts`, so the
domain's friendlier message fires before the framework's generic one.

---

## Word detection

`src/domain/docx.ts` takes the XML text of a document's parts and returns
findings. It does not take the file: unzipping is `src/server/docx.ts`'s job,
and the split is what lets every check run under `npm test` against XML
written inline in the test, with nothing installed. It is also why every
check is deterministic. A finding here can be reproduced from the document
alone. Alternative text a model *drafts* is a proposed fix, not a finding,
and belongs to the review queue.

Seven checks, each named for the criterion it serves:

- **2.4.2 Page Titled** – no `dc:title` in the core properties. Blocking: a
  screen reader announces the filename instead.
- **3.1.1 Language of Page** – no default language in the style defaults or
  the settings. Blocking: pronunciation is guessed.
- **1.1.1 Non-text Content** – a drawing with no `descr` and no decorative
  mark. Word's decorative flag is honoured, because an image marked
  decorative is correctly silent and flagging it would make the customer
  write alt text for a border.
- **1.3.1 Info and Relationships** – a table whose first row is not marked
  as a header row; a heading that skips a level; a document of twenty or more
  paragraphs with no headings at all. Heading level comes from the style's
  outline level, not its name, because that is what assistive technology
  reads and templates rename styles freely.
- **2.4.4 Link Purpose** – link text that is "click here", a bare URL, or
  nothing.
- **1.4.3 Contrast** – a coloured run against its shading, or the paragraph's,
  or white, below 4.5:1 (3:1 for 18pt, or 14pt bold). Reported once per
  paragraph and colour pair, not once per run, or a paragraph with forty runs
  of the same grey would produce forty findings.

Locations are paragraph numbers in document order, tables included, with a
short quotation, because a .docx has no pages until it is laid out and a
reviewer finds a place by its words. The quotation is the customer's own text
going into the customer's own report. It goes nowhere else.

The XML reader (`src/domain/xml.ts`) is our own and matches elements by local
name. A document round-tripped through another editor can write the main
namespace under a different prefix, and a detector that looked for the
literal string `w:tblHeader` would miss a header row that is there.

### Reading order and language, without a person

Two criteria that looked like judgement calls turned out to have
deterministic rules in Word, and moved from "reviewer" to "checked".

**1.3.2 Meaningful Sequence.** A screen reader reads a Word document in body
order. That order is wrong only when text lives somewhere else: a floating
text box, a positioned frame, or a table being used to put prose side by
side. Each of those is findable. Text boxes are `w:txbxContent`; frames are
`w:framePr`; a layout table is borderless, has more than one column, and has
a cell with more than one paragraph of text – conservative on purpose,
because a data table with borders switched off is rare and a false flag
costs a reviewer's time on every document. A document with none of these
reads in order by construction, and the report says so.

Word writes every text box twice, once in `mc:Choice` for modern readers and
once in `mc:Fallback` for old ones, with the same content. Everything under
a Fallback is invisible to every check, or each box, link, image and run in
one would be found twice. Paragraphs inside a box are not body paragraphs
either; they are located by their box, and the box's text is not part of the
paragraph it floats in. The first version got both wrong and the test for
this is the one that caught it.

**3.1.2 Language of Parts.** A passage in a language other than the
document's has to be marked, so the screen reader switches voice.
`src/domain/language.ts` finds those passages with no dependency: script
first (Han, Hangul, Cyrillic, Arabic, Thai, Devanagari decide the language
outright), then function words – the, of, and, to; el, la, de, que; le, les,
des – counted against short lists for the languages that turn up in US
federal documents. Function words are the right signal because they are
frequent, closed-class and nearly disjoint between languages once a passage
has twenty of them.

The thresholds are conservative. The criterion itself exempts proper names
and borrowed phrases, so "prepared by José García de la Cruz" must not flag
and neither must "de facto" or "ad hoc"; a passage has to be twenty words,
score clearly, and beat the document's own language by a margin. The tests
hold both those sentences quiet and a Spanish paragraph loud. Detection is
symmetric: in a Spanish document, the English paragraph is the one flagged.

The fix is deterministic: every run with text in the flagged paragraph gets
`w:lang` with the tag Word writes for that language (es-US, fr-FR, zh-CN in
the East Asian slot, ar-SA in the bidi slot), existing run properties kept.
Re-detection then finds nothing, which is the contract.

### Judgement criteria, screened

1.3.3 Sensory Characteristics and 1.4.1 Use of Color stay reviewer-class:
only a person can say whether "the box on the left" also has a label a
screen reader gets. What a pattern can do is find every sentence that needs
the judgement, so the reviewer reads twelve sentences instead of forty pages.
`src/domain/phrases.ts` holds the patterns.

A sensory phrase – a position ("on the left", "in the upper right corner"),
a shape ("the round icon"), a size ("the large button"), a sound ("until you
hear the tone") – counts only in a sentence that is telling the reader to do
something. "The chapel on the left of the plaza" is description; "click the
button on the left" is an instruction that fails without sight. "Above" and
"below" are not in the list on purpose: WCAG's own guidance treats "see the
section below" as a reference to reading order, and nearly every long
document says it.

Colour words need no instruction verb. "Required fields are marked in red"
is an instruction in effect, and "figures shown in green are final" is a
legend that nobody who cannot see green can use. "The Red Cross" and "the
Green Party" stay quiet because the patterns want the colour attached to a
thing on the page – a field, a link, a row – or to a marking verb.

Two more 1.4.1 screens work on the markup rather than the prose. A run set
in a colour among plain runs, with no bold, italic, underline or other cue,
is emphasis a colour-blind reader does not get; hyperlinks and styled runs
are skipped because their colour comes from a style that also underlines.
And every embedded chart is flagged, because a chart whose series differ
only by colour cannot be read by everyone and a chart of any kind cannot be
read by a screen reader unless its data is also given as text.

Images of text (1.4.5) would need OCR, which needs an engine. None is
available without a dependency, so that one waits for the vision model pass
the review queue will bring.

### What detection cannot see

Images of text (1.4.5), whether a flagged sentence really leaves a reader
stranded (1.3.3, 1.4.1), and whether alt text is *good* are judgement calls. They are the reviewer's,
and later a model's to propose. A check that guessed at them would produce
findings nobody can act on and, worse, a clean report on a document that
still fails.

---

## PDFs

Two real contractor files arrived on 18 September and settled the question of
what to build next. Both are PDFs out of Adobe tools, and between them they
cover the two classes the whole format divides into.

**A tagged PDF.** An InDesign infographic for a VA research centre: marked as
tagged, a language, a title, a structure tree with a document, an article,
seven stories, twelve paragraphs and four figures. Every one of those four
figures has no alternative text, there is not a single heading in it, and it
is not set to display its own title. Three real findings, all of them things
a buyer's checker would raise.

**An untagged PDF.** An Illustrator logo sheet: one page of vector artwork
with a few words set into it, no tag tree at all, no language. Tags are the
only structure a PDF has, so this one fails at the first hurdle, and until it
is tagged there is nowhere in the file to put a description of the artwork.

### The reader

`src/domain/pdf.ts` is a PDF parser, because there was no way around one. A
PDF is not a format you can skim with a regular expression: objects are
reached through a cross reference table, that table may itself be a
compressed stream, and in anything Acrobat has touched most objects live
inside other objects. The VA file keeps its entire structure tree inside an
object stream; a reader without object stream support sees an empty document
and reports it as clean, which is the worst possible failure for this
product.

So the reader handles the object grammar, classic `xref` tables, PDF 1.5
cross reference streams with the PNG predictors Adobe writes, object streams,
and the `/Prev` chains every linearized file has. Decompression is passed in
rather than imported, exactly as `domain/xml.ts` leaves unzipping to
`server/unzip.ts`, so the domain keeps its no-dependency rule and `npm test`
still runs with nothing installed.

Three deliberate refusals. An encrypted PDF is refused with a sentence saying
to remove the password, because guessing at permissions handling is how you
corrupt somebody's file. Filters other than Flate are refused, because they
decode picture data nothing here reads. And a file whose cross reference is
broken is *not* refused: the reader scans for objects instead, since a
document nobody can open is exactly the kind that arrives needing
remediation.

### What is checked

`src/domain/pdfDetect.ts`, same contract as the Word detector. Tags present;
a language; a title, and a reader told to display it; figures with
alternative text; headings, and their levels; tables with header cells; link
annotations that say where they go; whether a page paints any text at all, or
is a scan. Locations are page numbers, which makes a reviewer's job easier
here than in Word, where a `.docx` has no pages until it is laid out.

The role map is applied before any tag is read. InDesign tags paragraphs with
the designer's own style names and maps them in `/RoleMap`, so a detector
that read the raw tag would see no paragraphs in the VA file and stay silent
on a document with no headings.

### Why coverage is now per format

The report's honesty line had to grow. `WORD_COVERAGE` said what a Word file
can be checked for; a PDF is not the same document. A `.docx` names its text
colour in an attribute, so contrast is checked. A PDF paints text with
operators in a content stream, and short of interpreting the whole graphics
state nothing here can measure it, so for a PDF contrast is a reviewer's job
and the statement says so in the remark.

Seven criteria need a person for a PDF against four for a Word file. That is
the honest count, and it is the whole reason `ContentKind` is now `'web' |
'docx' | 'pdf'` rather than `'web' | 'document'`: the format decides what the
service may claim. Reporting a PDF against the Word coverage table would
claim seven checks that never ran, which is the same lie as saying "Supports"
on nothing.

### Triage: what kind of PDF is it?

A PDF is four different products wearing one file extension, and which one a
customer has sent decides whether the service can certify their document,
improve it, or do nothing useful at all. `npm run triage -- <folder>` reads a
folder of real documents and says which.

| Tier | What it is | What 508This can honestly do |
|---|---|---|
| **scan** | no text layer on any page | nothing. Pictures of words need OCR first, which this is not |
| **untagged** | real text, no tag tree | language and title, and that is all. **Cannot be certified** |
| **tagged** | a tag tree with no headings in it | alternative text on the figures; the missing heading structure is the gap |
| **structured** | tagged, with headings | the closest to certifiable; usually alt text and a reviewer's judgement |

It exists because the roadmap after PDF-first depends entirely on what
fraction of real customer documents are already tagged, and **guessing that
number and building for the guess is how a remediation service ends up able
to fix the files nobody sends.** Structure editing only reaches the last two
tiers. If most of a customer's documents are untagged, the right answer is
not more engineering, it is a different offer.

`src/domain/triage.ts` also owns `promiseFor(tier)` — the sentence the
service may truthfully say about a document of that kind. It lives with the
code rather than in sales copy so it cannot drift from what the software
actually does, and a test asserts that the two tiers which cannot reach
conformance say so in as many words.

The script prints counts, page numbers and tags and **never a word of any
document's contents**. It runs on the customer's own machine over their own
folder; the output is the sort of thing somebody pastes into a chat, and
these are federal records.

### What a figure is made of, and why the vision pass stopped

Retention was decided on 21 September and drafted alternative text was
unblocked. It did not get built, and the reason is worth more than the
feature would have been.

A vision model needs pixels. **A PDF figure is only sometimes made of
them.** Artwork out of Illustrator or InDesign is vector – path operators in
a content stream – and there is no image anywhere in the file to send. The
Chairman's infographic is the case in point, measured rather than assumed:

```
page 1 resources:   ExtGState Font ProcSet Properties Shading   (no XObject)
image XObjects:     0 in the entire file
inline images:      0
content stream:     753,687 bytes – 9,450 curves, 1,651 fills and strokes
figures:            4, none of them described
```

Four figures, nothing to send for any of them. Getting pixels would mean
rendering the page: graphics state, path construction and painting, Bézier
flattening, clipping, colour spaces, the shadings this file uses,
transparency from `ExtGState`, and fonts for text inside the artwork. That is
a PDF renderer. It is a product, not a feature, and writing one to draft a
sentence about a chart is the wrong trade.

So the triage now reports it. `rasterImages` in `PdfFacts` counts image
XObjects anywhere in the file plus inline images painted into a page, and
`canDraftAltText` asks the only question that matters for this feature: does
this document have a figure nobody has described **and** pixels to send for
it? Both real files answer no.

The choice that follows belongs to the Chairman, because it costs an
invariant either way: take a rendering dependency, which `src/server/` has
refused from the first commit, or accept that vector figures are described
by hand and build the vision pass only for documents that carry raster
images. Nothing was built on a guess about which.

### Drawing a figure that is not a picture

The Chairman took the rendering dependency on 22 September, on evidence he
produced himself: **three real PDFs, eighty-odd figures, not one raster
image among them.** The artwork in the documents this business receives
comes out of Illustrator and InDesign, which means it is paths, which meant
the drafting feature reached none of it. `src/server/render.ts` turns those
paths into pixels.

#### The crop is the whole safety argument

This renders **one figure, never a page**. That is not a nicety. The
standing rule is that one figure's image is all that ever leaves — never
the whole document, never its text — and a rendered page is a picture of
the page's text. Rendering a page and sending it would break the retention
decision while appearing to honour it.

So the figure's bounding box is what makes the dependency acceptable at
all, and the box comes from the document: a `/Figure` element carries
`/A << /O /Layout /BBox [x0 y0 x1 y1] >>`, which PDF/UA requires for a
figure that is not inline. Every figure in the Chairman's infographic has
one. `figureBox` reads it; **no box means no render**, and the reviewer is
told, exactly as they were before a renderer existed.

The page is drawn shifted so the box lands at the origin of a canvas cut to
the box's size. Everything outside falls off the edge and is never
composited. Text *inside* the box is drawn, and that is correct — a chart's
own axis labels are part of the chart.

#### Two packages, and the one that was refused

`pdfjs-dist` (Apache-2.0) and `@napi-rs/canvas` (MIT). **MuPDF is the better
renderer and it is AGPL**: linking it into a commercial service means
publishing the service, and Artifex's commercial licence is a decision
several sizes larger than this feature. The licence, not the quality, is why
it is not here.

Both load through `await import` from a file no test imports — the same
arrangement `vision.ts` has, for the same reason — so `npm test` still runs
with nothing installed. Both are in `serverExternalPackages`, because
`@napi-rs/canvas` loads a platform `.node` binary and a bundler that traced
it would produce a build that works on one machine and not the next.

Nothing is fetched while rendering: no font files, no character maps, no
system fonts, no annotations. A renderer that reaches the network on a
server holding federal records is a renderer that tells somebody it has
them.

#### Where the drawing happens, and why not sooner

On demand, one figure at a time, in the figure route — not in the batch the
review page uses. A submission with 76 vector figures would otherwise
render all 76 before the page painted a pixel. This way the page draws
immediately and the browser fetches the images as it fetches any other, in
parallel.

#### What it does to the two real files

| | Before | After |
|---|---|---|
| CHERP infographic (tagged) | 4 figures, 0 drawable | **4 of 4 drawn**, 0 "describe it yourself" |
| Hokua logo sheet (untagged) | nothing | nothing, and it says why — no tag tree, so no box |

### Drafted descriptions

A reviewer describing 76 figures by hand is the reason this exists. The
button beside a figure asks a vision model for a description and puts it in
the box the reviewer was about to type in. **It is a proposal and never a
fix**: nothing in the document changes until a named person presses apply,
and the screen says a model wrote it every time it shows one. A wrong
description is a finding, not a remediation.

**What leaves the box is one picture.** `src/server/vision.ts` is the only
module in the repository that talks to anything outside this service, and it
sends the image of a single figure and the instruction – never the document,
its text, its filename, or a Word file's XML. For a job the customer marked
CUI, `propose` refuses before any of that happens, and the page does not
offer the button either; the page alone would not be enough, because a page
is a thing a person can navigate around.

**Getting the picture is the hard half, and usually it fails.** The two
formats hide an image in different places:

| | Where the picture is | How often there is one |
|---|---|---|
| `.docx` | a real part in the archive (`word/media/chart.png`), reached through the drawing's relationship id | almost always |
| PDF | an image XObject drawn inside the figure's marked-content span | **often not at all** |

A PDF figure holds a marked content id, not an image; somewhere in the page's
content stream is `/P <</MCID 24>> BDC … EMC`, and the picture exists only if
something inside that span draws one. On design work it usually does not:
the artwork is vector, and `figureImage` reports `vector`, which is an answer
rather than a failure. The reviewer is told to describe it themselves instead
of being invited to try again at something that cannot work.

**What comes back is cleaned before it is shown.** `normaliseDraft` strips
the opener that describes the medium – a screen reader already announces
that it is an image, so "Image of a bar chart" is read as "image, image of a
bar chart". That list is **only medium words**. "Chart", "diagram", "map" and
"logo" name what the thing *is*, which is content: a reader is better served
by "Bar chart of enrolment by year" than by "Enrolment by year". Stripping
those was the first version of the function and it turned good descriptions
into worse ones; a test now pins both halves.

The instruction tells the model to reply `CANNOT DESCRIBE` rather than guess,
and a decline is shown as one. A confident invention is the worst thing this
product can generate: it reads well, a reviewer accepts it, and the document
ships with a lie where a description belongs.

**The reviewer sees the figure.** This is the half that makes the other half
honest. A description cannot be checked against a picture nobody can see,
and a drafted one least of all: a confident invention reads well, and a
reviewer with nothing to compare it to accepts it. `/jobs/<id>/figure` serves
the image from the customer's own document, in the reviewer's own browser,
`private, no-store`, and it appears directly above the box they type in.
When there is no picture – vector artwork, an unsupported filter – the same
place carries the sentence saying so, because a broken image icon is worse
than an honest explanation.

The page asks about every figure at once: `imagesForFindings` opens the
document once and answers for all of them. Asked one at a time, a submission
with 76 figures would reopen and reparse the file 76 times to draw one
screen, and the real submission in hand has 76.

**A misconfigured server is not a model declining.** An authentication,
permission or rate-limit error becomes "drafting is not configured", not "the
model could not describe this figure" – they are different problems and only
one of them is the reviewer's to work around.

### What is not here yet

Writing fixes back into a PDF. The job page says so plainly rather than
offering a button that does nothing. Three of the findings on these two files
have one right answer and are a small change to the catalogue – a language, a
title, the flag that displays it – and the right way to make them is an
incremental update, appending the changed objects and a new cross reference
so every byte of the original is preserved. That mirrors what the .docx path
already does by writing changed parts over the original archive, and it is
the next branch. Building a tag tree for an untagged file is the harder half
and comes after.

---

## What "Supports" is allowed to mean

The report's honesty line is `DOCUMENT_COVERAGE` in `src/domain/criteria.ts`.
A criterion with no findings is not thereby met. It is met on one of three
bases, and each criterion is assigned one:

- **checked** – an automated check looked and found nothing. Eight criteria
  for a Word file and five for a PDF, plus 4.1.1 Parsing, which the reader
  itself vouches for.
- **static** – a Word document with no interactive or time-based content has
  nothing the criterion governs: keyboard traps, timing, flashing, focus,
  forms, captions. Twenty-two criteria. The detector emits a `media` or
  `forms` finding if it sees a recording or a form field, which moves the
  criterion out of this class for that document.
- **reviewer** – only a person can tell: colour as the only signal,
  instructions that rely on shape or position, images of text, whether
  headings describe their sections. Four criteria.

A reviewer-class criterion nobody has confirmed is **Needs Review** in the
report, never Supports. That is not a VPAT term and the statement says so in
its footnote. The alternative – counting "nobody looked" as "Supports" – is a
false statement to a federal buyer, and the verdict therefore has three states,
not two: does not conform yet; passes every automated check but N criteria
wait on a reviewer; conforms. The middle one is the honest one, and it is the
one a document lands on after automatic remediation. A test pins that with
nothing confirmed, an empty findings list is *not* conformance.

---

## Remediation

`src/domain/remediate.ts` fixes what has one right answer and leaves the rest.
Marking a table's first row as its header, setting the document language,
closing a skipped heading level, darkening a grey until it meets 4.5:1: each
is a change detection can verify afterwards. Alternative text, link wording
and which bold paragraphs are really headings have no single right answer,
and a confident wrong one is worse than a finding, so those go to a reviewer.

The contract with the job store is the honest part. After remediation the
output is re-detected, and a finding is marked remediated **only if
re-detection no longer finds it** – not because a fix claims to have handled
it. What re-detection still finds stays open; anything new it finds is added.
A fix that broke something cannot hide.

Some particulars, each the answer to a way the first version was wrong:

- The output is the original archive with the changed parts written over
  it, not a reconstruction. Images, fonts, numbering and comments are carried
  across byte for byte; a run on a real document changes two parts of
  eighteen.
- `src/server/zip.ts` writes the real CRC for every entry, from `node:zlib`.
  Word opens an archive with a wrong CRC as "corrupt", which is the one thing
  a remediation service cannot hand back. A test reads the CRCs out of both
  headers and checks them.
- The heading fix pulls a level *up* to the previous plus one, in document
  order, so H1 → H3 → H3 → H5 becomes H1 → H2 → H3 → H4 without flattening
  the outline. If the style it needs does not exist, one is added in the shape
  Word's built-in headings take.
- The contrast fix bisects along the line from the colour to black (or white
  on a dark fill) for the smallest change that passes, and drops any theme
  colour on the run, which would otherwise override the literal. #999999 on
  white lands on #767676, the well-known just-passing grey.
- A document with no `docProps/core.xml` gets one, registered in the content
  types and the package relationships, because a title nothing can find is
  not a title.

The XML goes through `parseXml` and back through `serializeXml`; a test pins
that the round trip is a fixed point, so a remediated document differs from
the original only where a fix touched it.

### Kicking it off, and what comes back

One button on the job page, disabled when nothing on the page can be fixed
without a person. It runs the fixes, stores `remediated.docx` beside the
original, re-detects, and sends the customer back to the same page, which now
offers the remediated document, the original, a list of what was changed, and
the conformance statement. The download names the file "report (remediated)
.docx" so it never overwrites the original on the customer's disk, and the
customer's filename goes through a quoted, escaped header and nowhere near a
path.

`/jobs/[id]/report` is the conformance statement: every criterion, its level,
its conformance and its remark, in the layout of an Accessibility Conformance
Report, printable, with the three-state verdict on top. It is rendered by the
same functions as the job page. When nothing is open and nothing waits on a
reviewer it says "Conforms to Section 508", and not before.

---

## The review queue

`/jobs/[id]/review` is where a person finishes what the machine started, and
it is the reason the statement can ever say "Conforms". Three things live
there.

**Findings to decide.** Everything still open after automatic remediation,
one item at a time, with the place, the quotation and the plain-language
reason beside it. What the reviewer can do depends on the kind, and
`REVIEW_INPUT` in `kinds.ts` says which. An image takes alternative text, or
a decorative mark; a link takes new wording. Both are written into the
document. Everything else – a sentence that relies on position, colour as
the signal, a text box, a chart – takes only a dismissal with a reason,
because the fix is a change to the prose or the layout that a person makes
in Word, and the queue records the judgement rather than pretending to make
the change. A dismissed finding does not count against the criterion, and
the report says who dismissed it and why.

**Criteria to confirm.** The four criteria only a person can vouch for, each
with its remark, and a Confirm button that is disabled while any finding on
it is still open. Confirming moves the row from "Needs Review" to "Supports"
under the reviewer's name.

**A name, asked before anything can be decided.** A statement with nobody's
name on it is not an assurance, and an Accessibility Conformance Report is a
representation to the government, so every decision is attributed. The
reviewer says who they are once; `identifyAction` writes it to the job, and
everything afterwards reads it from there.

That is the second version of this. The first carried the name in a hidden
field on each decision form, with a note at the top of the page promising
"type it once; each button below carries it" — which the page did not do,
because until a first decision existed there was nothing to carry, so every
form rendered its own "Your name" box instead. On the VA infographic, with
four undescribed figures and three forms each, that was **fifteen name boxes
on one screen** under a heading saying the opposite. It was found by
demonstrating the product rather than by a test, which is the argument for
running the thing end to end and looking at it.

Two things fixed it. The name moved to the record, so the page has exactly
one field however many findings the document turned up and the actions read
the name server-side rather than trusting a field the form supplies. And the
decision controls appear only once there is a name — which is also the
honest order, because a decision nobody's name is on is not worth recording.
Until then the findings are listed to read, with a line saying what unlocks
them.

Handing over is a form too, under a disclosure. Decisions already made keep
the name they were made under: re-attributing somebody else's judgement is
forging a signature, and a test pins it.

Every decision goes through one path in `src/server/jobs.ts`: the delivered
document is rebuilt from the original – automatic remediation, then the
reviewer's applied decisions, then re-detection – so it is a pure function
of the original and the record, and undoing a decision is rebuilding without
it. Applied fixes find their target by an *anchor* the detector left on the
finding (`docPr:12`, `hyperlink:3`), never by paragraph number, because
automatic remediation may have run first and the anchor is the one thing it
does not move. What the reviewer sees afterwards is what re-detection says,
not what the button claimed; an applied decision that re-detection still
finds is shown as "not applied", which is a bug report against the fix.

There is no client JavaScript on the page. Every button is a form, the name
field is an ordinary input, the handover is a `<details>`, and a missing name
or reason comes back as a sentence in a live region.

### What is deliberately not here yet

Model-drafted proposals. The queue works today with the reviewer writing the
alt text and the link wording; the next step drafts them with a vision model
and a language model so the reviewer edits instead of writes. That is the
first part of the product that sends anything out, and it waits on the
retention decision. Accounts are also not here: the reviewer is a name typed
on the job, which is right for a service run by one person and wrong the day
there are two. What it buys in the meantime is that the name is *stated*
rather than inferred, so the day it becomes a signed-in identity there is one
place to change.

---

## Reading the result

The job page is the report, and it is written in the order a customer asks
the questions, not the order the standard lists its clauses.

**The verdict first.** "Does not conform to Section 508 yet", then one sentence
with the numbers: how many of the criteria it owes have open issues, how many
issues, how many are blocking. A person who reads nothing else knows where
they stand. `summarise` and `describeSummary` in `findings.ts` produce it.

**Findings grouped by kind, not by criterion.** A criterion number means
everything to a specialist and nothing to a communications lead, and one
criterion covers different problems: 1.3.1 is both a table without a header
row and a heading that skips a level, which have different causes and
different fixes. So every finding carries a *kind* as well as a criterion.
`src/domain/kinds.ts` is the table of kinds, and each owns three sentences:
its name in plain words, why it matters to someone using assistive technology,
and what we do about it. The page groups by kind, blocking first, then the
kinds with the most places to fix. The ACR still scores by criterion. A test
pins that every kind maps to a criterion in the catalogue and that every
finding the detector emits carries a kind, so the report cannot group a
finding under one heading and score it under another.

**The criteria it meets are there, but not first.** The conformance table
lists only the shortfalls, in the Supports / Partially Supports / Does Not
Support wording a buyer expects, with the remarks the ACR will carry. The
criteria it already meets sit under a native disclosure, because the report is
a claim about all of them and a buyer may want to see the passes, but
twenty-eight rows of "no open issues" are not the news. The four E205.4
exemptions are a footnote, named, so nobody wonders why the count is 34.

**State is a word, not a colour.** Each place is labelled Blocking, Open or
Fixed in text, with a border and no fill, so the page passes 1.4.1 Use of
Color on its own report.

---

## The statement as a file

The job page and the printable statement are for reading. What the customer
actually needs to hand over is a file: a contracting officer wants the
Accessibility Conformance Report in their record, attached to the proposal,
and a URL that may not resolve in two years is not a record. So
`/jobs/<id>/report/download` returns the statement as a **Word file**.

Word and not PDF, which is the choice a 508 vendor is expected to get wrong.
A customer's next move with a conformance report is to paste it into a
proposal, into their own VPAT, or into a spreadsheet of criteria their
compliance office keeps; a PDF is where text goes to stop being editable.
The irony of a remediation service shipping an inaccessible PDF of its own
statement is the second reason.

**One model, two renderings.** `src/domain/acr.ts` computes the report once
from the job — the facts, the verdict, one row per criterion, the notes — and
both the page and the .docx lay out what it produced and decide nothing.
Statuses still come from `assess`, remarks from `describeRemarks`, the
headline from `describeSummary`; nothing in the ACR module rewords them,
because a report that reworded its own remarks would be a second opinion on
the same evidence. Before this existed the report page computed its own
table, which is exactly the shape of the bug this repository keeps finding:
one concept, two definitions, drifting.

Two things the model owns that neither rendering may override:

- **The date is written out.** `reportDate` maps a month to its name rather
  than calling `toLocaleDateString`, because a Node build without full ICU
  formats the same instant differently and the same job must produce the same
  statement on every machine that renders it.
- **A draft says so.** A statement with a criterion still waiting on a
  reviewer is an honest working document and a dishonest deliverable. It
  carries "Draft — not a deliverable" at the top, the count of what is
  outstanding, and a note saying Needs Review is not a conformance term. That
  is the same line `describeSummary` draws; the file just cannot be handed on
  without it being visible.

**The file is built, not stored.** It is a function of the job, and the job
is what changes — a reviewer confirms a criterion and last minute's draft is
this minute's deliverable. Storing the .docx would mean two records of one
assessment and a way for them to disagree. The timestamp written into it is
the job's, not the clock's, so downloading twice gives identical bytes and a
customer comparing two copies is not told they differ.

### It is built by hand, and it passes 508This

`src/domain/acrDocx.ts` writes every byte of the WordprocessingML: the
document, the styles, the relationships, the content types, the core
properties. No template file is checked in, which keeps `npm test` runnable
with nothing installed and keeps a binary out of the repository;
`src/server/acr.ts` adds the two things the domain may not have, a UTF-8
encoder and the zip from `server/zip.ts`.

The constraint that shaped it is that **the conformance report is itself a
document 508This finds conformant**, and a test asserts precisely that: build
the report, zip it, unzip it, read the parts, run `detectDocx`, expect no
findings — for a Word job, a PDF job, a job with open findings and a
remediated one. A negative control was run against each fix in turn (strip
the language, strip the title, strip the header rows, strip the heading
styles) and each produces exactly the finding it should, so the green is not
green because the test is looking at nothing.

What that constraint forced:

- Headings are real heading styles carrying outline levels, running 1, 2, 2,
  2… with no skips — the same thing the product demands of a customer.
- Every table names its header row with `w:tblHeader`, so a conformance level
  is read with its column name and the header repeats across a page break.
  Each table also carries `w:tblDescription`, which a screen reader announces
  before the first cell.
- **Nothing in the report is marked by colour.** A row still waiting on a
  reviewer is the obvious thing to tint, and tinting it would be a 1.4.1 Use
  of Color failure of exactly the kind the report flags in other people's
  documents. The status word carries the signal, and the remarks say it again
  in a sentence.
- The document declares its language and carries a title — the two findings
  the detector raises against almost every file that arrives.
- A customer's filename goes into the title and the first table, so it is
  escaped as XML and stripped of control characters, which Word rejects
  outright. A file called `Q3 <Draft> "final" & more.docx` has a test.

The check that matters most is not in the test suite: the generated report
was uploaded back into the running product as a customer document. It comes
back "Passes every automated check — no open issues", with the four reviewer
criteria outstanding, which is the honest verdict for any Word file nobody
has read yet.

---

## What it costs, and why a price is a claim about capability

`src/domain/pricing.ts` decides what 508This charges. It is here in the
domain, next to `promiseFor`, for the same reason `promiseFor` is: **a price
is a claim about what the software will do, and a claim kept somewhere other
than the code drifts away from the code.** The function that produces a
quote returns the number and the promise in one object, and there is no
function anywhere in the repository that returns the number on its own. That
is not stylistic. A remediation service whose price is separable from its
promise will separate them the first time somebody builds a pricing page.

### Three offers, each one a capability the code has

| Offer | Price | What it is |
|---|---|---|
| **Assessment** | free | every finding, the tier, the promise. The whole of this page's report |
| **Conformance statement** | $49 | the reviewer-attested ACR, as a page and as the Word file a contracting officer files |
| **Remediation** | $149, or **$99** where the service cannot certify | the statement, the review queue, drafted descriptions, and the changed file |

The assessment is free and should stay free. It costs pennies to run, and it
is the only honest way to sell this: **the customer finds out whether the
service can help them before they pay.** For a scan it is the entire
relationship, because a scan is pictures of words and 508This does not do
OCR — charging for "we cannot help you" is how a compliance vendor earns a
reputation it does not get back.

### Why remediation is cheaper on a tagged PDF

Because it delivers less, and the price is where that has to show. A tagged
PDF with no headings gets its figures described and **still cannot be
certified**; that is worth real money and it is not worth the same money as a
document the service can carry to conformance. So `PRICES.remediation` has
two entries, and a test holds the invariant: *no tier the service cannot
certify is charged the certifiable price*, with a negative control asserting
that at least one tier is certifiable, since the first test would pass
happily if remediation were refused on all four.

An untagged PDF is refused remediation outright. Setting a language and a
title is a real improvement and it is not a hundred and fifty dollars of
work, and selling it as though it were is the single most available way for
this company to become dishonest. The refusal says so in the customer's
words, on the job page, above the button.

### Why figures and not pages

The remediation market quotes per page. Per page is wrong for this product:
the work does not scale with pages — a 200-page untagged report is one
language fix — it scales with **figures**, because each figure is a judgement
a machine cannot make. A six-page infographic with 76 figures is an
afternoon, and per-page pricing would charge it like a pamphlet. So the flat
price covers the first ten figures and each one after that is $3, about what
two minutes of a reviewer's time costs. The Hermes submission — 76 figures —
prices at $347 if its tags carry headings and $297 if they do not, against
the CHERP infographic's four figures and nothing extra.

The drafted description is not what that $3 buys. One draft costs **one to
three cents** of model time: a document figure is on the order of a thousand
input tokens at $5 per million, and the answer, thinking included, is priced
five times higher again. The surcharge is two orders of magnitude above the
compute because it is buying the reviewer's attention, which is the scarce
thing. (The comment in `src/server/vision.ts` said "a fraction of a cent"
until somebody did that arithmetic. It is corrected.)

### What is not priced yet

**CUI carries no surcharge, and should not.** Accepting Controlled
Unclassified Information brings NIST SP 800-171 into scope, and that is a
fixed cost of being this company rather than a variable cost of one
document. The consequence is not a higher price, it is that a CUI document
belongs on an account with real authentication — a reviewer typing their
name into a box is not authentication — so CUI is a plan and not a line item.

**Volume is undecided.** A contractor with a deliverable run sends fifty
documents at once, and fifty separate $149 charges is not the shape that
relationship wants. Nothing is built for it because nothing should be built
for it before a customer has asked.

**Nothing takes payment.** The job page quotes; there is no checkout, no
Stripe, no invoice. Building billing before the numbers are settled would be
building it twice.

---

## Accounts, because a name in a box is not authentication

`setReviewer` takes a name a person types and writes it beside every
decision on a federal conformance statement. For a service one person runs
that is right. It is not authentication, and the Chairman's decision to
accept Controlled Unclassified Information is what makes the difference
matter: NIST SP 800-171 requires that users are identified and that the
identity is *authenticated* before they reach the system. A job id in a URL
identifies nobody — anyone holding the link is the reviewer.

This is the identity layer that goes under that. **It is the foundation and
not yet the enforcement**: there is no sign-in screen in this change and
nothing is gated by it. That is deliberate. Half-built authentication is
worse than none, because it looks like protection; what ships here cannot
look like anything, because no page mentions it.

### What is here

| File | What it decides |
|---|---|
| `src/domain/account.ts` | what an address and a passphrase have to be, and the sentence shown when they are not |
| `src/domain/session.ts` | the two session clocks and the lockout rule, as pure functions over a time you pass in |
| `src/domain/audit.ts` | the shape of an audit record — and, structurally, what cannot go in one |
| `src/server/passwords.ts` | scrypt, from `node:crypto`, with the parameters written into every hash |
| `src/server/accounts.ts` | the store, sign-in, and the single answer a failure gets |
| `src/server/sessions.ts` | tokens the server never stores, and the cookie that carries them |
| `src/server/audit.ts` | one append-only file per account, plus one for the events that belong to nobody |

### An audit record has no free-text field, and that is the design

800-171 wants records sufficient to trace a user's actions. This
repository's oldest rule says nothing about a document's contents goes into
a log. Those pull against each other the moment somebody adds a `detail`
field "just for debugging" and a reviewer's dismissal note — which quotes
the customer's own sentence — lands in it. That is not hypothetical: the
Word detector puts the customer's sentences into every finding, which is why
delivery scrubs them from the job record.

So the resolution is structural. An `AuditEvent` carries a time, an account
id, an action from a closed list, and at most one subject — and `auditEvent`
**throws** if the subject is not a UUID. There is nowhere for a quotation to
go, and a test proves it by trying to put one there, with a negative control
so the check cannot pass by refusing everything.

What is lost is context: an event says a finding was decided, not which way.
That is the right trade. The decision is on the job record where it belongs;
the log says who touched what and when. A log that held the content too
would be a second copy of every customer document under a retention policy
nobody wrote.

### Length, not punctuation

The passphrase rules are a 12-character minimum, a 128 ceiling, no
composition requirements, and no scheduled rotation. That follows SP 800-63B,
which is where 800-171's identification and authentication requirements
point: mandatory mixed case, digits and symbols push people towards
`Summer2026!` and a sticky note, and none of it survives an offline attack
any longer than a longer phrase does. Twelve rather than the floor of eight
because of what this service stores.

The blocklist is sixteen strings and the code says so. A real one is a
corpus of breached passwords, which is a data set 508This does not have and
should not invent; what is here catches what people type when they are not
really choosing a passphrase. **It is a floor, not a screen**, and when a
breach corpus is available this is where it goes.

### scrypt, and why not Argon2id

Argon2id would be the modern first choice and it is not in the standard
library. `scrypt` is in `node:crypto`, it is memory-hard, and it is what
lets the hashing code exist with no dependency — which matters more than
usual here, because a password hash is the wrong place to take a
supply-chain risk. N=32768, r=8, p=1: about 32 MB and a fraction of a second
per attempt, unnoticeable at a sign-in and ruinous at scale against a stolen
table.

The parameters are written into every stored hash (`scrypt$N$r$p$salt$key`),
so raising them later does not invalidate what is already on disk — an old
hash still says how to verify itself, and the account is re-hashed at its
next successful sign-in, which is the only moment the passphrase is in hand.
A stored record asking for *more* memory than the current parameters is
refused rather than attempted: an absurd N in a tampered file is a way to
make one sign-in exhaust the machine.

### One answer for every failure

A wrong passphrase, an address with no account, and a disabled account all
return the same thing and all spend the same scrypt work — `spendTime`
exists so that the failure with nothing to check still costs what a real
check costs. Without it the single honest sentence would be undone by a
stopwatch: a fast answer means no such account, and on a service holding
federal documents the customer list is itself worth something. The same
reasoning keeps the address out of the index's file names, which are
SHA-256 digests: a directory listing is a thing that gets backed up, synced
and screenshotted.

The one failure told apart is a lock, and only after the passphrase has been
checked. It leaks nothing a person could not learn by guessing five times,
and the alternative is somebody who mistyped their own passphrase being told
"those do not match" for fifteen minutes while typing it correctly.

Lockout is fifteen minutes, not forever. Permanent lockout means anyone who
knows a customer's address can take them offline by typing rubbish at a
form, which turns a control into a denial of service.

### Two clocks on a session

Thirty minutes idle, eight hours absolute, and it needs both. Idle timeout
protects the reviewer who walked away from a terminal with a customer's
document open — the common case, and what 3.1.10/3.1.11 are about. The
absolute ceiling bounds a *stolen* token: refreshing on activity means an
attacker holding the cookie can keep it alive forever, so there is a limit
no amount of activity moves.

The token is 32 random bytes and the server stores only its SHA-256. Anyone
reading the session files learns which sessions exist and nothing that lets
them become one. A fast hash is right here and wrong for a passphrase: a
passphrase is chosen by a person and must be expensive to guess, a token is
256 bits of randomness and cannot be guessed at any price, so scrypt would
buy nothing and be paid on every request.

### Every job has an owner, and a link is not one

A job now belongs either to an **account** or to a **visitor** — one
browser, one cookie, no name. That two-way split is what lets both of the
Chairman's decisions stand at once. Pricing says a customer should find out
whether the service can help them *before* they pay, so a sign-up wall in
front of the first upload is out. CUI says an identified, authenticated user
has to be on the other end, so "anyone holding the link is the reviewer" is
also out.

| | A visitor may | An account may |
|---|---|---|
| Upload a document | yes | yes |
| Read the assessment | yes | yes |
| Mark it CUI | **no** | yes |
| Decide findings, name a reviewer, draft a description | **no** | yes |
| Run automatic remediation | **no** | yes |
| Download the document or the statement | **no** | yes |

The second column is the paid column, and that is not a coincidence — it is
the same line `src/domain/pricing.ts` draws. A visitor gets the free
assessment and nothing that produces a deliverable, because a deliverable
carries a name and a cookie is not a name.

**Upload first, sign up second** is the sequence this creates, so it is
built for: `mayOpen` lets a signed-in person read a job their *own browser*
uploaded before they had an account, and `claimJobs` transfers it at
sign-in. A job already owned by an account is never reassigned by a cookie.

**A record with no owner belongs to nobody.** Jobs written before this
existed fail closed. That costs a developer a re-upload; failing open would
have left every one of them readable by anyone who ever had its link, which
is the thing being fixed.

### One door, and a test that counts the doors

`src/server/access.ts` is the only thing in the codebase that hands a job to
a page. Nothing under `src/app/` calls the store for one — a test walks the
directory, reads every import of `@/server/jobs`, and fails on anything
outside a three-name allowlist (`createJob`, `claimJobs`, and the `JobFile`
type). A check written at nine call sites is a check missing from the tenth,
and the tenth is the one that ships.

"Not yours" and "no such job" are the same 404, with the same page. Telling
a stranger that a document exists but is somebody else's tells them that a
document with that id is here and that whoever sent them the link is a
customer.

### Mail, and the lie it lets the service stop telling

Two answers in this service are deliberately uninformative, and both of them
cost somebody something. A sign-up against an address that already has an
account is answered exactly as a successful one; a reset request is answered
the same way whether or not the address has an account. Both are right — a
form that answers differently is a tool for finding out who 508This's
customers are, and they are federal contractors — and both leave a person
who has genuinely forgotten stuck on a page with nowhere to go.

**The address itself is the only channel where the truth is safe to say**,
so that is where it gets said. `/account/forgot` sends a link;
`/account/reset` spends it.

#### A letter is a fixed template plus at most one link, and the link must be ours

`letterFor` in `src/domain/mail.ts` takes a closed `Letter` union and
**throws** if the URL it is handed is not on 508This's own origin. That is
the same move the audit record makes and it is not paranoia about typos:

- A reset link is a credential. A template that renders whatever link it was
  given is a phishing page with our return address on it.
- There is no free-text field, so the day somebody threads a "reason" or a
  filename through to a mail body, they will have to widen the type to do it
  — rather than doing it by accident and posting a customer's document out
  of the building.

A test tries seven wrong links, including `https://508this.example.evil.test`
(the prefix trick a naive `startsWith` falls for), with a negative control so
the check cannot pass by refusing everything.

#### The origin is configuration, never a request header

`src/server/origin.ts` reads `PUBLIC_BASE_URL` and refuses to guess in
production. A reset link built from the request's own `Host` header is a
credential mailed to the right person pointing at somebody else's server,
and the person who clicks it hands over their account without seeing
anything wrong. It is an old bug and it is still the commonest way this
feature is broken.

#### Thirty minutes, once, and everything signs out

The token is 32 random bytes and only its SHA-256 is stored, exactly as with
a session. A completed reset ends **every** session the account has: people
reset a passphrase because they think somebody else has it, and leaving that
somebody signed in makes the reset theatre.

The link is marked used *before* the new passphrase is checked, so a
passphrase that fails the policy still burns it. That is inconvenient and it
is the right way round — the alternative is a live link somebody can sit and
try passphrases against.

#### No SMTP, and no package either

Mail goes out as one HTTPS `POST` with a bearer token, which `fetch` does
without a dependency. SMTP by hand is a week of work and a security surface;
a package would be a supply-chain risk in the code path that carries
credentials. The shape in `post()` is Resend's; naming a provider in six
lines of code is not a commitment.

With no token configured, letters are written to `accounts/outbox/` instead
of being sent — which is how the reset flow is developed and tested without
mailing anybody. **That is refused outright in production**: a service that
silently writes password-reset links to local disk because somebody forgot
an environment variable is worse than one that cannot send mail at all,
because it looks like it is working. Both the forgot page and the
check-your-mail page say which of the three is happening on this build.

### What is deliberately not here yet `createAccount` returns `taken` to its caller and that must
never reach a form — "that address already has an account" tells a stranger
who the customers are. The screen, when it exists, has to say the same thing
it would say on success and send mail to the address, which is the only
channel that can safely tell the truth.

**No password reset, no second factor, no rate limit by address across
accounts.** Reset needs the mail channel. A second factor is a real 800-171
question for privileged access and is not one to answer by guessing.

**A visitor cookie is a bearer token, and the code says so rather than
pretending otherwise.** Whoever holds it is the visitor. What it buys over
the URL it replaces is concrete and limited: it is `httpOnly`, it is not in
the address bar, it is not pasted into a ticket, and it is not in anybody's
history. That is why a visitor's reach stops at their own free assessment,
and why CUI does not go anywhere near it.

**The log is append-only by construction, not by permission.** No code path
in this repository edits or deletes a record because none is written. That
is honest and it is not tamper-proofing, and it moves with the store when
the store moves off local disk.

---

## Storage, and the three things a production one has to do

The store is still one file and still local disk. What changed is that the
three promises made about it are now kept in code rather than in a standup
entry, and the seam an object store slides into exists.

### Encryption at rest, and what that is worth

Every byte the store writes — the original, the remediated file, the record
— goes through `src/server/crypto.ts` first: AES-256-GCM, a fresh 96-bit
nonce per write, from `node:crypto` and no package.

It protects a disk, a backup, a snapshot and a mislaid volume. It does
**not** protect against anybody who can run the process, because the process
has the key. That is the honest limit of encryption at rest everywhere it is
deployed, and it is written in the file so "encrypted at rest" cannot do
more work in a sales conversation than it does in a threat model.

Two details earn their place:

- **The job id is the associated data.** A sealed blob moved from one job's
  directory into another's will not open. Without that, somebody who can
  move files around can swap a document they own for one they do not.
- **GCM authenticates as well as encrypts**, and here the authentication
  matters more than the confidentiality in one specific case: a job record
  decides *who may open a document*, and a record an attacker can silently
  edit is an authorisation bug with extra steps.

A blob written before a key existed opens as itself, so turning encryption
on does not strand what is already stored. With no key configured the store
writes plain bytes — right for development, **refused outright in
production**, because a service that silently stops encrypting because
somebody forgot a variable is worse than one that will not start.

`npm test` runs the whole job-store suite against an encrypted store, which
is the point: encryption is a property of the store and not a mode.

### Deletion, and why the clock starts at download

`RETENTION_DAYS = 7`, from the Chairman's decision on 21 September, and the
second half of that sentence is the interesting one: **the countdown starts
when the customer downloads the remediated file**, not when they upload.

A fixed age from upload is the usual answer and it is wrong here. A
conformance review does not finish on a schedule — a contractor sends a
document, a reviewer works through it over a fortnight — and a clock started
at upload deletes the file in the middle of the job. Download is the only
moment the service can be sure they have what they came for.

The cost is real and is named rather than hidden: **a document nobody ever
downloads has no deletion date.** Whether an outer limit should also run
from upload is the Chairman's to decide, and `NEVER_DOWNLOADED` says so
where somebody will read it.

`npm run sweep` deletes what is due. A command rather than a timer, because
nothing here has a scheduler yet and a deletion policy that depends on a
cron nobody wrote is a deletion policy that does not run. **The record
outlives the file**: a conformance statement is a claim somebody may have to
answer for years, and an audit entry naming a job id that resolves to
nothing turns a record of what happened into a record that something
happened.

### Scrubbing, and the convention that makes it possible

The other half of the retention decision, unimplemented until now: **the
record is scrubbed of its quotations at delivery.** Not a tidy-up. The Word
detector writes the customer's own sentences into nearly every finding — a
link's text, a paragraph's opening, the sentence that relies on colour — and
deleting the file in seven days while keeping a record that quotes it is a
deletion policy in name only.

Every place the detectors and the remediator quote the document, they do it
inside **curly quotes**. That was a prose convention before it was a
boundary; making it the boundary is what lets one function find every
quotation without each detector having to remember to mark its own. The
convention is therefore load-bearing, and a test says so in as many words: a
detector that quotes with straight quotes puts a sentence somewhere the
scrub cannot reach.

What stays is the claim the conformance statement rests on — kind,
criterion, severity, the location's number, who decided it and how. What
goes is every word that came out of the document. A reader of a scrubbed
record can see that paragraph 4 failed 1.4.1 and cannot see what paragraph 4
said.

`decision.value` goes too, which costs something: the delivered document can
no longer be rebuilt from the original. That is the right way round. A
record that can rebuild the document is a record that still contains it, and
delivery is the point after which nothing needs rebuilding.

**The customer is told before it happens**, on the page, above the download
button: taking the remediated file starts the countdown and takes the
quotations out of the report, so take the conformance statement first if you
want it with them.

### The object store

`src/server/blobs.ts` is the seam the four job-store functions were written
for, and `src/server/s3.ts` is what sits behind it. Set `S3_BUCKET`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` and documents live in an
object store; leave any of them unset and they live on disk. There is no
`STORAGE=s3` switch, because a switch set without credentials is a service
that starts and then cannot read anything.

Above the seam a job is a record and two documents; below it, a key and some
bytes. **Encryption, retention, scrubbing and the ownership check are
untouched by the move** — they happen above the line, which is what the line
was for.

#### Signature Version 4, by hand, and why that is defensible

The AWS SDK is four hundred-odd transitive dependencies to do four verbs,
and this service holds federal records: every package in that path is a
package that can read a customer's document on the way past. SigV4 is an
HMAC chain and a canonical string — about eighty lines.

Hand-rolled crypto is usually indefensible because it cannot be checked.
This can. **AWS publishes a worked example** with a fixed key, a fixed
timestamp and the exact signature the algorithm must produce, and a test
reproduces `get-vanilla` from that suite byte for byte. The service name is
a parameter rather than a constant *specifically* so that vector — which
uses a service called `service` — can be run against the real code path
rather than a copy of it. A second implementation, written independently
from the specification in another language, agrees on every S3 case as well.

The encoding is the other trap: `encodeURIComponent` leaves `!'()*` alone
and AWS does not, so a path with an apostrophe in it signs one way and is
sent another, and the 403 that comes back says nothing about why. There is a
test.

#### What the fake server proves, and what it cannot

`__tests__/s3.test.ts` stands up a real HTTP server that speaks enough S3 —
PUT, GET, DELETE, ListObjectsV2 with pagination — and runs the client and
**the whole job store** against it: upload, read back, deliver, sweep. It
checks that `x-amz-content-sha256` is the hash of the body actually sent,
and that what lands in the bucket is the sealed form rather than the
customer's archive or their filename.

What it cannot prove is that AWS agrees. That is what the signature vector
is for, and between the two the untested surface is small and named: AWS's
own error behaviour, and nothing else.

#### What is not in the client

No multipart upload, no retries, no presigned URLs. A job's document is
under 25 MB by the upload limit, which is a single PUT. Adding the rest
before anything needs it is how four verbs become a library.

### What is deliberately not here

**Accounts, sessions, the audit log and reset tokens are still on local
disk.** Documents were moved first because they are the federal records and
the thing retention and encryption are about. The rest is the next change,
and one part of it is a design question rather than a port: **the audit log
is `appendFile` to one file per account, and an object store has no
append.** Every event becomes its own object, or the log gets a real
database. Porting it without deciding that is how an append-only log
quietly becomes a read-modify-write race.

**No key rotation.** Every sealed blob carries a version byte so that adding
it later does not strand what is written; that is the whole of the provision
made.

**Nothing calls the sweep on a timer.**

---

## Storage, and why it is one file

`src/server/jobs.ts` writes each job under `documents/<id>/` on local disk,
or under `DOCUMENTS_DIR`. It is right for development and for the first jobs
run by hand on one machine, and wrong for Vercel, whose filesystem does not
persist. Retention is decided and built, so what is left is the backend
itself: four functions in this file — `readRecord`, `writeRecord`,
`readBlob`, `writeBlob` — are the only code in the repository that touches a
customer's bytes, and replacing local disk means replacing those four. Two rules from `CLAUDE.md` live here as code: the
job id is the only thing that ever becomes a path, and no error raised in
this module carries document content, so whatever logs it cannot leak it.

The job page reads through the same module, so what the customer sees is
whatever the store says and nothing else.

---

## The site must pass what it sells

Every page of 508This meets WCAG 2.0 AA, and that is an invariant, not an
aspiration. Concretely:

- `lang="en"` on the document (3.1.1); a skip link that is the first focusable
  element on every page (2.4.1 – the *site* owes it even though the documents
  it remediates do not); one focus ring, defined once in `globals.css` and
  never removed (2.4.7); real headings, tables with captions and scoped
  headers (1.3.1).
- The colour tokens in `globals.css` carry their contrast ratio in a comment,
  in both schemes, so a change can be checked by reading. Nothing below 4.5:1
  is used for text (1.4.3).
- `eslint-config-next` brings the jsx-a11y rules and `npm run lint` fails on
  them. They are not to be disabled, per file or per line, without the reason
  written next to the disable.

Plain CSS with tokens, no Tailwind: an auditor reading this site's styles
should be able to find the focus ring and the contrast pairs in one file.

---

## Customer documents

Documents sent to 508This are federal records – often sensitive, and **as of
21 September 2026 the service accepts Controlled Unclassified Information**.
The Chairman decided retention that day; what follows is settled, and the
reasoning for each part is in `docs/leadership-standup.md`.

**Nothing about a document's contents goes into a log, an analytics event or
an error report, ever.** `/documents/` is gitignored as a whole folder, so no
real agency PDF can become a "test fixture" with a commit hash.

**Documents are deleted seven days after the customer downloads their
package.** A deliverable that is downloaded once does not need a month at
rest, and the seven days exist only so a customer who loses the file does not
have to be re-reviewed from scratch.

**The job record is scrubbed at delivery.** This is the part that is easy to
miss: the record is *not* free of document content. The Word detector writes
a quotation into every finding by design – `paragraph 4 (“Outcomes by site”)`
– because a reviewer has to find the place by eye. PDF findings carry page
numbers and are already clean. Deleting the documents and keeping a record
full of the customer's sentences would be a retention policy with a hole in
it, so the quotations go when the files go.

**One figure at a time may go to a vision model, and nothing else ever
leaves.** Never the whole document, never its text, never a Word file's XML –
the cropped image of a single figure, to draft alternative text a reviewer
then edits or rejects. It runs under a zero-data-retention configuration, and
the customer-facing policy says so in plain words. The argument is one real
file: a 12-page submission with 76 undescribed figures is a day of a
reviewer's time and well under a dollar of model time.

**Not for a document the customer marks CUI.** Zero data retention is a
vendor's commitment about storage; it is not a FedRAMP authorisation, and the
two are not substitutes. A CUI document is reviewed entirely by hand, and the
intake form asks which it is.

---

## What's built

- The Next.js scaffold, ESLint, TypeScript in strict mode with
  `noUncheckedIndexedAccess`.
- The criteria catalogue and the findings model, tested.
- Intake, Word detection, remediation, the review queue, the job page and
  the conformance statement, above. Run end to end in a browser against the production build
  before merging, and the downloaded file checked with an independent reader;
  `docs/build-state.md` says what was checked.
- A landing page that renders the catalogue from the domain – partly so the
  list a customer reads is the list the report is built from, and partly to
  prove on the first page that `src/domain/` has no idea React exists.
- CI: test (before install), typecheck, lint, build.

### Architecture

```
src/app/         App Router – pages, layout, styles. Imports from src/domain and src/server.
src/domain/      Pure TypeScript. No React, no Next, no Node APIs.
src/server/      Node only – node:zlib, node:fs – and nothing from npm.
__tests__/       node:test against src/domain and the pure parts of src/server.
scripts/         ts-resolve.mjs, the loader hook that makes npm test work bare.
docs/            build-state.md, the sprint, and the standup log.
```

The order to build the rest is in `docs/sprint-2026-09-17.md`: remediation
of the deterministic findings, proposed alternative text, the review queue,
then delivery as a fixed .docx, a tagged PDF and the ACR. PDF intake comes
after all of that; an untagged PDF has no structure to fix, only to rebuild,
and it is the hardest version of the product.

---

## Tests

```bash
npm test
```

Each test says in a comment *why* the behaviour is the behaviour, naming the
failure it prevents. A test that only asserts is half a test; the next person
cannot tell whether a red run means a bug or a changed decision.
