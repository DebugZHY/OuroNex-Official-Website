/* Records the built embed files in package-manifest.json (bytes + sha256).
   The site's file service only serves manifest paths, so the bundle must be listed here.

   Usage: node sync-manifest.mjs   (after npm run build) */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const ui = path.resolve(here, '../../workflow-stages/ui');
const manifestPath = path.join(repo, 'package-manifest.json');

const names = fs.readdirSync(ui)
  .filter((name) => /^((embed|flow)\.(js|css)|welcome-robot\.js)$/.test(name) || /^sida-mark-.*\.png$/.test(name))
  .sort();

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = new Map(manifest.files.map((entry) => [entry.path, entry]));

const resources = names.map((name) => `workflow-stages/ui/${name}`);
resources.push('SIDA-Logo-3D/建造者机器人立体图标.glb', 'assets/home.css');

for (const rel of resources) {
  const bytes = fs.readFileSync(path.join(repo, rel));
  entries.set(rel, {
    path: rel,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  });
}

/* Keep the file's existing order; new paths go to the end, as a hand edit would. */
const known = new Set(manifest.files.map((entry) => entry.path));
manifest.files = manifest.files.map((entry) => entries.get(entry.path) || entry);
for (const [rel, entry] of entries) if (!known.has(rel)) manifest.files.push(entry);

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`package-manifest.json: ${resources.length} workspace resources recorded`);
