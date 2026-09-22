import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Not found' };

/**
 * The page a job gives when it is not yours — and the page it gives when it
 * does not exist. Those are deliberately the same page.
 *
 * Telling a stranger "that document exists, but it is somebody else's" is
 * telling them something: that a document with that id is here, and by
 * extension that the person who sent them the link is a customer. So there
 * is one answer, and it does not distinguish.
 *
 * It stopped being Next's stock page when ownership arrived, because until
 * then a 404 meant a typo and now it is a routine, correct outcome that a
 * person will meet holding a link a colleague sent them. They deserve a
 * sentence that explains rather than a blank.
 */
export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>
        There is nothing here for you. Either this page does not exist, or it belongs to a document that is not
        yours — a link on its own does not open one.
      </p>
      <p>
        If a colleague sent you this link, the document is theirs and they will need to send you the file rather
        than the address.
      </p>
      <p>
        If it is yours and you were signed in a moment ago, your session may have ended —{' '}
        <Link href="/account/sign-in">sign in again</Link>.
      </p>
      <p>
        <Link href="/start">Check a document</Link>
      </p>
    </>
  );
}
