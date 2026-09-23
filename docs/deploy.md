# Deploying 508This

Written 23 September 2026, when the last thing the service kept on local disk
moved to the object store and deploying became possible for the first time.

This is the whole of what a deploy needs. It is a checklist because the
ordering matters in two places, and both are called out where they arise.

## What has to exist first

Three accounts, none of which the repository can create for itself:

| Thing | Why it is needed | What it gives you |
|---|---|---|
| A Vercel project | runs the app | the deployment |
| An AWS S3 bucket | **everything the service persists** | bucket, region, key id, secret |
| A mail sender (Resend by default) | passphrase resets | an API token and a from-address |

**The store is AWS S3**, decided by the Chairman on 23 September. The
reason is not price — R2 is cheaper and has no egress charge — it is that
this service accepts CUI, and R2 is not FedRAMP authorised. AWS commercial
regions are FedRAMP Moderate and GovCloud is High. The README already draws
this line for the vision vendor, and the bucket holds more of the document
than the vision vendor ever sees.

`src/server/s3.ts` speaks the four verbs against any S3-compatible store, so
R2 and MinIO remain possible if that reasoning ever changes; everything
below except the IAM policy applies to them through `S3_ENDPOINT`.

### AWS S3, step by step

1. **Pick the region first.** It is in the bucket's hostname and therefore
   inside every signature, so changing it later is a new bucket. If a
   customer's contract asks for FedRAMP High or for data to stay in a
   specific boundary, that is a GovCloud decision and it is made here, not
   afterwards.

2. **Create the bucket** with Block Public Access **fully on** — all four
   settings. Nothing in this service serves from the bucket; documents are
   read by the server and handed over through a route that checks who is
   asking.

3. **Turn on Versioning**, and **Object Lock** if you want the audit log's
   append-only claim to hold against somebody with write access rather than
   only against our source code. Object Lock needs versioning, and enabling
   it when the bucket is created is much the simplest path.

4. **Leave default encryption on** (SSE-S3 is the default and is free).
   Everything this service writes is *already* sealed before it leaves the
   process — see `src/server/crypto.ts` — so this is belt and braces rather
   than the protection. It costs nothing and it answers a question every
   security questionnaire asks.

