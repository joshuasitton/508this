import { ACCEPTED } from '@/domain/job';
import { openJobFile, openJobPdf } from '@/server/access';
import { PDF_TYPE, attachment } from '@/server/download';
import type { JobFile } from '@/server/jobs';

/**
 * The document back to the customer. `?which=original` returns what they sent
 * and `?which=pdf` the tagged PDF export; the default is the remediated file.
 * The name on disk is never the name in the header – the customer's filename
 * goes through a quoted, escaped Content-Disposition and nowhere near a path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asked = new URL(request.url).searchParams.get('which');

  if (asked === 'pdf') {
    const pdf = await openJobPdf(id);
    if (!pdf) return new Response('Not found', { status: 404 });
    // A refusal is an answer, not a failure: some documents cannot be set as a
    // PDF here, and saying which and what to do instead beats an empty file.
    if (!pdf.ok) return new Response(refusal(pdf.reason, pdf.detail), { status: 409, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });
    return attachment(pdf.bytes, pdf.filename, PDF_TYPE);
  }

  const which: JobFile = asked === 'original' ? 'original' : 'remediated';
  const file = await openJobFile(id, which);
  if (!file) return new Response('Not found', { status: 404 });
  return attachment(file.bytes, file.filename, ACCEPTED[file.format].mime);
}

function refusal(reason: 'unsupported-characters' | 'unsupported-figure' | 'not-a-document', detail: readonly string[]): string {
  const list = detail.slice(0, 8).join(', ');
  if (reason === 'unsupported-characters') {
    return `This document cannot be exported as a PDF here. It uses characters the export's fonts cannot set${list ? `: ${list}` : ''}. Nothing was changed or left out — the export refuses rather than replacing a character with something the document does not say. Word's own "Save as PDF" on the remediated document handles it, and produces a tagged PDF.\n`;
  }
  if (reason === 'unsupported-figure') {
    return `This document cannot be exported as a PDF here. It contains a picture in a format the export cannot read${list ? `: ${list}` : ''} — Word embeds Windows metafiles, which need Word to draw them. Rather than deliver a document with a figure silently missing, the export refuses. Word's own "Save as PDF" on the remediated document handles it.\n`;
  }
  return 'This document could not be reopened for export.\n';
}
