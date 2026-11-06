import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const embedDir = path.resolve(here, "../workflow-embed");
const embedModules = path.join(embedDir, "node_modules");
const outdir = path.resolve(here, "../../workflow-stages/features/flow-assets");
const requireEmbed = createRequire(path.join(embedDir, "package.json"));
const esbuild = requireEmbed("esbuild");
const postcss = requireEmbed("postcss");

fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: { flow: path.join(here, "src/flow.jsx") },
  outdir,
  entryNames: "[name]",
  assetNames: "[name]-[hash]",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome110", "safari16", "firefox115"],
  jsx: "automatic",
  jsxImportSource: "preact",
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react-dom/client": "preact/compat/client",
    "react/jsx-runtime": "preact/jsx-runtime",
  },
  nodePaths: [embedModules],
  loader: { ".png": "file" },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "info",
});

/* Keep React Flow's vendor rules inside this embed, like the existing shell does. */
const cssPath = path.join(outdir, "flow.css");
const css = postcss.parse(fs.readFileSync(cssPath, "utf8"));
css.walkRules((rule) => {
  if (rule.selector.includes(".react-flow")) {
    rule.selectors = rule.selectors.map((selector) =>
      selector.startsWith(".sida-feature-flow") ? selector : `.sida-feature-flow ${selector}`,
    );
  }
});
css.walkAtRules("keyframes", (rule) => {
  if (rule.params === "dashdraw") rule.params = "sff-dashdraw";
});
css.walkDecls(/^animation/, (declaration) => {
  declaration.value = declaration.value.replace(/\bdashdraw\b/g, "sff-dashdraw");
});
fs.writeFileSync(cssPath, css.toString());

for (const name of ["flow.js", "flow.css"]) {
  const file = path.join(outdir, name);
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file);
  console.log(`${name}: ${bytes.length} bytes; gzip ${gzipSync(bytes).length}; brotli ${brotliCompressSync(bytes).length}`);
}
