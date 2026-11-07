import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const embedDir = path.resolve(repo, 'tools/workflow-embed');
const embedModules = path.join(embedDir, 'node_modules');
const outdir = path.resolve(repo, 'workflow-stages/features/application-assets');

const requireEmbed = createRequire(path.join(embedDir, 'package.json'));
const esbuild = requireEmbed('esbuild');
const postcss = requireEmbed('postcss');

fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: { 'app-flow': path.join(here, 'src/index.jsx') },
  outdir,
  entryNames: '[name]',
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
  nodePaths: [embedModules],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'info',
});

/* Keep React Flow vendor rules inside this iframe, like the other feature flows. */
const cssPath = path.join(outdir, 'app-flow.css');
const css = postcss.parse(fs.readFileSync(cssPath, 'utf8'));
css.walkRules((rule) => {
  if (!rule.selector.includes('.react-flow')) return;
  rule.selectors = rule.selectors.map((selector) =>
    selector.startsWith('.sida-application-flow') ? selector : `.sida-application-flow ${selector}`,
  );
});
css.walkAtRules('keyframes', (rule) => {
  if (rule.params === 'dashdraw') rule.params = 'sida-application-dashdraw';
});
css.walkDecls(/^animation/, (declaration) => {
  declaration.value = declaration.value.replace(/\bdashdraw\b/g, 'sida-application-dashdraw');
});
fs.writeFileSync(cssPath, css.toString());

for (const name of ['app-flow.js', 'app-flow.css']) {
  const file = path.join(outdir, name);
  const bytes = fs.readFileSync(file);
  console.log(`${name}: ${bytes.length} bytes; gzip ${gzipSync(bytes).length}; brotli ${brotliCompressSync(bytes).length}`);
}
