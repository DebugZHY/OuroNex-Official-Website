#!/usr/bin/env node
/*
 * Bake a NIDA model using SODA's Element display and extrusion rules.
 *
 * Read-only inputs: the source .dat and the bundled SODA parser/extrusion code.
 * Outputs: workflow-stages/models/steel-frame.glb and steel-frame.meta.json.
 *
 * Usage:
 *   node tools/workflow-embed/prepare-model.mjs "D:/path/to/model.dat"
 *
 * The source keeps NIDA's Z-up coordinates. No solver, loads, supports, node markers,
 * grid, camera, lights, textures or animation are written.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.join(repo, 'workflow-stages', 'models');
const outGlb = path.join(outDir, 'steel-frame.glb');
const outMeta = path.join(outDir, 'steel-frame.meta.json');
const sodaRoot = process.env.SODA_SOURCE_ROOT || 'D:/Development/SIDA/apps/soda-app/dist/source';
const sourcePath = process.argv[2];
const proofDir = process.env.SODA_PROOF_DIR || path.join(outDir, '..', '..', '_scratch', 'model-proof');

if (!sourcePath) {
  console.error('Usage: node tools/workflow-embed/prepare-model.mjs <NIDA-model.dat>');
  process.exit(2);
}
if (!fs.existsSync(sourcePath)) {
  console.error(`Source model not found: ${sourcePath}`);
  process.exit(2);
}
if (!fs.existsSync(path.join(sodaRoot, 'core', 'interchange', 'input', 'nida', 'NidaImporter.js'))) {
  console.error(`SODA source root not found or incomplete: ${sodaRoot}`);
  process.exit(2);
}

const sourceBytes = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const sourceFile = path.basename(sourcePath);
const requireSoda = createRequire(path.join(sodaRoot, 'core', 'package.json'));
const importer = requireSoda(path.join(sodaRoot, 'core', 'interchange', 'input', 'nida', 'NidaImporter.js'));

const imported = await importer.importText(sourceBytes.toString('utf8'), { fileName: sourceFile });
const model = imported.modelData;
if (!model) {
  console.error('NIDA import produced no model data.');
  console.error(JSON.stringify(imported.diagnostics || [], null, 2));
  process.exit(1);
}
const importErrors = (imported.diagnostics || []).filter(item => item.severity === 'error');
if (importErrors.length) {
  console.error(`NIDA import reported ${importErrors.length} error(s); refusing to emit a partial model.`);
  process.exit(1);
}
const sourceUnits = model.NIDA_SOURCE?.units || {};
if (sourceUnits.length !== 'm') {
  console.error(`Expected source length unit 'm', found ${JSON.stringify(sourceUnits.length)}. Nothing written.`);
  process.exit(1);
}

/* The bundled extrusion code expects the view bridge's THREE globals. */
const sandbox = { THREE, console, window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const fileName of ['extrusion_basis.js', 'extrusion_layout.js']) {
  const filePath = path.join(sodaRoot, 'web', 'js', 'view-bridge', fileName);
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
}
const geometryApi = sandbox.window.ViewBridgeExtrusionLayout;
if (!geometryApi || typeof geometryApi.buildMemberTriangles !== 'function') {
  console.error('SODA ViewBridgeExtrusionLayout.buildMemberTriangles is unavailable.');
  process.exit(1);
}

const nodeById = new Map((model.NODE || []).map(row => [row[0], row]));
const sectionById = new Map((model.SECTION || []).map(section => [section.id, section]));

const elements = [...(model.ELEMENT || [])].sort((a, b) => a.id - b.id);

const unsupported = [];
const skippedMembers = [];
const nodeRefs = [];

const bySection = new Map();
const allPositions = [];
let triangleCount = 0;
let vertexCount = 0;

function sectionColorHex(extrudeColor) {
  // Follow SODA exactly: ReadFromNida.colorToHex() converts the NIDA decimal
  // -color to '#rrggbb' with no channel swap, and stores it as extrudeColor.
  const hex = String(extrudeColor || '').toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

function srgbToLinear(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
}

function addTriangle(positions, normals, x1, y1, z1, x2, y2, z2, x3, y3, z3, sourceNormals) {
  if (![x1, y1, z1, x2, y2, z2, x3, y3, z3].every(Number.isFinite)) {
    throw new Error('Non-finite triangle vertex encountered.');
  }
  const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
  const vx = x3 - x1, vy = y3 - y1, vz = z3 - z1;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length > 1e-12) {
    nx /= length; ny /= length; nz /= length;
  } else {
    throw new Error('Degenerate extrusion triangle encountered.');
  }
  positions.push(x1, y1, z1, x2, y2, z2, x3, y3, z3);
  if (sourceNormals?.length === 9) normals.push(...sourceNormals);
  else normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  allPositions.push([x1, y1, z1], [x2, y2, z2], [x3, y3, z3]);
}

