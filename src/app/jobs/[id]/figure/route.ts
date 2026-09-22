import { openFigureImage } from '@/server/access';

/**
 * One figure from the customer's document, so the reviewer can look at the
 * thing they are describing.
 *
 * A description cannot be checked against a figure nobody can see, and a
 * drafted one least of all: a confident invention reads well, and a reviewer
 * with nothing to compare it to will accept it. This is the screen's answer
 * to that.
 *
 * It serves the picture to the person reviewing the document, in their own
 * browser. Nothing leaves the service here and nothing is cached: the
 * headers say private and no-store, because a customer's figure has no
 * business in a shared cache.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = new URL(request.url).searchParams.get('key');
  if (!key) return new Response('Not found', { status: 404 });

  // `null` is "not yours, or no such job"; a `FigureResult` that is not ok
  // is "yours, and there is no picture". Both are a 404 here — the review
  // screen is where the second one gets its sentence.
  const found = await openFigureImage(id, key);
  if (!found || !found.ok) return new Response('No image', { status: 404 });

  return new Response(Buffer.from(found.image.bytes), {
    headers: {
      'Content-Type': found.image.mediaType,
      'Content-Length': String(found.image.bytes.byteLength),
      'Cache-Control': 'private, no-store',
      // The bytes are a picture and are served as one; nothing here should
      // ever be sniffed into something executable.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
