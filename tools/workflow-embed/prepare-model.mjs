#!/usr/bin/env node
/*
 * Bake a SODA model using its Element display and extrusion rules.
 *
 * Read-only inputs: the source .dat/.json and the bundled SODA parser/extrusion code.
 * Outputs: workflow-stages/models/<name>.glb, .glb.gz and .meta.json.
 * Set SODA_OUTPUT_DIR for isolated reproducibility checks and SODA_PROOF_DIR
 * for full conversion evidence outside the published model directory.
 *
 * Usage:
 *   node tools/workflow-embed/prepare-model.mjs "D:/path/to/model.dat"
 *   node tools/workflow-embed/prepare-model.mjs "D:/path/to/model.json"
 *
 * Coordinates are kept in the source frame. No solver, loads, supports, node markers,
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
const outDir = process.env.SODA_OUTPUT_DIR || path.join(repo, 'workflow-stages', 'models');
const sodaRoot = process.env.SODA_SOURCE_ROOT || 'D:/Development/SIDA/apps/soda-app/dist/source';
const sourcePath = process.argv[2];
const isSodaJson = /\.json$/i.test(String(sourcePath || ''));
const outputBase = isSodaJson ? 'transmission-tower' : 'steel-frame';
const outGlb = path.join(outDir, `${outputBase}.glb`);
const outMeta = path.join(outDir, `${outputBase}.meta.json`);
const proofDir = process.env.SODA_PROOF_DIR || path.join(outDir, '..', '..', '_scratch', 'model-proof');

if (!sourcePath) {
  console.error('Usage: node tools/workflow-embed/prepare-model.mjs <NIDA-model.dat|SODA-model.json>');
  process.exit(2);
}
if (!fs.existsSync(sourcePath)) {
  console.error(`Source model not found: ${sourcePath}`);
  process.exit(2);
}
if (!isSodaJson && !fs.existsSync(path.join(sodaRoot, 'core', 'interchange', 'input', 'nida', 'NidaImporter.js'))) {
  console.error(`SODA source root not found or incomplete: ${sodaRoot}`);
  process.exit(2);
}

const sourceBytes = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const sourceFile = path.basename(sourcePath);

let model, importedSummary, sourceUnits, upAxis, displayName, parserName, sourceVersion;
if (isSodaJson) {
  const json = JSON.parse(sourceBytes.toString('utf8'));
  const normalized = normalizeSodaJsonModel(json);
  model = normalized.model;
  importedSummary = normalized.summary;
  upAxis = normalized.upAxis;
  sourceUnits = { length: 'm', force: 'kN' };
  displayName = 'Frame-model-v2.dat';
  parserName = `SODA JSON ${json.VERSION || ''}`.trim();
  sourceVersion = json.VERSION ?? null;
} else {
  const requireSoda = createRequire(path.join(sodaRoot, 'core', 'package.json'));
  const importer = requireSoda(path.join(sodaRoot, 'core', 'interchange', 'input', 'nida', 'NidaImporter.js'));
  const imported = await importer.importText(sourceBytes.toString('utf8'), { fileName: sourceFile });
  model = imported.modelData;
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
  importedSummary = imported.summary;
  sourceUnits = model.NIDA_SOURCE?.units || {};
  upAxis = 'Z';
  displayName = 'Frame-model-v2.dat';
  parserName = 'SODA NidaImporter (bundled source)';
  sourceVersion = model.NIDA_SOURCE?.version ?? null;
}
if (sourceUnits.length !== 'm') {
  console.error(`Expected source length unit 'm', found ${JSON.stringify(sourceUnits.length)}. Nothing written.`);
  process.exit(1);
}
if (upAxis !== 'Z' && upAxis !== 'Y') {
  console.error(`Expected a Z-up or Y-up source model, found ${JSON.stringify(upAxis)}. Nothing written.`);
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

/* SODA JSON stores section geometry in parallel SECTIONGEOMETRY rows. Apply the
 * same field order as core/model/geometry/Elements.js: array rows carry a fixed
 * dimension block followed by 0-255 RGB colour channels. */