const memberMeta = [];
for (const element of elements) {
  const start = nodeById.get(element.startNode);
  const end = nodeById.get(element.endNode);
  const section = sectionById.get(element.section);
  if (!start || !end) {
    skippedMembers.push({ id: element.id, reason: 'missing node reference' });
    nodeRefs.push({ id: element.id, startFound: Boolean(start), endFound: Boolean(end) });
    continue;
  }
  nodeRefs.push({ id: element.id, startFound: true, endFound: true });
  if (!section) {
    skippedMembers.push({ id: element.id, reason: 'missing section assignment' });
    continue;
  }
  const geometry = section.sectionGeometry;
  if (!geometry || typeof geometry.sectionType !== 'number' || !Array.isArray(geometry.dimensions)) {
    unsupported.push({ id: element.id, section: section.name, reason: 'section has no extrudable geometry' });
    continue;
  }
  const lineFallback = geometry.sectionType === 0;
  const triangles = lineFallback ? {
    triangleCount: 0, positions: [...start.slice(1, 4), ...end.slice(1, 4)],
  } : geometryApi.buildMemberTriangles(
    geometry,
    { x: start[1], y: start[2], z: start[3] },
    { x: end[1], y: end[2], z: end[3] },
    element.beta,
  );
  if (!triangles || (!lineFallback && !triangles.triangleCount) || !triangles.positions?.length) {
    unsupported.push({ id: element.id, section: section.name, reason: 'extrusion returned no triangles' });
    continue;
  }
  if (!lineFallback && triangles.positions.length !== triangles.triangleCount * 9) {
    unsupported.push({ id: element.id, section: section.name, reason: 'triangle count mismatch' });
    continue;
  }
  const sodaColor = section.sectionGeometry.extrudeColor;
  const colorHex = sectionColorHex(sodaColor);
  if (!colorHex) {
    unsupported.push({ id: element.id, section: section.name, reason: 'missing section colour' });
    continue;
  }
  let group = bySection.get(section.id);
  if (!group) {
    const stats = {
      id: section.id,
      name: section.name,
      sectionType: geometry.sectionType,
      dimensions: geometry.dimensions.map(Number),
      materialId: section.material ?? null,
      area: section.area ?? null,
      Iyy: section.Iyy ?? null,
      Izz: section.Izz ?? null,
      J: section.J ?? null,
      Cw: section.Cw ?? null,
      Zyy: section.Zyy ?? null,
      Zzz: section.Zzz ?? null,
      nidaColorInt: Number.parseInt(String(sodaColor || '').replace(/^#/, ''), 16),
      sodaExtrudeColor: sodaColor,
      colorHex,
      memberCount: 0,
      triangleCount: 0,
      vertexCount: 0,
    };
    group = { section, stats, mode: lineFallback ? 1 : 4, positions: [], normals: [], edges: [], materialId: section.material ?? null };
    bySection.set(section.id, group);

  }
  const positions = triangles.positions;
  if (lineFallback) {
    if (!positions.every(Number.isFinite) || Math.hypot(...end.slice(1, 4).map((v, i) => v - start[i + 1])) < 1e-12) throw new Error(`Invalid line element ${element.id}`);
    group.positions.push(...positions);
    allPositions.push(positions.slice(0, 3), positions.slice(3, 6));
  } else for (let offset = 0; offset < positions.length; offset += 9) {
    addTriangle(group.positions, group.normals,
      positions[offset], positions[offset + 1], positions[offset + 2],
      positions[offset + 3], positions[offset + 4], positions[offset + 5],
      positions[offset + 6], positions[offset + 7], positions[offset + 8],
      triangles.normals?.subarray(offset, offset + 9));
  }
  group.stats.memberCount += 1;
  if (!lineFallback) {
    const edges = geometryApi.buildMemberEdges(geometry,
      { x: start[1], y: start[2], z: start[3] },
      { x: end[1], y: end[2], z: end[3] }, element.beta);
    if (edges?.positions?.length) {
      for (const value of edges.positions) {
        if (!Number.isFinite(value)) throw new Error(`Invalid extrusion edge in element ${element.id}`);
        group.edges.push(value);
      }
      for (let i = 0; i < edges.positions.length; i += 3) allPositions.push(Array.from(edges.positions.subarray(i, i + 3)));
    }
  }
  group.stats.triangleCount += triangles.triangleCount;
  group.stats.vertexCount += lineFallback ? 2 : triangles.triangleCount * 3;
  triangleCount += triangles.triangleCount;
  vertexCount += lineFallback ? 2 : triangles.triangleCount * 3;
  memberMeta.push({
    id: element.id,
    startNode: element.startNode,
    endNode: element.endNode,
    sectionId: section.id,
    sectionName: section.name,
    sectionType: geometry.sectionType,
    dimensions: geometry.dimensions.map(Number),
    materialId: element.material,
    betaRadians: element.beta,
    betaDegrees: element.beta * 180 / Math.PI,
    triangleCount: triangles.triangleCount,
    vertexCount: lineFallback ? 2 : triangles.triangleCount * 3,
    colorHex,
    representation: lineFallback ? 'ElementLine' : 'ElementExtrude',
  });
}

if (skippedMembers.length || unsupported.length || memberMeta.length !== elements.length) {
  console.error(`Conversion blocked: ${memberMeta.length}/${elements.length} members emitted.`);
  console.error(JSON.stringify({ skippedMembers, unsupported }, null, 2));
  process.exit(1);
}

const sections = [...bySection.values()].sort((a, b) => a.section.id - b.section.id);

if (!allPositions.length) {
  console.error('No triangle positions were produced.');
  process.exit(1);
}

function boundsOf(points) {
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    const value = Math.fround(point[axis]);
    box.min[axis] = Math.min(box.min[axis], value); box.max[axis] = Math.max(box.max[axis], value);
  }
  return box;
}
const bounds = boundsOf(allPositions);
const center = bounds.min.map((value, index) => (value + bounds.max[index]) / 2);
const sourceNodes = (model.NODE || []).map(row => ({ id: row[0], x: row[1], y: row[2], z: row[3] }));
const sourceNodeBounds = {
  min: [Math.min(...sourceNodes.map(node => node.x)), Math.min(...sourceNodes.map(node => node.y)), Math.min(...sourceNodes.map(node => node.z))],
  max: [Math.max(...sourceNodes.map(node => node.x)), Math.max(...sourceNodes.map(node => node.y)), Math.max(...sourceNodes.map(node => node.z))],
};

/* GLB: one mesh per section, flat-shaded triangles, no texture/camera/light/animation. */
const binChunks = [];
const bufferViews = [];
const accessors = [];
const materials = [];
const meshes = [];
const glbNodes = [];
let byteOffset = 0;
function pushBufferView(values, target) {
  const data = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const paddedLength = Math.ceil(data.length / 4) * 4;
  const chunk = Buffer.alloc(paddedLength);
  data.copy(chunk);
  binChunks.push(chunk);
  const index = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, target });
  byteOffset += paddedLength;
  return index;
}
function addAccessor(values, min, max) {
  const bufferView = pushBufferView(values, 34962);
  const accessor = { bufferView, componentType: 5126, count: values.length / 3, type: 'VEC3' };
  if (min) accessor.min = min;
  if (max) accessor.max = max;
  accessors.push(accessor);
  return accessors.length - 1;
}