5. **Create an IAM user for the app** and give it exactly this policy,
   nothing wider. Four verbs on one bucket is the whole of what the service
   does:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TheFourVerbsOnTheObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    {
      "Sid": "ListingNeedsTheBucketItself",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR-BUCKET"
    }
  ]
}
```

   **The second statement is the one people get wrong.** `ListObjectsV2` is
   an operation on the *bucket*, so `s3:ListBucket` has to be granted on the
   bucket ARN with no `/*`. Granting it on the objects ARN instead produces a
   403 on listing only — which means uploads and downloads work, and the
   retention sweep silently never finds anything to delete.

6. **Create an access key** for that user. It is shown once. Long-lived keys
   are what Vercel needs; if the app ever moves somewhere that can assume a
   role, `S3_SESSION_TOKEN` is already supported and the key can go.

That gives you:

```
S3_BUCKET=your-bucket-name
S3_REGION=us-east-2
S3_ACCESS_KEY_ID=<from the access key>
S3_SECRET_ACCESS_KEY=<from the access key>
```

**Do not set `S3_ENDPOINT` for AWS.** Its absence is what selects
virtual-hosted addressing — `bucket.s3.region.amazonaws.com` — which is what
AWS requires for buckets created since 2020.

### Prove it before you deploy into it

```
npm run check:store
```

It runs PUT, GET, ListObjectsV2 and DELETE against the real bucket with the
real signature code, then checks that what it wrote came back **sealed** and
that a sealed object **cannot be moved to another key and still open**. It
writes one object under `check/`, deletes it on the way out — including out
of a failure — and prints no secret and no bucket contents.

It exists because the alternative is finding out from a customer. A mistyped
secret, a bucket in another region, a token scoped to read: every one of
those deploys cleanly and fails on the first upload, and the first upload is
a federal record.

A failure names the likely cause rather than the status alone — an
unreachable endpoint, a 403 on the signature or the permissions, a 404 on the
bucket name or region. It exits non-zero, so it can go in a deploy script.

## The variables

Every one of these is read by `src/` and nothing else is. **Not one of them
may be a `NEXT_PUBLIC_` variable** — those are compiled into the browser
bundle in plaintext.

### Required in production

| Variable | What breaks without it |
|---|---|
| `STORAGE_KEY` | the service **refuses to store anything at all** — see below |
| `S3_BUCKET` | falls back to local disk, which Vercel does not keep |
| `S3_ACCESS_KEY_ID` | as above |
| `S3_SECRET_ACCESS_KEY` | as above |
| `PUBLIC_BASE_URL` | reset links point nowhere |
| `CRON_SECRET` | **the retention sweep never runs** — `/api/sweep` returns 404 to everything, including Vercel's cron |

`STORAGE_KEY` is 32 bytes of base64. Generate it once, keep it somewhere you
will still have it in a year, and understand what it is: **every document,
record, session and audit entry in the bucket is unreadable without it.**
Losing it loses the data. Rotating it is not implemented — sealed blobs carry
a version byte so that rotation can be added without stranding what is
already written, and that is the whole of the provision made.

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

There is no `STORAGE=s3` switch, deliberately. The store is chosen by whether
the three `S3_*` credentials are present, because a switch set without
credentials is a service that starts and then cannot read anything.

### Optional, with real defaults

| Variable | Default | When to set it |
|---|---|---|
| `S3_REGION` | `us-east-1` | any other region; R2 wants `auto` |
| `S3_ENDPOINT` | AWS, virtual-hosted style | **not set for AWS.** R2, MinIO or anything S3-compatible — it switches to path style |
| `S3_SESSION_TOKEN` | — | instance-role credentials, which carry one |
| `MAIL_TOKEN`, `MAIL_FROM` | — | **both** are needed before any mail is sent |
| `MAIL_ENDPOINT` | `https://api.resend.com/emails` | a different provider |
| `ANTHROPIC_API_KEY` | — | the drafting feature. Without it, reviewers are asked to describe figures themselves, which is the same thing the service says when a figure has no image |

### Set nowhere in production

`STORE_DIR`, `DOCUMENTS_DIR` and `ACCOUNTS_DIR` are local-disk paths for
development. `ACCOUNTS_DIR` names the development mail outbox and nothing
else; in production no letter is ever written to disk.

`CRON_SECRET` is what Vercel sends as `Authorization: Bearer …` on a
scheduled invocation, and `/api/sweep` accepts that and nothing else,
compared in constant time. With the variable unset the route 404s every
request — an endpoint that deletes customer documents should not exist until
somebody has decided who may call it.

## The two orderings that matter

**Set the variables before the first deploy, not after.** A deployment that
comes up without `S3_BUCKET` writes to a container filesystem that is
discarded, so the first customer's upload is lost rather than misfiled.

**Set `MAIL_TOKEN` and `MAIL_FROM` together.** `transport()` requires both;
with one of them the transport is `none` and a reset silently sends nothing.
It is audited as `mail.failed`, so it is visible — but only to somebody
reading the log.

## Bucket settings

**No lifecycle rule on `audit/`, `accounts/`, `sessions/` or `resets/`, ever.**
Documents are deleted seven days after a customer downloads them, and that
deletion is done by this service's own sweep, which only ever touches keys
whose first segment is a job id. A bucket-level expiry rule does not know the
difference and would quietly delete the evidence. There is a test holding the
code side of this; the bucket side is a setting nobody can test for you.

**Why versioning and Object Lock are in the steps above.** The audit log is
one object per event and nothing in this repository ever rewrites one — but
that is a claim about our source code, which is worth exactly as much as the
next person's access to the bucket. Versioning makes it a claim about the
bucket instead, which is the control 800-171 3.3.8 actually wants.

**Block Public Access stays fully on.** Nothing in the service serves from
the bucket directly; documents are read by the server and handed to the
customer through a route that checks who is asking.

## Deploying

The app is a stock Next.js 16 project with no `vercel.json` and nothing
custom in the build. `npm run build` is what Vercel runs.

```
vercel link
vercel env add STORAGE_KEY production        # and each of the others
vercel --prod
```

`@napi-rs/canvas` ships a prebuilt `linux-x64-gnu` binary and the lockfile
carries it, so the renderer works on Vercel's Node runtime with nothing
installed. The heaviest route traces to about 67 MB against a 250 MB limit,
so the build's "dynamic filesystem access causes tracing of the whole
project" warning costs nothing.

## After the first deploy, check these four

They are the four that have failed in development, so they are the four worth
a minute each:

1. **The job page names the store.** It should say *"Stored in object storage,
   encrypted at rest."* If it says "on this server's own disk", the `S3_*`
   variables did not arrive and nothing being written will survive.
2. **Sign up, sign out, sign in.** That exercises accounts, sessions and the
   session index in one pass.
3. **Request a passphrase reset and follow the link.** The link must be on
   your own origin — it is built from `PUBLIC_BASE_URL` and never from the
   request's `Host` header, so a wrong value here is a reset link that points
   at the wrong server. Completing it must sign out a session you left open
   in another browser.
4. **Upload a document, then look in the bucket.** `<job id>/job.json` must
   not contain the filename and `<job id>/original.*` must not start with
   `PK` or `%PDF`. If either is readable, `STORAGE_KEY` is not set and the
   service should have refused — say so loudly rather than carrying on.

## The retention sweep

`vercel.json` schedules `/api/sweep` once a day at 03:17 UTC. Daily rather
than hourly because the promise is measured in days: an hourly sweep deletes
a document within an hour of its deadline instead of within a day of it, and
buys twenty-three extra runs to do it.

It answers with a count and never the job ids it swept, because a job id
names a customer's document and a response body is a thing that gets logged.

**Check it after the first deploy.** Vercel's dashboard shows the cron's last
run; a 404 there means `CRON_SECRET` is not set, and a sweep that is not
running is the retention promise quietly not being kept. That is the failure
this route exists to end, and it would look exactly like success.

## What is still not automated

**Key rotation.** Sealed blobs carry a version byte so it can be added
without stranding what is written, and that is the whole of the provision
made.
