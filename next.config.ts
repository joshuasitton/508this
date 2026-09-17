import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Just above MAX_UPLOAD_BYTES in src/domain/job.ts, so the domain's
      // own message about size fires before the framework's generic one.
      bodySizeLimit: '26mb',
    },
  },
};

export default nextConfig;