for (const group of sections) {
  const unique = new Map(), positionIndices = new Map(), packedPositions = [], packedNormals = [], indices = [], edgeIndices = [];
  for (let i = 0; i < group.positions.length; i += 3) {
    const position = group.positions.slice(i, i + 3).map(Math.fround);
    const normal = group.mode === 4 ? group.normals.slice(i, i + 3).map(Math.fround) : [];
    const key = [...position, ...normal].join(',');
    if (!unique.has(key)) {
      unique.set(key, packedPositions.length / 3);
      packedPositions.push(...position); packedNormals.push(...normal);
    }
    indices.push(unique.get(key));
    positionIndices.set(position.join(','), unique.get(key));
  }
  for (let i = 0; i < group.edges.length; i += 3) {
    const position = group.edges.slice(i, i + 3).map(Math.fround);
    const key = position.join(',');
    if (!positionIndices.has(key)) {
      positionIndices.set(key, packedPositions.length / 3);
      packedPositions.push(...position);
      packedNormals.push(0, 0, 1);
    }
    edgeIndices.push(positionIndices.get(key));
  }
  const positions = new Float32Array(packedPositions);
  const normals = new Float32Array(packedNormals);
  const groupBounds = boundsOf(Array.from({ length: positions.length / 3 }, (_, i) => positions.subarray(i * 3, i * 3 + 3)));
  const positionAccessor = addAccessor(positions, groupBounds.min, groupBounds.max);
  const attributes = { POSITION: positionAccessor };
  if (group.mode === 4) attributes.NORMAL = addAccessor(normals);
  const shortIndices = packedPositions.length / 3 <= 65536;
  const indexArray = shortIndices ? new Uint16Array(indices) : new Uint32Array(indices);
  accessors.push({ bufferView: pushBufferView(indexArray, 34963), componentType: shortIndices ? 5123 : 5125, count: indices.length, type: 'SCALAR', min: [0], max: [unique.size - 1] });
  const indexAccessor = accessors.length - 1;
  const color = srgbToLinear(group.stats.colorHex);
  materials.push({
    name: `Section ${group.section.id} ${group.section.name}`,
    pbrMetallicRoughness: {
      baseColorFactor: [color[0], color[1], color[2], 1],
      metallicFactor: 0.25,
      roughnessFactor: 0.55,
    },
    doubleSided: true,
    extras: {
      sectionId: group.section.id,
      nidaColorInt: group.stats.nidaColorInt,
      colorHex: group.stats.colorHex,
    },
  });
  const primitives = [{ attributes, indices: indexAccessor, material: materials.length - 1, mode: group.mode }];
  if (edgeIndices.length) {
    const values = shortIndices ? new Uint16Array(edgeIndices) : new Uint32Array(edgeIndices);
    accessors.push({ bufferView: pushBufferView(values, 34963), componentType: shortIndices ? 5123 : 5125,
      count: values.length, type: 'SCALAR', min: [edgeIndices.reduce((a, b) => Math.min(a, b), Infinity)],
      max: [edgeIndices.reduce((a, b) => Math.max(a, b), -Infinity)] });
    primitives.push({ attributes: { POSITION: positionAccessor }, indices: accessors.length - 1,
      material: materials.length - 1, mode: 1, extras: { role: 'extrusionEdges' } });
  }
  meshes.push({
    name: group.section.name,
    primitives,
    extras: { sectionId: group.section.id, memberCount: group.stats.memberCount, triangleCount: group.stats.triangleCount },
  });
  glbNodes.push({ name: group.section.name, mesh: meshes.length - 1, extras: { sectionId: group.section.id, type: group.mode === 4 ? 'ElementExtrude' : 'ElementLine' } });
}

