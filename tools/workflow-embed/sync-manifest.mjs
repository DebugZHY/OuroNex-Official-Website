/* Records the built embed files in package-manifest.json (bytes + sha256).
   The site's file service only serves manifest paths, so the bundle must be listed here.

   Usage: node sync-manifest.mjs   (after npm run build) */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STAGES, resourcesFor } from './src/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const ui = path.resolve(here, '../../workflow-stages/ui');
const manifestPath = path.join(repo, 'package-manifest.json');

const names = fs.readdirSync(ui)
  .filter((name) => /^((embed|flow|soda-viewer)\.(js|css)|welcome-robot\.js)$/.test(name) || /^sida-mark-.*\.png$/.test(name))
  .sort();

/* Only these toolbar icons are rendered. The retired Undo/Redo and Select controls must not
   be pulled back into the manifest by a directory scan. */
const SODA_ICONS = [
  'fit_to_screen.png',
  'isometric_view.png',
  'pan.png',
  'perspective_view.png',
  'rotate.png',
  'zoom_in.png',
  'zoom_out.png',
];

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = new Map();

const resources = names.map((name) => `workflow-stages/ui/${name}`);
resources.push(
  'SIDA-Logo-3D/建造者机器人立体图标.glb',
  'assets/home.css',
  'assets/home.js',
  'assets/home-scenes.css',
  'assets/home-scene-clock.js',
  'assets/legal.css',
  'assets/site.css',
  'assets/site.js',
);
resources.push('workflow-stages/models/transmission-tower.glb', 'workflow-stages/models/transmission-tower.glb.gz', 'workflow-stages/models/transmission-tower.meta.json');
resources.push(...SODA_ICONS.map((name) => `workflow-stages/ui/soda-icons/${name}`));
resources.push('workflow-stages/features/multidisciplinary-experts.html',
  'workflow-stages/features/information-management.html',
  'workflow-stages/features/expert-avatars.js', 'workflow-stages/features/expert-avatars.css');
resources.push(...fs.readdirSync(path.join(repo, 'workflow-stages/features/flow-assets/experts'))
  .filter(name => name.endsWith('.svg')).map(name => `workflow-stages/features/flow-assets/experts/${name}`));
resources.push(...new Set(STAGES.flatMap(stage => {
  const { expert, tools } = resourcesFor(stage.id);
  return [...(expert ? [expert.src] : []), ...tools.map(tool => tool.src)];
})));

const uniqueResources = [...new Set(resources)];
for (const rel of uniqueResources) {
  const bytes = fs.readFileSync(path.join(repo, rel));
  entries.set(rel, {
    path: rel,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  });
}

/* Drop retired managed assets: old model files and unused SODA toolbar icons. */
const modelPrefix = 'workflow-stages/models/';
const iconPrefix = 'workflow-stages/ui/soda-icons/';
const managedModels = new Set(uniqueResources.filter((rel) => rel.startsWith(modelPrefix)));
const managedIcons = new Set(uniqueResources.filter((rel) => rel.startsWith(iconPrefix)));
manifest.files = manifest.files.filter((entry) => {
  if (entry.path.startsWith(modelPrefix)) return managedModels.has(entry.path);
  if (entry.path.startsWith(iconPrefix)) return managedIcons.has(entry.path);
  return true;
});

/* Refresh every retained entry so unrelated hand edits cannot leave a stale hash behind. */
for (const entry of manifest.files) {
  const absolute = path.join(repo, entry.path);
  if (!fs.existsSync(absolute)) {
    throw new Error(`package-manifest entry is missing on disk: ${entry.path}`);
  }
  const bytes = fs.readFileSync(absolute);
  entry.bytes = bytes.length;
  entry.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  entry.size = bytes.length;
}

/* Keep the file's existing order; new paths go to the end, as a hand edit would. */
const known = new Set(manifest.files.map((entry) => entry.path));
for (const [rel, entry] of entries) if (!known.has(rel)) manifest.files.push(entry);

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`package-manifest.json: ${uniqueResources.length} workspace resources recorded`);