function rgb255ToHex(r, g, b) {
  const values = [r, g, b].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const channel = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${values.map(channel).join('')}`;
}

function normalizeSodaJsonModel(json) {
  if (!json || typeof json !== 'object') throw new Error('SODA JSON model must be an object.');
  const nodeRows = Array.isArray(json.NODE) ? json.NODE : null;
  const elementRows = Array.isArray(json.ELEMENT) ? json.ELEMENT : null;
  const sectionRows = Array.isArray(json.SECTION) ? json.SECTION : null;
  const materialRows = Array.isArray(json.MATERIAL) ? json.MATERIAL : null;
  if (!nodeRows?.length || !elementRows?.length || !sectionRows?.length || !materialRows?.length) {
    throw new Error('SODA JSON model is missing NODE, ELEMENT, SECTION or MATERIAL rows.');
  }
  const nodes = nodeRows.map(row => {
    if (!Array.isArray(row) || row.length < 4 || !row.slice(0, 4).every(value => Number.isFinite(Number(value)))) {
      throw new Error('SODA JSON NODE rows must be [id, x, y, z] with finite coordinates.');
    }
    return [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3])];
  });
  const elements = elementRows.map(element => {
    if (!element || !Number.isInteger(Number(element.id)) || !Number.isFinite(Number(element.beta))) {
      throw new Error('SODA JSON ELEMENT rows must carry a numeric id, nodes, section, material and beta.');
    }
    return { ...element, id: Number(element.id), startNode: Number(element.startNode), endNode: Number(element.endNode),
      section: Number(element.section), material: Number(element.material), beta: Number(element.beta) };
  });
  const geometryById = new Map();
  for (const row of json.SECTIONGEOMETRY || []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const id = Number(row[0]);
    const sectionType = Math.round(Number(row[1]));
    let dimensions = [];
    let colorOffset = -1;
    if (sectionType === 15) {
      dimensions = [row[2], row[3], row[5], row[7], row[4]];
      colorOffset = 8;
    } else if (sectionType === 16) {
      dimensions = [row[2], row[3], row[4], row[5], row[6]];
      colorOffset = 8;
    } else if (sectionType === 11 || sectionType === 12) {
      dimensions = row.slice(2, 8);
      colorOffset = 8;
    } else if ([2, 4, 5, 6, 7, 8, 9, 10, 14].includes(sectionType)) {
      dimensions = [row[2], row[3], row[4], row[5]];
      colorOffset = 6;
    } else {
      continue;
    }
    if (!dimensions.every(value => Number.isFinite(Number(value)))) {
      throw new Error(`SECTIONGEOMETRY row ${id} has non-numeric dimensions.`);
    }
    const extrudeColor = colorOffset >= 0 ? rgb255ToHex(row[colorOffset], row[colorOffset + 1], row[colorOffset + 2]) : null;
    geometryById.set(id, { sectionType, dimensions: dimensions.map(Number), ...(extrudeColor ? { extrudeColor } : {}) });
  }
  const sections = sectionRows.map(section => {
    if (!section || !Number.isInteger(Number(section.id)) || typeof section.name !== 'string' || !section.name.trim()) {
      throw new Error('SODA JSON SECTION rows must carry an integer id and a name.');
    }
    const id = Number(section.id);
    return { ...section, id, sectionGeometry: geometryById.get(id) };
  });
  const usedSections = new Set(elements.map(element => element.section));
  const missingGeometry = [...usedSections].filter(id => !geometryById.has(id));
  if (missingGeometry.length) {
    throw new Error(`Sections ${missingGeometry.join(', ')} have no SODA SECTIONGEOMETRY row.`);
  }
  const upAxis = String(json.VIEW_SETTINGS?.upAxis || 'Y').toUpperCase();
  const summary = {
    nodes: nodes.length,
    elements: elements.length,
    sections: sections.length,
    materials: materialRows.length,
    boundaries: (json.BOUNDARY || []).length,
    importedAreas: (json.AREA || []).length,
    importedAreaLoads: (json.AREALOAD || []).length,
    importedUniformLoads: (json.UNIFORMLOAD || []).length,
    importedPointLoads: (json.MEMBERPOINTLOAD || []).length,
    importedJointLoads: (json.JOINTLOAD || []).length,
  };
  return {
    upAxis,
    summary,
    model: { NODE: nodes, ELEMENT: elements, SECTION: sections, MATERIAL: materialRows, AREA: json.AREA || [] },
  };
}

const nodeById = new Map((model.NODE || []).map(row => [row[0], row]));
const sectionById = new Map((model.SECTION || []).map(section => [section.id, section]));
// MATERIAL is positional [id, name, ...]. Keep the original spelling in proof;
// remove only NIDA's display delimiters, including the source's literal '<copy'.
const materialById = new Map();
for (const row of model.MATERIAL || []) {
  if (!Array.isArray(row) || !Number.isInteger(row[0]) || typeof row[1] !== 'string' || !row[1].trim()) {
    throw new Error('Invalid imported MATERIAL row; cannot establish material identity.');
  }
  if (materialById.has(row[0])) throw new Error(`Duplicate imported material ID ${row[0]}`);
  materialById.set(row[0], { id: row[0], name: row[1].replace(/^<|>$/g, ''), sourceName: row[1], memberCount: 0 });
}

const elements = [...(model.ELEMENT || [])].sort((a, b) => a.id - b.id);
const memberIds = new Set();
for (const element of elements) {
  if (!Number.isInteger(element.id) || memberIds.has(element.id)) throw new Error(`Invalid or duplicate imported member ID ${element.id}`);
  memberIds.add(element.id);
  const material = materialById.get(element.material);
  if (!material) throw new Error(`Member ${element.id} references unknown imported material ${element.material}`);
  material.memberCount += 1;
}
const sourceMaterials = [...materialById.values()].sort((a, b) => a.id - b.id);
const usedSourceMaterials = sourceMaterials.filter(material => material.memberCount > 0);
// This approved display grouping belongs to this exact example DAT only. It is
// not an inference about copy/Rigid, and never changes ELEMENT.material or GLB IDs.
const exampleSourceSha256 = 'a21271f786377d372a89ce1e7959d2690a99f2fb29ad31b9df5656a92f9d60fb';
const displayGroupDefinitions = sourceSha256 === exampleSourceSha256 ? [
  { id: 1, name: 'S355', sourceMaterialIds: [1, 3, 5] },
  { id: 4, name: 'C40', sourceMaterialIds: [4] },
] : usedSourceMaterials.map(material => ({ id: material.id, name: material.name, sourceMaterialIds: [material.id] }));
const displayedSourceIds = new Set();
const displayMaterials = displayGroupDefinitions.map(definition => {
  if (materialById.get(definition.id)?.name !== definition.name) throw new Error(`Display group ${definition.id} does not match the imported material name`);
  let memberCount = 0;
  for (const id of definition.sourceMaterialIds) {
    const material = materialById.get(id);
    if (!material || displayedSourceIds.has(id)) throw new Error(`Invalid or overlapping display material assignment ${id}`);
    displayedSourceIds.add(id);
    memberCount += material.memberCount;
  }
  return { ...definition, memberCount };
}).filter(material => material.memberCount > 0);
if (usedSourceMaterials.some(material => !displayedSourceIds.has(material.id)) ||
    displayMaterials.reduce((sum, material) => sum + material.memberCount, 0) !== elements.length) {
  throw new Error('Display material groups do not partition the imported members.');
}

const unsupported = [];
const skippedMembers = [];
const nodeRefs = [];

const bySection = new Map();
const bySectionMaterial = new Map();
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
  let sectionGroup = bySection.get(section.id);
  if (!sectionGroup) {
    const stats = {
      id: section.id,
      name: section.name,
      sectionType: geometry.sectionType,
      dimensions: geometry.dimensions.map(Number),
      materialIds: [],
      memberIds: [],
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
    sectionGroup = { section, stats };
    bySection.set(section.id, sectionGroup);
  }
  const groupKey = JSON.stringify([section.id, element.material]);
  let group = bySectionMaterial.get(groupKey);
  if (!group) {
    group = { section, stats: { colorHex, nidaColorInt: sectionGroup.stats.nidaColorInt, memberCount: 0, triangleCount: 0, vertexCount: 0 },
      mode: lineFallback ? 1 : 4, positions: [], normals: [], edges: [],
      materialId: element.material, memberIds: [], edgeMemberIds: [] };
    bySectionMaterial.set(groupKey, group);
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
  group.memberIds.push(element.id);
  sectionGroup.stats.memberCount += 1;
  sectionGroup.stats.memberIds.push(element.id);
  if (!sectionGroup.stats.materialIds.includes(element.material)) sectionGroup.stats.materialIds.push(element.material);
  let edgeSegmentCount = 0;
  if (!lineFallback) {
    const edges = geometryApi.buildMemberEdges(geometry,
      { x: start[1], y: start[2], z: start[3] },
      { x: end[1], y: end[2], z: end[3] }, element.beta);
    if (edges?.positions?.length) {
      if (edges.positions.length % 6) throw new Error(`Incomplete extrusion edge in element ${element.id}`);
      group.edgeMemberIds.push(element.id);
      edgeSegmentCount = edges.positions.length / 6;
      for (const value of edges.positions) {
        if (!Number.isFinite(value)) throw new Error(`Invalid extrusion edge in element ${element.id}`);
        group.edges.push(value);
      }
      for (let i = 0; i < edges.positions.length; i += 3) allPositions.push(Array.from(edges.positions.subarray(i, i + 3)));
    }
  }
  group.stats.triangleCount += triangles.triangleCount;
  group.stats.vertexCount += lineFallback ? 2 : triangles.triangleCount * 3;
  sectionGroup.stats.triangleCount += triangles.triangleCount;
  sectionGroup.stats.vertexCount += lineFallback ? 2 : triangles.triangleCount * 3;
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
    materialName: materialById.get(element.material).name,
    edgeSegmentCount,
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
for (const section of sections) section.stats.materialIds.sort((a, b) => a - b);
const groups = [...bySectionMaterial.values()].sort((a, b) => a.section.id - b.section.id || a.materialId - b.materialId);
const groupedMemberIds = groups.flatMap(group => group.memberIds);
if (groupedMemberIds.length !== elements.length || new Set(groupedMemberIds).size !== elements.length ||
    groupedMemberIds.some(id => !memberIds.has(id))) {
  throw new Error('Section/material groups lost or duplicated imported member IDs.');
}
function ownership(group, ids = group.memberIds) {
  return { sectionId: group.section.id, materialId: group.materialId, memberCount: ids.length, memberIds: [...ids] };
}

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

/* GLB: one mesh per actual section/material pair; geometry and visual colours stay unchanged. */
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

for (const group of groups) {
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
      materialId: group.materialId,
      nidaColorInt: group.stats.nidaColorInt,
      colorHex: group.stats.colorHex,
    },
  });
  const primitives = [{ attributes, indices: indexAccessor, material: materials.length - 1, mode: group.mode, extras: ownership(group) }];
  if (edgeIndices.length) {
    const values = shortIndices ? new Uint16Array(edgeIndices) : new Uint32Array(edgeIndices);
    accessors.push({ bufferView: pushBufferView(values, 34963), componentType: shortIndices ? 5123 : 5125,
      count: values.length, type: 'SCALAR', min: [edgeIndices.reduce((a, b) => Math.min(a, b), Infinity)],
      max: [edgeIndices.reduce((a, b) => Math.max(a, b), -Infinity)] });
    primitives.push({ attributes: { POSITION: positionAccessor }, indices: accessors.length - 1,
      material: materials.length - 1, mode: 1, extras: { role: 'extrusionEdges', ...ownership(group, group.edgeMemberIds) } });
  }
  meshes.push({
    name: group.section.name,
    primitives,
    extras: { ...ownership(group), triangleCount: group.stats.triangleCount },
  });
  glbNodes.push({ name: group.section.name, mesh: meshes.length - 1,
    extras: { ...ownership(group), type: group.mode === 4 ? 'ElementExtrude' : 'ElementLine' } });
}

const glbJson = {
  asset: {
    version: '2.0',
    generator: `OuroNex SIDA ${isSodaJson ? 'SODA JSON' : 'NIDA'} Element(Extrude) converter`,
    extras: { upAxis, units: 'm', sourceSha256, memberCount: elements.length, triangleCount },
  },
  scene: 0,
  scenes: [{ name: `SIDA ${isSodaJson ? 'transmission tower' : 'steel frame'} — Element(Extrude)`, nodes: glbNodes.map((_, index) => index), extras: { upAxis, units: 'm' } }],
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
  upAxis,
  units: 'm',
  center,
  bounds,
  nodeCount: sourceNodes.length,
  memberCount: memberMeta.length,
  sectionCount: sections.length,
  sourceSectionCount: model.SECTION.length,
  sourceMaterialCount: sourceMaterials.length,
  materials: displayMaterials,
  sourceMaterials,
  sourceMaterialRows: model.MATERIAL,
  materialMembership: isSodaJson
    ? 'ELEMENT[].material is the source of every member/group material ID; MATERIAL [id, name, ...] supplies names. No imported material assignment is changed.'
    : 'ELEMENT[].material is the source of every member/group material ID; MATERIAL [id, name, ...] supplies names. The two approved display groups apply only to the identified example SHA; no imported material assignment is changed.',
  groups: groups.map(group => ({ ...ownership(group), edgeMemberIds: group.edgeMemberIds,
    triangleCount: group.stats.triangleCount, edgeSegmentCount: group.edges.length / 6,
    representation: group.mode === 4 ? 'ElementExtrude' : 'ElementLine' })),
  triangleCount,
  vertexCount,
  sourceSha256,
  sourceFile,
  displayName,
  sourceUnits,
  sourceFormat: isSodaJson ? 'SODA JSON' : 'NIDA DAT',
  sourceVersion,
  sourceNidaVersion: isSodaJson ? null : sourceVersion,
  coordinateSystem: `Source coordinates retained: ${upAxis}-up, metres. No rotation, translation or scale applied.`,
  sectionColors: isSodaJson
    ? 'SODA JSON SECTIONGEOMETRY stores colour as 0-255 RGB integers; each row becomes #rrggbb with SectionColor.rgb255ToHex and no channel swap.'
    : 'Follows the bundled SODA reader/display convention, with no channel swap: ReadFromNida.colorToHex(section.color) writes the NIDA decimal -color as #rrggbb into sectionGeometry.extrudeColor (ReadFromNida.js:597-603, 4818); SectionExtrusions.js normalizes that exact extrudeColor for display.',
  memberOrientation: isSodaJson
    ? 'ELEMENT.beta is stored in radians in the SODA JSON model and is passed unchanged to SODA calculateElementBasis.'
    : 'NIDA *MemberOrientation MembAngle values become element.beta in radians; SODA calculateElementBasis applies them to the section local axes.',
  memberOffsets: 'Element endpoints follow the imported node coordinates. This static view uses SODA undeformed member extrusion.',
  sectionOffsets: 'Section shape-loop coordinates (including SODA shape/centroid offsets) are baked by ViewBridgeExtrusionLayout.buildMemberTriangles.',
  conversion: {
    script: 'tools/workflow-embed/prepare-model.mjs',
    parser: parserName,
    geometry: 'SODA ViewBridgeExtrusionLayout.buildMemberTriangles + calculateElementBasis',
    sourceRoot: 'configured by SODA_SOURCE_ROOT at conversion time (not part of this metadata)',
  },
  sourceSummary: {
    nodes: importedSummary.nodes,
    elements: importedSummary.elements,
    sections: importedSummary.sections,
    materials: importedSummary.materials,
    boundaries: importedSummary.boundaries,
    areas: importedSummary.importedAreas,
    areaLoads: importedSummary.importedAreaLoads,
  },
  excluded: {
    areas: importedSummary.importedAreas,
    boundaries: importedSummary.boundaries,
    loads: (importedSummary.importedAreaLoads || 0) + (importedSummary.importedUniformLoads || 0) + (importedSummary.importedPointLoads || 0) + (importedSummary.importedJointLoads || 0),
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
    allMemberMaterialsAssigned: memberMeta.every(item => materialById.has(item.materialId)),
    groupedMemberIdsUniqueAndComplete: groupedMemberIds.length === memberIds.size && new Set(groupedMemberIds).size === memberIds.size,
    displayMaterialMemberCount: displayMaterials.reduce((sum, material) => sum + material.memberCount, 0),
    mixedMaterialSectionIds: sections.filter(section => section.stats.materialIds.length > 1).map(section => section.section.id),
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
  sourceSectionCount: meta.sourceSectionCount, sourceMaterialCount: meta.sourceMaterialCount,
  triangleCount, extrudedMemberCount: meta.extrudedMemberCount, lineFallbackCount: lineFallbackMembers.length,
  edgeSegmentCount: groups.reduce((sum, group) => sum + group.edges.length / 6, 0),
  sourceFile, sourceSha256, displayName: meta.displayName,
  materials: displayMaterials,
  sourceMaterials: usedSourceMaterials,
  sections: sections.map(({ stats }) => ({ id: stats.id, name: stats.name,
    color: stats.colorHex, memberCount: stats.memberCount,
    // SODA's section-visuals.js reads the imported type, never a name heuristic.
    sectionType: stats.sectionType })),
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
