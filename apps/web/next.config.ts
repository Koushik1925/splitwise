import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@splitwise/shared', '@splitwise/ui'],
};

export default nextConfig;