const glbJson = {
  asset: {
    version: '2.0',
    generator: 'OuroNex SIDA NIDA Element(Extrude) converter',
    extras: { upAxis: 'Z', units: 'm', sourceSha256, memberCount: elements.length, triangleCount },
  },
  scene: 0,
  scenes: [{ name: 'SIDA steel frame — Element(Extrude)', nodes: glbNodes.map((_, index) => index), extras: { upAxis: 'Z', units: 'm' } }],
  nodes: glbNodes,
  meshes,
  materials,
  bufferViews,
  accessors,
  buffers: [{ byteLength: byteOffset }],
};
const jsonBytes = Buffer.from(JSON.stringify(glbJson), 'utf8');
const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
const binLength = binChunks.reduce((sum, chunk) => sum + chunk.length, 0);
const binChunk = Buffer.concat([...binChunks, Buffer.alloc((4 - (binLength % 4)) % 4)]);
const glbLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // glTF
header.writeUInt32LE(2, 4);
header.writeUInt32LE(glbLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // BIN
const glb = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);

const meta = {
  formatVersion: 1,
  upAxis: 'Z',
  units: 'm',
  center,
  bounds,
  nodeCount: sourceNodes.length,
  memberCount: memberMeta.length,
  sectionCount: model.SECTION.length,
  triangleCount,
  vertexCount,
  sourceSha256,
  sourceFile,
  displayName: 'Frame-model-v2.dat',
  sourceUnits,
  sourceNidaVersion: model.NIDA_SOURCE?.version ?? null,
  coordinateSystem: 'NIDA source coordinates retained: Z-up, metres. No rotation, translation or scale applied.',
  sectionColors: 'Follows the bundled SODA reader/display convention, with no channel swap: ReadFromNida.colorToHex(section.color) writes the NIDA decimal -color as #rrggbb into sectionGeometry.extrudeColor (ReadFromNida.js:597-603, 4818); SectionExtrusions.js normalizes that exact extrudeColor for display.',
  memberOrientation: 'NIDA *MemberOrientation MembAngle values become element.beta in radians; SODA calculateElementBasis applies them to the section local axes.',
  memberOffsets: 'Element endpoints follow the imported node coordinates. This static view uses SODA undeformed member extrusion.',
  sectionOffsets: 'Section shape-loop coordinates (including SODA shape/centroid offsets) are baked by ViewBridgeExtrusionLayout.buildMemberTriangles.',
  conversion: {
    script: 'tools/workflow-embed/prepare-model.mjs',
    parser: 'SODA NidaImporter (bundled source)',
    geometry: 'SODA ViewBridgeExtrusionLayout.buildMemberTriangles + calculateElementBasis',
    sourceRoot: 'configured by SODA_SOURCE_ROOT at conversion time (not part of this metadata)',
  },
  sourceSummary: {
    nodes: imported.summary.nodes,
    elements: imported.summary.elements,
    sections: imported.summary.sections,
    materials: imported.summary.materials,
    boundaries: imported.summary.boundaries,
    areas: imported.summary.importedAreas,
    areaLoads: imported.summary.importedAreaLoads,
  },
  excluded: {
    areas: imported.summary.importedAreas,
    boundaries: imported.summary.boundaries,
    loads: (imported.summary.importedAreaLoads || 0) + (imported.summary.importedUniformLoads || 0) + (imported.summary.importedPointLoads || 0) + (imported.summary.importedJointLoads || 0),
    reason: 'The deliverable is a static Element(Extrude) geometry display only.',
  },
  sourceNodeBounds,
  sections: sections.map(group => group.stats),
  nodes: sourceNodes,
  members: memberMeta,
  validation: {
    elementRows: elements.length,
    emittedMembers: memberMeta.length,
    skippedMembers,
    unsupported,
    allMemberNodeRefsFound: nodeRefs.every(item => item.startFound && item.endFound),
    allMemberSectionsAssigned: memberMeta.every(item => item.sectionId != null),
    allVerticesFinite: allPositions.every(point => point.every(Number.isFinite)),
    triangleCountMatchesSections: sections.reduce((sum, group) => sum + group.stats.triangleCount, 0) === triangleCount,
    memberCountMatchesElements: memberMeta.length === elements.length,
    sectionTriangleCounts: Object.fromEntries(sections.map(group => [group.section.name, group.stats.triangleCount])),
  },
  glb: {
    nodeCount: glbNodes.length,
    meshCount: meshes.length,
    materialCount: materials.length,
    primitiveCount: meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
    byteLength: glb.length,
    hasTextures: false,
    hasAnimations: false,
    hasCameras: false,
    hasLights: false,
  },
  unsupported: [],
};

