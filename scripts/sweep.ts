/**
 * Delete the documents whose retention window has run out.
 *
 * `npm run sweep`, by hand. The scheduled one is `/api/sweep`, which a
 * Vercel cron calls daily — this stayed because the two call the same
 * function the tests cover, and being able to run it from a terminal is
 * worth keeping when you want to know what it would do right now.
 *
 * It prints counts and job ids. It never prints a filename, a finding or a
 * word of anybody's document — the same rule the triage holds, and for the
 * same reason: this output is the sort of thing somebody pastes into a chat.
 */

import { sweepExpired } from '../src/server/jobs';

const swept = await sweepExpired();

if (swept.length === 0) {
  console.log('Nothing is due. No document was deleted.');
} else {
  console.log(`Deleted the documents for ${swept.length} ${swept.length === 1 ? 'job' : 'jobs'}:`);
  for (const id of swept) console.log(`  ${id}`);
  console.log('\nTheir records remain, with the findings and the conformance statement. The files do not.');
}
