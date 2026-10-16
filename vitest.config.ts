import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // The workspace packages (`packages/@openmaic/renderer`, `editor`) and
      // their dependencies carry their own React copy (the peer `>=18`
      // resolved to the upstream pin), while this root and the app build use
      // the version in `package.json`. Rendering a package component under the
      // root's react-dom otherwise hits "invalid hook call" from the
      // duplicate. Next aliases react to the app's copy for the same reason;
      // `resolve.dedupe` here was not enough (imports inside a dependency's
      // own copy still won), so the alias is explicit.
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    server: {
      deps: {
        // These reach for their own peer-pinned React copy unless they go
        // through Vite's resolver (see the react aliases above); externalized
        // they would use `react@19.2.3` beside the root's `react-dom@19.3.0`.
        inline: ['framer-motion', 'motion'],
      },
    },
  },
});
