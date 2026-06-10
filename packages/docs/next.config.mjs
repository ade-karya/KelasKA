import { createMDX } from 'fumadocs-mdx/next';
import { DOCS_BASE_PATH } from './lib/locales.mjs';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Static export: served as plain files by nginx, no Node server.
  output: 'export',
  // Target deploy path: kelas-ka.riau.ai/docs
  basePath: DOCS_BASE_PATH,
  // Static export cannot optimize images at runtime.
  images: {
    unoptimized: true,
  },
};

export default withMDX(config);
