import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'motion',
      'motion/react',
      '@radix-ui/react-popover',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-slider',
      '@radix-ui/react-switch',
      'lodash',
      'echarts',
      'shiki',
    ],
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