fs.mkdirSync(outDir, { recursive: true });
const lineFallbackMembers = memberMeta.filter(member => member.representation === 'ElementLine');
meta.lineFallback = { count: lineFallbackMembers.length, memberIds: lineFallbackMembers.map(member => member.id), reason: 'SODA keeps sectionType 0 elements as centre lines when extrusion geometry is absent.' };
meta.extrudedMemberCount = memberMeta.length - lineFallbackMembers.length;
fs.mkdirSync(proofDir, { recursive: true });
fs.writeFileSync(path.join(proofDir, 'conversion-detail.json'), JSON.stringify(meta, null, 2) + '\n');
const compactMeta = {
  formatVersion: 1, upAxis: meta.upAxis, units: meta.units, center, bounds,
  nodeCount: meta.nodeCount, memberCount: meta.memberCount, sectionCount: meta.sectionCount,
  triangleCount, extrudedMemberCount: meta.extrudedMemberCount, lineFallbackCount: lineFallbackMembers.length,
  edgeSegmentCount: sections.reduce((sum, group) => sum + group.edges.length / 6, 0),
  sourceFile, sourceSha256, displayName: meta.displayName,
  sections: model.SECTION.map(section => ({ id: section.id, name: section.name,
    color: sectionColorHex(section.sectionGeometry?.extrudeColor) || '#808080',
    memberCount: bySection.get(section.id)?.stats.memberCount || 0,
    // The original SODA section-visuals.js glyph vocabulary reads this stored
    // type (I/H = 2, General Basic = 0), never the section's display name.
    sectionType: Number.isInteger(section.sectionGeometry?.sectionType)
      ? section.sectionGeometry.sectionType : null })),
};
fs.writeFileSync(outGlb, glb);
fs.writeFileSync(`${outGlb}.gz`, gzipSync(glb, { level: 9 }));
fs.writeFileSync(outMeta, JSON.stringify(compactMeta) + '\n', 'utf8');

console.log(`source      ${sourceFile}`);
console.log(`sha256      ${sourceSha256}`);
console.log(`nodes       ${meta.nodeCount}`);
console.log(`members     ${meta.memberCount}`);
console.log(`sections    ${meta.sectionCount}`);
console.log(`triangles   ${meta.triangleCount}`);
console.log(`bounds      ${JSON.stringify(bounds)}`);
console.log(`glb         ${outGlb} (${glb.length} bytes)`);
console.log(`meta        ${outMeta}`);
