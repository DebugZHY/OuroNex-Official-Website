import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', '..', 'assets');

const result = await build({
  entryPoints: [path.join(here, 'src', 'index.jsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome110', 'safari16', 'firefox115'],
  jsx: 'automatic',
  loader: { '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: path.join(outDir, 'business-flow.js'),
  legalComments: 'none',
  logLevel: 'info',
});

if (result.errors.length) {
  process.exit(1);
}

console.log('built assets/business-flow.js');
