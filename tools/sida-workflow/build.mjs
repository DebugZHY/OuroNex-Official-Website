import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', '..', 'assets');
const outfile = path.join(outDir, 'sida-workflow.js');

// Both stylesheets (React Flow's own and this panel's) are imported as text and
// injected at runtime, so the build emits exactly one file: the page links only
// assets/sida-workflow.js and nothing else.
const result = await build({
  entryPoints: [path.join(here, 'src', 'index.jsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome110', 'safari16', 'firefox115'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  alias: {
    react: 'preact/compat',
    'react-dom': 'preact/compat',
    'react-dom/client': 'preact/compat/client',
    'react/jsx-runtime': 'preact/jsx-runtime',
  },
  loader: { '.jsx': 'jsx', '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile,
  legalComments: 'none',
  logLevel: 'info',
});

if (result.errors.length) {
  process.exit(1);
}

const bytes = fs.statSync(outfile).size;
console.log(`built ${path.relative(path.resolve(here, '..', '..'), outfile)} (${(bytes / 1024).toFixed(1)} KiB)`);
