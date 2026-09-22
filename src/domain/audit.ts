/**
 * The record of who did what, built so that it cannot become a copy of the
 * documents it is a record about.
 *
 * 800-171 wants audit records sufficient to trace a user's actions, and
 * this repository's oldest rule says nothing about a document's contents
 * goes into a log. Those two pull in opposite directions the moment
 * somebody adds a `detail` field "just for debugging" and a reviewer's
 * dismissal note — which quotes the customer's own sentence — lands in it.
 * That is not a hypothetical: the Word detector puts the customer's
 * sentences into every finding, and delivery scrubs them from the job
 * record for exactly this reason.
 *
 * So the resolution is structural rather than a warning in a comment.
 * **An audit event has no free-text field at all.** It carries a time, an
 * account id, an action from a closed list, and at most one subject, and
 * `auditEvent` refuses a subject that is not an identifier. There is
 * nowhere for a quotation to go, and a test proves it by trying.
 *
 * What gets lost is context — an event says a finding was decided, not
 * which way or why. That is the right trade: the decision itself is on the
 * job record where it belongs, the log says who touched what and when, and
 * an investigator who needs both has both. A log that also held the content
 * would be a second copy of every customer document under a retention
 * policy nobody wrote.
 */

/**
 * Everything worth a record, and nothing else. The list is closed, so
 * adding an action is a deliberate edit to this file rather than a string
 * somebody passes at a call site.
 */
export const AUDIT_ACTIONS = [
  'account.created',
  'account.disabled',
  'sign-in.succeeded',
  'sign-in.failed',
  'sign-in.locked',
  'sign-out',
  'session.expired',
  'job.created',
  'job.opened',
  'job.remediated',
  'job.downloaded',
  'job.deleted',
  'finding.decided',
  'criterion.confirmed',
  'reviewer.named',
  'alt.drafted',
  'statement.downloaded',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEvent {
  at: string;
  /**
   * The account acting, or `null` for an attempt that never identified
   * anybody — a sign-in against an address with no account is the whole
   * reason this is nullable.
   */
  account: string | null;
  action: AuditAction;
  /** A job id or an account id. An identifier, never a description. */
  subject: string | null;
}

/**
 * An identifier and nothing else: the UUIDs this service mints for jobs and
 * accounts. Anything with a space in it is prose, and prose is how a
 * customer's sentence gets into a log.
 */
const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class NotAnIdentifierError extends Error {
  constructor() {
    // The offending value is deliberately not in the message. An error
    // carrying the thing that failed the check would defeat the check the
    // first time somebody logged the error.
    super('An audit subject must be an identifier. Audit records never carry text.');
  }
}

export function isIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

/**
 * The only way to make an event. It validates rather than trusting the
 * type, because `string` is `string` and the compiler cannot tell an id
 * from a paragraph of somebody's report.
 */
export function auditEvent(
  action: AuditAction,
  at: string,
  account: string | null,
  subject: string | null = null,
): AuditEvent {
  if (account !== null && !isIdentifier(account)) throw new NotAnIdentifierError();
  if (subject !== null && !isIdentifier(subject)) throw new NotAnIdentifierError();
  return { at, account, action, subject };
}

/**
 * What the action was, in a sentence, for whoever reads the log. The
 * wording comes from here so that a log page and an exported record cannot
 * describe the same event differently.
 */
export function describeAction(action: AuditAction): string {
  switch (action) {
    case 'account.created':
      return 'Account created';
    case 'account.disabled':
      return 'Account disabled';
    case 'sign-in.succeeded':
      return 'Signed in';
    case 'sign-in.failed':
      return 'Sign-in failed';
    case 'sign-in.locked':
      return 'Sign-in refused: account locked after repeated failures';
    case 'sign-out':
      return 'Signed out';
    case 'session.expired':
      return 'Session ended';
    case 'job.created':
      return 'Document uploaded';
    case 'job.opened':
      return 'Document report opened';
    case 'job.remediated':
      return 'Automatic fixes applied';
    case 'job.downloaded':
      return 'Document downloaded';
    case 'job.deleted':
      return 'Document deleted';
    case 'finding.decided':
      return 'Finding decided by a reviewer';
    case 'criterion.confirmed':
      return 'Criterion confirmed by a reviewer';
    case 'reviewer.named':
      return 'Reviewer identified';
    case 'alt.drafted':
      return 'Description drafted for a figure';
    case 'statement.downloaded':
      return 'Conformance statement downloaded';
  }
}

/**
 * Whether this action is one a person investigating an incident reads
 * first. Used to order a log page, not to decide what gets recorded —
 * everything gets recorded.
 */
export function isSecurityEvent(action: AuditAction): boolean {
  return action.startsWith('sign-in') || action.startsWith('account') || action === 'session.expired';
}

/** One line, fixed width at the front, for a log a person reads or exports. */
export function describeEvent(event: AuditEvent): string {
  const who = event.account ?? 'no account';
  const what = describeAction(event.action);
  return event.subject ? `${event.at}  ${who}  ${what}  ${event.subject}` : `${event.at}  ${who}  ${what}`;
}
