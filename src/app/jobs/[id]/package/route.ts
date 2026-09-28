import { openJobPackage } from '@/server/access';
import { ZIP_TYPE, attachment } from '@/server/download';

/**
 * The whole package, in one archive: the remediated document, the tagged PDF
 * export, and the conformance statement as a Word file.
 *
 * It exists because those three are one deliverable and were three downloads.
 * A contracting officer receives an archive and files what is in it; a customer
 * who took two of the three and missed the statement has not been delivered to.
 *
 * Built per request rather than stored — the statement is a function of the
 * record, and the record changes every time a reviewer decides something.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const packaged = await openJobPackage(id);
  if (!packaged) return new Response('Not found', { status: 404 });
  return attachment(packaged.bytes, packaged.filename, ZIP_TYPE);
}
