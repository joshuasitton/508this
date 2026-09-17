/**
 * Node module-resolution hook for the domain test suite. Carried over from
 * Loadsy, where it earned its keep.
 *
 * Next's bundler and tsc both resolve extensionless relative imports; Node's
 * ESM loader does not. This hook teaches Node the same rule so `npm test` can
 * run the pure domain logic through `--experimental-strip-types` with no
 * bundler and no dependencies installed. It touches nothing but relative
 * specifiers that failed to resolve on their own.
 *
 * It also propagates a `?case=` tag down relative imports, so a test that needs
 * a module re-read its environment can re-import it under a fresh query and get
 * fresh *dependencies* too. Without the propagation you get a fresh module wired
 * to cached dependencies, which looks isolated and is not – that produced a false
 * pass in Loadsy. Nothing here reads the environment at import yet; the hook is
 * kept whole so that when something does, the trap is already sprung.
 *
 * The tag has to be spliced in BEFORE the extension, never after – `mode?case=x.ts`
 * is not a path.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
const TAG = /\?case=[^?#]*$/;

function tagOf(url) {
  if (typeof url !== 'string') return '';
  const match = TAG.exec(url);
  return match ? match[0] : '';
}

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('.') || specifier.startsWith('/');
  const inherited = relative && !specifier.includes('?') ? tagOf(context.parentURL) : '';
  const tag = inherited || tagOf(specifier);
  const path = tag ? specifier.slice(0, specifier.length - tagOf(specifier).length) : specifier;

  try {
    return await nextResolve(path + tag, context);
  } catch (error) {
    if (!relative) throw error;
    for (const suffix of CANDIDATE_SUFFIXES) {
      try {
        return await nextResolve(path + suffix + tag, context);
      } catch {
        // try the next candidate
      }
    }
    throw error;
  }
}

register(pathToFileURL(import.meta.filename));
