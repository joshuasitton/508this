/**
 * The one place a customer's document touches anything outside this service.
 *
 * What may be sent was decided by the Chairman on 21 September and is
 * deliberately narrow: **the image of one figure.** Never the whole
 * document, never its text, never a Word file's XML, and nothing at all for
 * a document the customer marked CUI — zero data retention is a vendor's
 * commitment about storage and is not a FedRAMP authorisation, and the
 * caller enforces that before it gets here.
 *
 * The key is read from the server environment and is never a
 * `NEXT_PUBLIC_` variable, which would bundle it into the browser in
 * plaintext. Nothing about the image or the answer is logged: an error
 * carries the shape of the failure and no part of the document, because an
 * error report is exactly the place a customer's picture must not end up.
 *
 * This is the only module in `src/server/` that takes an npm dependency.
 * The rule it bends is real and the reason for it is real — `npm test` runs
 * with nothing installed — so the rule is now stated the way it actually
 * works: no test imports this file, and CI proves it by running the tests
 * before it installs anything.
 */

import Anthropic from '@anthropic-ai/sdk';

import { ALT_INSTRUCTION, isRefusal, normaliseDraft, type Draft, type FigureImage } from '@/domain/alt';

export class VisionUnavailableError extends Error {}

/**
 * Opus 5 with thinking on and effort low. Thinking is left on deliberately:
 * disabling it on this model can leak reasoning tags into the visible
 * answer, and the answer here *is* the product. Low effort is what makes it
 * cheap — a figure costs a fraction of a cent, which is the whole argument
 * for drafting descriptions rather than typing 76 of them by hand.
 */
const MODEL = 'claude-opus-5';
const MAX_TOKENS = 300;

let client: Anthropic | null = null;

function clientOrThrow(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new VisionUnavailableError(
      'No vision key is configured on the server, so descriptions cannot be drafted. Reviewers write them by hand.',
    );
  }
  client ??= new Anthropic();
  return client;
}

/** Whether the button should be offered at all. */
export function visionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * One figure in, one draft out. The caller has already established that
 * this document may leave the box.
 */
export async function draftAltText(image: FigureImage): Promise<Draft> {
  const anthropic = clientOrThrow();
  let response;
  try {
    response = await request(anthropic, image);
  } catch (error) {
    // A key that is missing, wrong or out of credit is this service being
    // misconfigured, not the model declining to describe a picture. The
    // reviewer is told different things in the two cases because they are
    // different problems and only one of them is theirs to work around.
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError ||
      error instanceof Anthropic.RateLimitError
    ) {
      throw new VisionUnavailableError('The drafting service is not available right now.');
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') return { text: '', refused: true };

  const said = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join(' ');

  if (isRefusal(said)) return { text: '', refused: true };
  return normaliseDraft(said);
}

function request(anthropic: Anthropic, image: FigureImage) {
  return anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: Buffer.from(image.bytes).toString('base64'),
            },
          },
          { type: 'text', text: ALT_INSTRUCTION },
        ],
      },
    ],
  });
}
