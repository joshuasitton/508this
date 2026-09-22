/**
 * Delete the documents whose retention window has run out.
 *
 * `npm run sweep`. It is a command rather than a timer because nothing in
 * this service has a scheduler yet, and a deletion policy that depends on a
 * cron somebody has not written is a deletion policy that does not run. A
 * command can be run by hand today and by a cron tomorrow, and both call
 * the same function the tests cover.
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
