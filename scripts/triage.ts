/**
 * Triage a folder of PDFs: `npm run triage -- ~/Desktop/PDF`
 *
 * It runs on the customer's own machine over the customer's own folder, and
 * prints counts, page numbers and tags — never a word of any document's
 * contents. That is deliberate: the output is the sort of thing somebody
 * pastes into a chat, and the documents here are federal records.
 *
 * It exists because the answer to "what should we build next" depends
 * entirely on what fraction of real customer PDFs are already tagged, and
 * guessing that number and building for the guess is how a remediation
 * service ends up able to fix the files nobody sends.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { detectPdf, readPdfFacts } from '../src/domain/pdfDetect';
import {
  TIERS,
  countByTier,
  describeFigures,
  describeMix,
  promiseFor,
  triagePdf,
  type Tier,
  type Triage,
} from '../src/domain/triage';
import { NotAPdfError, readPdf } from '../src/server/pdf';

const LABEL: Record<Tier, string> = {
  scan: 'scan',
  untagged: 'untagged',
  tagged: 'tagged',
  structured: 'structured',
};

function pdfsIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.toLowerCase().endsWith('.pdf')) out.push(full);
    }
  };
  walk(dir, 0);
  return out.sort();
}

function pad(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

function right(n: number | string, w: number): string {
  return String(n).padStart(w);
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run triage -- <folder of PDFs>');
  process.exit(2);
}
if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`Not a folder: ${target}`);
  process.exit(2);
}

const files = pdfsIn(target);
if (files.length === 0) {
  console.error(`No PDFs under ${target}`);
  process.exit(1);
}

const results: Triage[] = [];
const failures: Array<{ name: string; why: string }> = [];

console.log('');
console.log(`${pad('File', 42)} ${pad('Tier', 11)} ${right('Pg', 4)} ${right('Fig', 4)} ${right('Img', 4)} ${right('NoAlt', 6)} ${right('Para', 5)} ${right('Head', 5)} ${right('Tbl', 4)} ${right('Issues', 7)}`);
console.log('-'.repeat(101));

for (const file of files) {
  const name = path.relative(target, file);
  try {
    const doc = readPdf(new Uint8Array(readFileSync(file)));
    const facts = readPdfFacts(doc);
    const t = triagePdf(facts, detectPdf(doc));
    results.push(t);
    console.log(
      `${pad(name, 42)} ${pad(LABEL[t.tier], 11)} ${right(t.pages, 4)} ${right(t.figures, 4)} ${right(t.rasterImages, 4)} ${right(t.figuresWithoutAlt, 6)} ${right(t.paragraphs, 5)} ${right(t.headings, 5)} ${right(t.tables, 4)} ${right(t.findings, 7)}`,
    );
  } catch (error) {
    // An unreadable file is a finding about the sample, not a crash: a
    // folder of real documents will contain an encrypted one.
    const why = error instanceof NotAPdfError || error instanceof Error ? error.message : String(error);
    failures.push({ name, why });
    console.log(`${pad(name, 42)} ${pad('unreadable', 11)}`);
  }
}

const counts = countByTier(results);
console.log('');
console.log('Tiers');
for (const tier of TIERS) {
  if (counts[tier] === 0) continue;
  console.log(`  ${right(counts[tier], 3)}  ${pad(LABEL[tier], 11)}  ${promiseFor(tier)}`);
}
if (failures.length > 0) {
  console.log(`  ${right(failures.length, 3)}  ${pad('unreadable', 11)}  Not read. Usually encrypted, or a filter this reader refuses.`);
  for (const f of failures) console.log(`       ${pad(f.name, 44)} ${f.why}`);
}

console.log('');
console.log(describeMix(counts));
console.log('');
console.log(describeFigures(results));
console.log('');
