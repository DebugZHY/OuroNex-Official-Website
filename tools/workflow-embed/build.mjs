import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import postcss from 'postcss';

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.resolve(here, '../../workflow-stages/ui');
fs.mkdirSync(outdir, { recursive: true });
fs.cpSync(path.join(here, 'assets/soda-icons'), path.join(outdir, 'soda-icons'), { recursive: true });

await build({
  entryPoints: {
    embed: path.join(here, 'src/index.jsx'),
    'welcome-robot': path.join(here, 'src/robot-renderer.js'),
    flow: path.join(here, 'src/flow.jsx'),
    'soda-viewer': path.join(here, 'src/soda-viewer.jsx'),
  },
  outdir,
  entryNames: '[name]',
  assetNames: '[name]-[hash]',
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
  loader: { '.png': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'eof',
  logLevel: 'info',
});

/* The React Flow vendor stylesheet is re-scoped so a page that already runs its own flow
   (the Business section) can host this one without inheriting its rules. */
const flowCss = path.join(outdir, 'flow.css');
const css = postcss.parse(fs.readFileSync(flowCss, 'utf8'));
css.walkRules((rule) => {
  if (rule.selector.includes('.react-flow')) {
    rule.selectors = rule.selectors.map((selector) => selector.startsWith('.sida-demo-embed') ? selector : `.sida-demo-embed ${selector}`);
  }
});
css.walkAtRules('keyframes', (rule) => { if (rule.params === 'dashdraw') rule.params = 'sida-demo-dashdraw'; });
css.walkDecls(/^animation/, (declaration) => { declaration.value = declaration.value.replace(/\bdashdraw\b/g, 'sida-demo-dashdraw'); });
fs.writeFileSync(flowCss, css.toString());

for (const name of ['embed.js', 'embed.css', 'welcome-robot.js', 'flow.js', 'flow.css', 'soda-viewer.js', 'soda-viewer.css']) {
  const file = path.join(outdir, name);
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file);
  console.log(`${name}: ${bytes.length} bytes; gzip ${gzipSync(bytes).length}; brotli ${brotliCompressSync(bytes).length}`);
}
