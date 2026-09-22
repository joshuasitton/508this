import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * The renderer is not bundled.
   *
   * `@napi-rs/canvas` loads a platform-specific `.node` binary at runtime
   * and `pdfjs-dist` reaches for its own worker and font data by path.
   * Neither survives being traced into a bundle, and the bundler is right
   * to refuse: what it would produce is a build that works on this machine
   * and not on the one it deploys to. Both stay as real packages, required
   * from `node_modules` at runtime, which is what `serverExternalPackages`
   * means.
   *
   * They are only ever reached through `await import` from
   * `src/server/render.ts`, so nothing here is loaded until somebody asks
   * for a figure to be drawn.
   */
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],
  experimental: {
    serverActions: {
      // Just above MAX_UPLOAD_BYTES in src/domain/job.ts, so the domain's
      // own message about size fires before the framework's generic one.
      bodySizeLimit: '26mb',
    },
  },
};

export default nextConfig;
