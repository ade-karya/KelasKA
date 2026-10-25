import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import globals from 'rollup-plugin-node-globals';
import builtins from 'rollup-plugin-node-builtins';

const onwarn = (warning) => {
  if (warning.code === 'CIRCULAR_DEPENDENCY') return;
  console.warn(`(!) ${warning.message}`);
};

// Minifying all three outputs costs ~1 min on a 2-vCPU Colab runtime.
// dist/index.js is served to browsers from /vendor/maic-importer, so it must
// stay minified (1.8 MB vs 3.7 MB); the UMD/CJS variants are legacy artifacts
// the app never loads. OPENMAIC_FAST_MINIFY=1 skips minifying those two on
// local installs. Release builds leave it unset and minify all three outputs.
const fastMinify = process.env.OPENMAIC_FAST_MINIFY === '1';
const minifier = (keep = false) => (keep || !fastMinify ? [terser()] : []);

const plugins = [
  nodeResolve({ browser: true, preferBuiltins: false }),
  commonjs(),
  json(),
  typescript({ tsconfig: './tsconfig.json' }),
  globals({
    dirname: false,
    filename: false,
    // @openmaic/dsl ships browser-safe ES2022 and never needs Node global
    // shims. This plugin re-parses any module mentioning `global`/`process`
    // with an old acorn that predates `??`, so keep it off the dsl build.
    exclude: [/[\\/]@openmaic[\\/]dsl[\\/]dist[\\/]/],
  }),
  builtins(),
];

// One bundle, three outputs. Rollup parses/resolves/transforms the source once
// and only re-renders it per format; separate configs paid that cost three
// times (minutes on a small Colab runtime) for identical input.
export default {
  input: 'src/index.ts',
  onwarn,
  output: [
    {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'pptxtojsonPro',
      inlineDynamicImports: true,
      plugins: minifier(),
    },
    {
      file: 'dist/index.cjs',
      format: 'cjs',
      inlineDynamicImports: true,
      plugins: minifier(),
    },
    {
      file: 'dist/index.js',
      format: 'es',
      inlineDynamicImports: true,
      plugins: minifier(true),
    },
  ],
  plugins,
};
