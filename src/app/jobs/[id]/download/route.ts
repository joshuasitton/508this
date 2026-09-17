import { ACCEPTED } from '@/domain/job';
import { getJobFile, type JobFile } from '@/server/jobs';

/**
 * The document back to the customer. `?which=original` returns what they
 * sent; the default is the remediated file. The name on disk is never the
 * name in the header – the customer's filename goes through a quoted,
 * escaped Content-Disposition and nowhere near a path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const which: JobFile = new URL(request.url).searchParams.get('which') === 'original' ? 'original' : 'remediated';
  const file = await getJobFile(id, which);
  if (!file) return new Response('Not found', { status: 404 });
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(file.filename);
  return new Response(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': ACCEPTED.docx.mime,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      'Content-Length': String(file.bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
