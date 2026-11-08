import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSodaEnvironment } from './soda-environment.js';

/* SODA 3D view renderer.
 *
 * One camera (orthographic or perspective, switched by the projection control)
 * uses SODA's fixed-axis turntable quaternion: source vertical-axis yaw and
 * camera-local-X pitch. A view-plane pan offset keeps the model's projected
 * centre stable while orbiting, including after a pan.
 * Everything is drawn on demand: a change marks the frame dirty and schedules
 * one requestAnimationFrame; there is no continuous loop.
 */

const FIT_PADDING = 1.18;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 12;
const MIN_HALF_HEIGHT = 0.001;
const TAP_MOVE_PIXELS = 5;
const TAP_MAX_MS = 750;
const LINE_PICK_PIXELS = 3;

/* Phong surfaces and three-light illumination match SODA's active view
 * engine. The UI owns the canvas background; WebGL leaves it transparent. */
const ROTATION_MODE = 'zAxis';
const AMBIENT = 0.4;
const KEY_LIGHT = 1.25;
const PERSPECTIVE_FOV = 45;

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/* Compact metadata is the contract; the older verbose keys are accepted so a
 * stale prepare-model output still mounts during integration. */
export function normaliseMetadata(raw) {
  const metadata = raw && typeof raw === 'object' ? raw : {};
  if (!finiteVector(metadata.bounds?.min) || !finiteVector(metadata.bounds?.max)) {
    throw new Error('SODA metadata is missing a valid bounds box.');
  }
  const min = metadata.bounds.min.map(Number);
  const max = metadata.bounds.max.map(Number);
  const center = finiteVector(metadata.center)
    ? metadata.center.map(Number)
    : min.map((value, index) => (value + max[index]) / 2);
  const upAxis = String(metadata.upAxis || 'Z').toUpperCase();
  if (upAxis !== 'Z' && upAxis !== 'Y') throw new Error('SODA metadata must declare a Z-up or Y-up model.');
  const sectionSource = Array.isArray(metadata.sections) ? metadata.sections : [];
  const sections = sectionSource.map((section, index) => ({
    id: section?.id ?? index + 1,
    name: String(section?.name ?? `Section ${index + 1}`),
    color: String(section?.color ?? section?.colorHex ?? '#808080'),
    memberCount: finiteNumber(section?.memberCount),
    sectionType: Number.isInteger(section?.sectionType) ? section.sectionType : null,
  }));
  const materials = (Array.isArray(metadata.materials) ? metadata.materials : []).map((material, index) => ({
    id: material?.id ?? index + 1,
    name: String(material?.name ?? `Material ${index + 1}`),
    memberCount: finiteNumber(material?.memberCount),
    sourceMaterialIds: (Array.isArray(material?.sourceMaterialIds)
      ? material.sourceMaterialIds : []).filter((id) => selectionKey(id) !== null),
  }));
  const sourceMaterials = Array.isArray(metadata.sourceMaterials)
    ? JSON.parse(JSON.stringify(metadata.sourceMaterials)) : [];
  return {
    sourceFile: String(metadata.sourceFile || ''),
    sourceSha256: metadata.sourceSha256 ? String(metadata.sourceSha256) : null,
    displayName: String(metadata.displayName || metadata.sourceFile || ''),
    nodeCount: finiteNumber(metadata.nodeCount ?? metadata.nodes),
    memberCount: finiteNumber(metadata.memberCount ?? metadata.elements),
    sectionCount: finiteNumber(metadata.sectionCount ?? metadata.sections),
    triangleCount: finiteNumber(metadata.triangleCount ?? metadata.triangles),
    sections,
    materials,
    sourceMaterials,
    bounds: { min, max },
    center,
    upAxis,
    units: String(metadata.units || 'm'),
  };
}

const assetCache = new Map();

function assetKey(modelUrl, metadataUrl) {
  return JSON.stringify([modelUrl, metadataUrl]);
}

async function loadGeometry(modelUrl, compressedModelUrl) {
  const compressed = compressedModelUrl && typeof DecompressionStream === 'function';
  const response = await fetch(compressed ? compressedModelUrl : modelUrl, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`SODA geometry failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (compressed && header[0] === 0x1f && header[1] === 0x8b) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return bytes;
}

function loadAssets(modelUrl, metadataUrl, compressedModelUrl) {
  const key = assetKey(modelUrl, metadataUrl);
  if (!assetCache.has(key)) {
    const pending = Promise.all([
      fetch(metadataUrl, { credentials: 'same-origin' }).then(async response => {
        if (!response.ok) throw new Error(`SODA metadata failed (${response.status}).`);
        return normaliseMetadata(await response.json());
      }),
      loadGeometry(modelUrl, compressedModelUrl),
    ]).catch(error => {
      assetCache.delete(key);
      throw error;
    });
    assetCache.set(key, pending);
  }
  return assetCache.get(key);
}

function disposeMaterial(material, textures = new Set()) {
  if (!material) return;
  for (const value of Object.values(material)) {
    if (value && value.isTexture && !textures.has(value)) {
      textures.add(value);
      value.dispose();
    }
  }
  if (typeof material.dispose === 'function') material.dispose();
}

function disposeTree(object) {
  if (!object) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  object.traverse((node) => {
    if (node.geometry && !geometries.has(node.geometry)) {
      geometries.add(node.geometry);
      node.geometry.dispose?.();
    }
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      disposeMaterial(material, textures);
    }
  });
}

function safeError(error) {
  return error instanceof Error ? error : new Error(String(error || 'SODA view failed.'));
}

/* Clamp a normalised quaternion before use so accumulated float drift cannot
 * leave the camera scale skewed after long drags. */
function normalisedQuaternion(quaternion) {
  return quaternion.clone().normalize();
}

function selectionKey(id) {
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return typeof id === 'string' && id.trim() ? id : null;
}

function compareIds(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a), right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/* GLTFLoader keeps node/mesh extras in Object3D.userData. A mesh with several
 * primitives becomes a Group, so its drawable children inherit membership
 * from that group. Never consult a section's default material or the Three
 * material (which represents display colour, not the member's real material).
 */
function groupMembership(node, root) {
  let sectionId = null, materialId = null, memberIds = null;
  for (let owner = node; owner; owner = owner.parent) {
    const data = owner.userData || {};
    if (sectionId === null && selectionKey(data.sectionId) !== null) sectionId = data.sectionId;
    if (materialId === null && selectionKey(data.materialId) !== null) materialId = data.materialId;
    if (memberIds === null && Array.isArray(data.memberIds)) memberIds = data.memberIds;
    if (owner === root) break;
  }
  const members = new Map();
  for (const id of memberIds || []) {
    const key = selectionKey(id);
    if (key !== null) members.set(key, id);
  }
  return { sectionId, materialId, members };
}

/* Lines have no surface to intersect. Test their actual indexed segments in
 * clip/screen space instead of a world-space Raycaster threshold: a constant
 * CSS-pixel tolerance stays small at every depth, zoom, projection and DPR.
 * Clip against all six camera planes before perspective division. */
function hitScreenGeometry(node, viewProjection, point, viewport) {
  const geometry = node.geometry;
  const position = geometry?.attributes.position;
  if (!position) return false;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const matrix = new THREE.Matrix4().multiplyMatrices(viewProjection, node.matrixWorld);
  const a = new THREE.Vector4(), b = new THREE.Vector4();
  const vertex = (i) => index ? index.getX(i) : i;
  const segmentHit = (i, j) => {
    a.set(position.getX(i), position.getY(i), position.getZ(i), 1).applyMatrix4(matrix);
    b.set(position.getX(j), position.getY(j), position.getZ(j), 1).applyMatrix4(matrix);
    let from = 0, to = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      for (let sign = -1; sign <= 1; sign += 2) {
        const start = a.w + sign * a.getComponent(axis);
        const end = b.w + sign * b.getComponent(axis);
        if (start < 0 && end < 0) return false;
        if (start < 0) from = Math.max(from, start / (start - end));
        else if (end < 0) to = Math.min(to, start / (start - end));
        if (from > to) return false;
      }
    }
    const aw = a.w + (b.w - a.w) * from, bw = a.w + (b.w - a.w) * to;
    if (aw <= 0 || bw <= 0) return false;
    const ax = ((a.x + (b.x - a.x) * from) / aw + 1) * viewport.width / 2;
    const ay = (1 - (a.y + (b.y - a.y) * from) / aw) * viewport.height / 2;
    const bx = ((a.x + (b.x - a.x) * to) / bw + 1) * viewport.width / 2;
    const by = (1 - (a.y + (b.y - a.y) * to) / bw) * viewport.height / 2;
    const dx = bx - ax, dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / lengthSq)) : 0;
    return (point.x - ax - t * dx) ** 2 + (point.y - ay - t * dy) ** 2 <= LINE_PICK_PIXELS ** 2;
  };
  const ranges = Array.isArray(node.material)
    ? geometry.groups.filter(group => node.material[group.materialIndex]?.visible)
    : [{ start: 0, count }];
  for (const range of ranges) {
    const start = Math.max(0, geometry.drawRange.start, range.start);
    const end = Math.min(count, geometry.drawRange.start + geometry.drawRange.count, range.start + range.count);
    if (node.isPoints) {
      for (let i = start; i < end; i += 1) if (segmentHit(vertex(i), vertex(i))) return true;
    } else {
      const step = node.isLineSegments ? 2 : 1;
      for (let i = start; i + 1 < end; i += step) if (segmentHit(vertex(i), vertex(i + 1))) return true;
      if (node.isLineLoop && end > start && segmentHit(vertex(end - 1), vertex(start))) return true;
    }
  }
  return false;
}

export function createSodaViewer(canvas, options = {}) {
  const { modelUrl, metadataUrl, compressedModelUrl, onState } = options;
  let destroyed = false;
  let settled = false;
  let status = 'loading';
  let failure = null;
  let metadata = null;
  let center = new THREE.Vector3();
  let bounds = null;
  let counts = { nodeCount: 0, memberCount: 0, sectionCount: 0, triangleCount: 0 };
  let renderer = null;
  let scene = null;
  let camera = null;
  let content = null;
  let frame = null;
  let environment = null;
  let resizeObserver = null;
  let frames = 0;
  let raf = 0;
  let dirty = true;
  let radius = 1;
  let baseFrustum = 1;
  let cameraType = 'orthographic';
  /* Left-drag gesture selected by the mode buttons, mirroring the source's
   * interactionModes (Init.js:531-535): select / pan / rotate. */
  let interactionMode = 'rotate';
  let orthoCamera = null;
  let perspCamera = null;
  let zoom = 1;
  let fitZoom = 1;
  let rotation = new THREE.Quaternion();
  let target = new THREE.Vector3();
  let activePointer = null;
  let gesture = null;
  let selection = null;
  const selectionIndex = { material: new Map(), section: new Map() };
  const selectionDrawables = [];
  const selectionMaterials = new Map();

  let readyResolve;
  let readyReject;
  const listeners = new Set();

  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});

  const pointers = new Map();

  function state() {
    return {
      status,
      error: failure ? failure.message : null,
      quaternion: rotation.toArray(),
      target: target.toArray(),
      zoom,
      frustum: baseFrustum,
      projection: cameraType,
      cameraType: camera?.type || null,
      projectedCenter: frame && camera ? frame.localToWorld(center.clone()).project(camera).toArray() : null,
      interactionMode,
      rotationMode: ROTATION_MODE,
      fitZoom,
      frames,
      renderedFrames: frames,
      counts: { ...counts },
      sourceFile: metadata ? metadata.sourceFile : null,
      displayName: metadata ? metadata.displayName : null,
      sourceSha256: metadata ? metadata.sourceSha256 : null,
      environment: environment ? environment.getState() : null,
      sections: metadata ? metadata.sections.map((section) => ({ ...section })) : [],
      materials: materialSnapshot(),
      sourceMaterials: sourceMaterialsSnapshot(),
      selection: selectionSnapshot(),
      bounds: bounds ? { min: bounds.min.slice(), max: bounds.max.slice() } : null,
      center: [center.x, center.y, center.z],
      /* Axis basis for the gizmo: view rotation (inverse of the actual camera
       * quaternion) composed with the source Z-up -> display rotation, so the
       * triad shows the MODEL's axes, not the orbit quaternion. */
      axisBasis: axisBasis(),
      canvas: canvas ? {
        width: canvas.width, height: canvas.height,
        clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
      } : null,
    };
  }

  /* Quaternion that takes a source-space axis into view space: the camera's
   * own orientation inverse, then the source-axis transform. Reading the live
   * camera (not the orbit quaternion) keeps the gizmo right after any pan or
   * projection change. */
  function axisBasis() {
    const view = new THREE.Quaternion();
    if (camera) camera.getWorldQuaternion(view);
    return view.invert().multiply(SOURCE_TO_DISPLAY).normalize().toArray();
  }

  function publish() {
    if (typeof onState === 'function') onState(state());
  }

  function settleError(value) {
    failure = safeError(value);
    status = 'error';
    publish();
    if (!settled) {
      settled = true;
      readyReject(failure);
    }
  }

  function settleReady() {
    if (settled) return;
    settled = true;
    status = 'ready';
    publish();
    readyResolve(state());
  }

  /* Subscribers hear about every committed frame, so UI overlays that mirror
   * the camera never need a polling loop. */
  function notify() {
    if (!listeners.size) return;
    const snapshot = state();
    for (const listener of listeners) {
      try { listener(snapshot); } catch (_) { /* a broken listener must not stop drawing */ }
    }
  }

  function draw() {
    if (destroyed || !renderer || !scene || !camera) return;
    try {
      environment?.update(camera, Boolean(selection));
      renderer.render(scene, camera);
      frames += 1;
      notify();
    } catch (drawError) {
      settleError(drawError);
    }
  }

  /* Coalesce any number of changes into a single frame. The pending flag is
   * held separately from the handle so a synchronously-invoked callback (tests,
   * or a browser that runs the frame early) cannot strand the queue. */
  let framePending = false;
  function invalidate() {
    dirty = true;
    if (destroyed || framePending) return;
    framePending = true;
    raf = requestAnimationFrame(() => {
      raf = 0;
      framePending = false;
      if (destroyed || !dirty) return;
      dirty = false;
      draw();
    });
  }

  /* Distance from the target to a box corner, used to keep clipping planes
   * and light placement stable while orbiting. */
  function cornerDistance() {
    if (!bounds) return radius;
    let max = 0;
    for (const x of [bounds.min[0], bounds.max[0]]) {
      for (const y of [bounds.min[1], bounds.max[1]]) {
        for (const z of [bounds.min[2], bounds.max[2]]) {
          max = Math.max(max, Math.hypot(x - center.x, y - center.y, z - center.z));
        }
      }
    }
    return Math.max(max, MIN_HALF_HEIGHT);
  }

  /* Rx(-pi/2): source (x,y,z) -> display (x,z,-y). In particular source Z
   * becomes display +Y, the yaw axis for Z-Axis mode. Initialise after metadata
   * loads so an explicitly Y-up asset uses the identity mapping. */
  const SOURCE_TO_DISPLAY = new THREE.Quaternion();
  /* Source-space vertical axis: Z for NIDA-style models, Y for SODA JSON. */
  const sourceUp = new THREE.Vector3(0, 0, 1);

  /* Display-space centre of the model. The metadata centre is a SOURCE-space
   * point, so it must be rotated before it is used to offset the display frame;
   * using it raw shifts a Z-up model by (cx, cy, cz) after the -90 deg X turn. */
  function displayCentre() {
    return new THREE.Vector3(center.x, center.y, center.z).applyQuaternion(SOURCE_TO_DISPLAY);
  }

  /* Orbit position and orientation. Both cameras share the same orbit maths, so
   * orbiting behaves identically in either projection. */
  function placeCamera(cam) {
    /* Perspective sits at the fitted distance; orthographic only needs to be
     * outside the box because its frustum carries the size. */
    const boxRadius = Math.max(radius, MIN_HALF_HEIGHT) * 4;
    const distance = cam.isPerspectiveCamera ? (cam.distanceScale || boxRadius) : boxRadius;
    cam.position.set(0, 0, 1).applyQuaternion(rotation).multiplyScalar(distance);
    cam.up.set(0, 1, 0).applyQuaternion(rotation);
    /* Source orbit_controls.js:449-451 copies q directly. Do not rebuild a
     * world-up lookAt here: pitch may pass through either pole or go inverted. */
    cam.quaternion.copy(rotation);
    cam.updateMatrixWorld();
  }

  function applyCamera() {
    if (!camera) return;
    placeCamera(camera);
    if (orthoCamera) placeCamera(orthoCamera);
    if (perspCamera) placeCamera(perspCamera);
    /* The centring parent carries the display-space centre, so the orbit
     * always happens about the world origin, i.e. the model's own centre. The
     * pan offset follows the camera plane so orbiting never moves the model's
     * projected centre, including after a pan gesture. */
    if (content) content.position.copy(target).applyQuaternion(rotation);
    invalidate();
  }

  /* Project every box corner (source space -> display space, about the model
   * centre) onto the camera's right/up axes and fit the largest requirement;
   * the same corner projection SODA's fitToScreen uses (Init.js:900-1010). */
  function fitFrustum() {
    if (!camera || !bounds) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    let maxX = 0;
    let maxY = 0;
    for (const x of [bounds.min[0], bounds.max[0]]) {
      for (const y of [bounds.min[1], bounds.max[1]]) {
        for (const z of [bounds.min[2], bounds.max[2]]) {
          const local = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(SOURCE_TO_DISPLAY);
          maxX = Math.max(maxX, Math.abs(local.dot(right)));
          maxY = Math.max(maxY, Math.abs(local.dot(up)));
        }
      }
    }
    const aspect = orthoAspect();
    baseFrustum = Math.max(maxY * 2, (maxX * 2) / aspect, MIN_HALF_HEIGHT) * FIT_PADDING;
  }

  function orthoAspect() {
    const width = Math.max(canvas?.clientWidth || 1, 1);
    const height = Math.max(canvas?.clientHeight || 1, 1);
    return width / height;
  }

  /* Orthographic frustum and perspective distance are both driven by zoom, so
   * the wheel and pinch feel the same in either projection. */
  function applyFrustum() {
    if (!camera) return;
    const aspect = orthoAspect();
    if (orthoCamera) {
      const halfHeight = (baseFrustum / 2) / zoom;
      orthoCamera.top = halfHeight;
      orthoCamera.bottom = -halfHeight;
      orthoCamera.left = -halfHeight * aspect;
      orthoCamera.right = halfHeight * aspect;
      const depth = radius * 6;
      orthoCamera.near = -depth;
      orthoCamera.far = depth;
      orthoCamera.updateProjectionMatrix();
    }
    if (perspCamera) {
      /* Distance chosen so the visible height at the target equals the same
       * baseFrustum the orthographic camera frames, divided by zoom. */
      const halfFov = (PERSPECTIVE_FOV * Math.PI) / 180 / 2;
      const visibleHalf = (baseFrustum / 2) / zoom;
      perspCamera.fov = PERSPECTIVE_FOV;
      perspCamera.aspect = aspect;
      perspCamera.near = Math.max(radius * 0.01, 0.01);
      perspCamera.far = Math.max(radius * 100, 1000);
      perspCamera.distanceScale = visibleHalf / Math.tan(halfFov);
      perspCamera.updateProjectionMatrix();
    }
    if (camera) placeCamera(camera);
    invalidate();
  }

  function resetView() {
    invalidateTaps();
    /* SODA's positive XYZ isometric, mapped from the source frame to Y-up. */
    const direction = new THREE.Vector3(1, 1, 1).applyQuaternion(SOURCE_TO_DISPLAY);
    const up = sourceUp.clone().applyQuaternion(SOURCE_TO_DISPLAY);
    rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), up)).normalize();
    target.set(0, 0, 0);
    zoom = 1;
    fitFrustum();
    applyFrustum();
    applyCamera();
  }

  function fitView() {
    invalidateTaps();
    zoom = 1;
    target.set(0, 0, 0);
    fitFrustum();
    applyFrustum();
    applyCamera();
  }

  function zoomBy(factor) {
    invalidateTaps();
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    fitZoom = zoom;
    applyFrustum();
    invalidate();
  }

  function resize() {
    invalidateTaps();
    if (!renderer || !camera || !canvas) return;
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    fitFrustum();
    applyFrustum();
    invalidate();
  }

  /* --- pointer interaction -------------------------------------------------
   * A single pointer orbits (drag) or pans (shift / middle / right button).
   * Two pointers pinch-zoom and pan by their midpoint. Pointer up, cancel and
   * lost capture all funnel through endGesture so nothing is left behind.
   */
  function invalidateTaps() {
    for (const pointer of pointers.values()) pointer.tap = false;
  }

  function modified(event) {
    return event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
  }

  function trackTap(pointer, event) {
    const samples = event.getCoalescedEvents?.() || [];
    const track = (sample) => {
      pointer.travel += Math.hypot(sample.clientX - pointer.lastX, sample.clientY - pointer.lastY);
      pointer.lastX = sample.clientX;
      pointer.lastY = sample.clientY;
      if (pointer.travel > TAP_MOVE_PIXELS || modified(sample) || sample.isPrimary === false ||
          (Number.isFinite(sample.timeStamp) && sample.timeStamp < pointer.downTime)) pointer.tap = false;
    };
    for (const sample of samples) track(sample);
    track(event);
    if (modified(event) || (event.type === 'pointermove' && event.buttons !== 1)) pointer.tap = false;
  }

  function releasePointer(id) {
    try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (_) { /* already released */ }
  }

  function abortPointers() {
    const ids = [...pointers.keys()];
    /* Clear first: releasePointerCapture may deliver lostpointercapture. */
    pointers.clear();
    activePointer = null;
    gesture = null;
    canvas?.classList?.remove?.('is-dragging', 'is-panning', 'is-pinching');
    for (const id of ids) releasePointer(id);
  }

  function hitsModel(event) {
    const viewport = canvas.getBoundingClientRect();
    if (!(viewport.width > 0 && viewport.height > 0) ||
        event.clientX < viewport.left || event.clientX >= viewport.right ||
        event.clientY < viewport.top || event.clientY >= viewport.bottom) return null;
    /* Capture retargets pointerup even when the pointer is outside or over UI. */
    if (document.elementFromPoint && document.elementFromPoint(event.clientX, event.clientY) !== canvas) return null;
    const point = new THREE.Vector2(event.clientX - viewport.left, event.clientY - viewport.top);
    const ndc = new THREE.Vector2(point.x / viewport.width * 2 - 1, 1 - point.y / viewport.height * 2);
    // A pending demand frame must not leave picking at the previous pan/orbit.
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const raycaster = new THREE.Raycaster();
    raycaster.layers.mask = camera.layers.mask;
    raycaster.setFromCamera(ndc, camera);
    const intersections = [];
    for (const { node } of selectionDrawables) {
      let visible = true;
      for (let owner = node; owner; owner = owner.parent) if (!owner.visible) { visible = false; break; }
      if (!visible || !camera.layers.test(node.layers)) continue;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (!materials.some(material => material?.visible)) continue;
      if (node.isMesh) {
        intersections.length = 0;
        raycaster.intersectObject(node, false, intersections);
        for (const hit of intersections) {
          const material = Array.isArray(node.material) ? node.material[hit.face?.materialIndex] : node.material;
          const clip = hit.point.clone().project(camera);
          if (material?.visible && clip.z >= -1 && clip.z <= 1) return true;
        }
      } else if ((node.isLine || node.isPoints) && hitScreenGeometry(node, viewProjection, point, viewport)) return true;
    }
    return false;
  }

  function pointersList() {
    return [...pointers.values()];
  }

  function beginGesture() {
    const list = pointersList();
    if (list.length >= 2) {
      const [a, b] = list;
      gesture = {
        mode: 'pinch',
        distance: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        zoom,
      };
      canvas.classList?.add?.('is-pinching');
      canvas.classList?.remove?.('is-dragging');
      return;
    }
    const pointer = list[0];
    if (!pointer) { gesture = null; return; }
    gesture = {
      mode: pointer.select ? 'select' : pointer.pan ? 'pan' : 'orbit',
      x: pointer.x,
      y: pointer.y,
      target: target.clone(),
    };
    if (!pointer.select) canvas.classList?.add?.(pointer.pan ? 'is-panning' : 'is-dragging');
    canvas.classList?.remove?.('is-pinching');
  }

  function panByPixels(dx, dy) {
    if (!camera) return;
    const height = Math.max(canvas.clientHeight, 1);
    const worldPerPixel = (baseFrustum / zoom) / height;
    target.x += dx * worldPerPixel;
    target.y -= dy * worldPerPixel;
    applyCamera();
  }

  function onPointerDown(event) {
    if (destroyed || !camera || document.hidden) return;
    const alone = pointers.size === 0;
    // Once another pointer appears, no remaining finger can turn into a tap.
    invalidateTaps();
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    /* Select still tracks the lifecycle for taps, but its left-drag is inert. */
    const forcedPan = event.button === 1 || event.button === 2 || event.shiftKey;
    const pan = forcedPan || interactionMode === 'pan';
    pointers.set(event.pointerId, {
      x: event.clientX, y: event.clientY, pan,
      select: !forcedPan && interactionMode === 'select',
      lastX: event.clientX, lastY: event.clientY, travel: 0,
      startedAt: performance.now(), downTime: Number.isFinite(event.timeStamp) ? event.timeStamp : 0,
      selectionAtDown: selection,
      tap: alone && (event.pointerType === 'mouse' || event.pointerType === 'touch') &&
        event.isPrimary !== false && event.button === 0 && event.buttons === 1 && !modified(event),
    });
    activePointer = event.pointerId;
    if (event.preventDefault) event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* capture is best effort */ }
    beginGesture();
  }

  function onPointerMove(event) {
    if (destroyed || !gesture) return;
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    trackTap(pointer, event);
    if (event.pointerType === 'mouse' && event.buttons === 0) { endGesture(event); return; }
    if (event.preventDefault) event.preventDefault();
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (gesture.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = pointersList();
      const distance = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const ratio = distance / gesture.distance;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.zoom * ratio));
      fitZoom = zoom;
      applyFrustum();
      panByPixels(midX - gesture.midX, midY - gesture.midY);
      gesture.distance = distance;
      gesture.zoom = zoom;
      gesture.midX = midX;
      gesture.midY = midY;
      return;
    }

    if (gesture.mode === 'select') return;
    const dx = pointer.x - gesture.x;
    const dy = pointer.y - gesture.y;
    gesture.x = pointer.x;
    gesture.y = pointer.y;
    if (!dx && !dy) return;

    if (gesture.mode === 'pan') {
      panByPixels(dx, dy);
      return;
    }
    /* SODA web/lib/orbit_controls.js:256-319, orbitMode 'Z':
     * q' = R(sourceZ, -2*pi*dx/H) * q * R(localX, -2*pi*dy/H).
     * BOTH axes use clientHeight (rotateSpeed=1); yaw is world/source-axis,
     * pitch is local AFTER yaw. There is no pitch clamp, pole flip or roll
     * removal in the original, so quaternion composition remains continuous.
     * q here is display-space: sourceZ must first pass through Rx(-pi/2). */
    const height = Math.max(canvas.clientHeight, 1);
    const yaw = (-dx / height) * Math.PI * 2;
    const pitch = (-dy / height) * Math.PI * 2;
    const orbitUp = sourceUp.clone().applyQuaternion(SOURCE_TO_DISPLAY);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(orbitUp, yaw);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    rotation = normalisedQuaternion(yawQ.multiply(rotation).multiply(pitchQ));
    applyCamera();
  }

  function endGesture(event) {
    if (destroyed) return;
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    trackTap(pointer, event);
    const elapsed = Math.max(performance.now() - pointer.startedAt,
      Number.isFinite(event.timeStamp) ? event.timeStamp - pointer.downTime : 0);
    const tap = event.type === 'pointerup' && pointer.tap && pointers.size === 1 &&
      event.button === 0 && event.buttons === 0 && event.isPrimary !== false &&
      elapsed >= 0 && elapsed <= TAP_MAX_MS && !document.hidden;
    pointers.delete(event.pointerId);
    if (event.preventDefault) event.preventDefault();
    releasePointer(event.pointerId);
    if (pointers.size > 0) {
      activePointer = pointers.keys().next().value;
      beginGesture();
      return;
    }
    activePointer = null;
    gesture = null;
    canvas.classList?.remove?.('is-dragging', 'is-panning', 'is-pinching');
    if (tap && selection && selection === pointer.selectionAtDown && hitsModel(event) === false) clearSelection();
    invalidate();
  }

  function onWheel(event) {
    if (destroyed || !camera) return;
    event.preventDefault();
    const step = event.deltaMode === 1 ? 0.05 : 0.0015;
    const factor = Math.exp(-event.deltaY * step);
    zoomBy(factor);
    fitZoom = zoom;
  }

  function onContextMenu(event) {
    invalidateTaps();
    /* Right-drag is a pan gesture; suppress the menu so it does not interrupt. */
    event.preventDefault();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      abortPointers();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      /* The cancelled frame will never run, so the pending flag must be cleared
       * here or every later invalidate() would be dropped for good. */
      framePending = false;
      dirty = true;
      return;
    }
    invalidate();
  }

  function materialSnapshot() {
    return metadata ? metadata.materials.map((material) => ({
      ...material, sourceMaterialIds: material.sourceMaterialIds.slice(),
    })) : [];
  }

  function sourceMaterialsSnapshot() {
    return metadata ? JSON.parse(JSON.stringify(metadata.sourceMaterials)) : [];
  }

  function selectionSnapshot() {
    return selection ? {
      ...selection,
      memberIds: selection.memberIds.slice(),
      sectionIds: selection.sectionIds.slice(),
    } : null;
  }

  function indexSelection(kind, id, membership, node) {
    const key = selectionKey(id);
    if (key === null || !membership.members.size) return;
    let entry = selectionIndex[kind].get(key);
    if (!entry) {
      entry = { id, members: new Map(), sections: new Map(), nodes: new Set() };
      selectionIndex[kind].set(key, entry);
    }
    for (const [memberKey, memberId] of membership.members) entry.members.set(memberKey, memberId);
    const sectionKey = selectionKey(membership.sectionId);
    if (sectionKey !== null) entry.sections.set(sectionKey, membership.sectionId);
    entry.nodes.add(node);
  }

  function indexGeometry(root) {
    /* UI groups may combine several real source materials (S355, its copy and
     * Rigid). Membership stays on the GLB's actual materialId; metadata only
     * declares which source IDs a UI choice covers, never its selected count. */
    const materialGroups = new Map();
    for (const material of metadata.materials) {
      for (const id of material.sourceMaterialIds) {
        const key = selectionKey(id);
        if (!materialGroups.has(key)) materialGroups.set(key, []);
        materialGroups.get(key).push(material.id);
      }
    }
    root.traverse((node) => {
      if (!(node.isMesh || node.isLine || node.isPoints) || !node.material) return;
      selectionDrawables.push({ node, material: node.material, renderOrder: node.renderOrder });
      const membership = groupMembership(node, root);
      for (const id of materialGroups.get(selectionKey(membership.materialId)) || []) {
        indexSelection('material', id, membership, node);
      }
      indexSelection('section', membership.sectionId, membership, node);
    });
    for (const index of Object.values(selectionIndex)) {
      for (const entry of index.values()) {
        /* Surface, outline and line-only roles may repeat the same IDs. Count
         * their union once, and retain the actual source IDs in the public API. */
        entry.memberIds = [...entry.members.values()].sort(compareIds);
        entry.sectionIds = [...entry.sections.values()].sort(compareIds);
        delete entry.members;
        delete entry.sections;
      }
    }
  }

  function selectionMaterial(original, selected) {
    let variants = selectionMaterials.get(original);
    if (!variants) {
      variants = new Map();
      selectionMaterials.set(original, variants);
    }
    if (!variants.has(selected)) {
      const material = original.clone();
      material.color?.set(selected ? 0xff990f : 0x718396);
      material.emissive?.set(selected ? 0x542000 : 0x000000);
      material.specular?.set(selected ? 0x5b2c05 : 0x000000);
      if ('emissiveIntensity' in material) material.emissiveIntensity = 1;
      material.vertexColors = false;
      if ('map' in material) material.map = null;
      if ('emissiveMap' in material) material.emissiveMap = null;
      if ('alphaMap' in material) material.alphaMap = null;
      material.opacity = selected ? 1 : Math.min(original.opacity, original.isLineBasicMaterial ? 0.28 : 0.16);
      /* Put both styles in the transparent pass. Context does not write depth;
       * selected faces then selected edges draw last, remaining clear even
       * behind the ghosted structure while retaining their own depth tests. */
      material.transparent = true;
      material.depthWrite = selected;
      material.needsUpdate = true;
      variants.set(selected, material);
    }
    return variants.get(selected);
  }

  function restoreSelectionMaterials() {
    for (const { node, material, renderOrder } of selectionDrawables) {
      node.material = material;
      node.renderOrder = renderOrder;
    }
  }

  function selectGeometry(kind, id) {
    if (destroyed || status !== 'ready') return selectionSnapshot();
    const entry = selectionIndex[kind].get(selectionKey(id));
    if (!entry) return selectionSnapshot();
    if (selection?.kind === kind && selectionKey(selection.id) === selectionKey(entry.id)) return selectionSnapshot();
    selection = {
      kind, id: entry.id, memberCount: entry.memberIds.length,
      memberIds: entry.memberIds, sectionIds: entry.sectionIds,
    };
    for (const { node, material } of selectionDrawables) {
      const selected = entry.nodes.has(node);
      const style = (original) => selectionMaterial(original, selected);
      node.material = Array.isArray(material) ? material.map(style) : style(material);
      node.renderOrder = selected ? (node.isLine ? 2 : 1) : 0;
    }
    publish();
    invalidate();
    return selectionSnapshot();
  }

  function clearSelection() {
    if (destroyed || !selection) return selectionSnapshot();
    restoreSelectionMaterials();
    selection = null;
    publish();
    invalidate();
    return null;
  }

  function releaseSelection() {
    restoreSelectionMaterials();
    /* Clones borrow textures from the originals. Dispose their GPU material
     * state only; disposeTree owns the originals and their shared textures. */
    for (const variants of selectionMaterials.values()) {
      for (const material of variants.values()) material.dispose();
    }
    selectionMaterials.clear();
    selectionDrawables.length = 0;
    selectionIndex.material.clear();
    selectionIndex.section.clear();
    selection = null;
  }

  function buildScene(gltf) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    scene = new THREE.Scene();
    scene.background = null;

    /* Both cameras orbit the same target; the projection control swaps which
     * one renders, exactly like the source's cameraType switch. */
    orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -radius * 6, radius * 6);
    perspCamera = new THREE.PerspectiveCamera(PERSPECTIVE_FOV, 1, Math.max(radius * 0.01, 0.01),
      Math.max(radius * 100, 1000));
    camera = orthoCamera;

    /* Centring parent: rotates source Z-up into the display frame, then offsets
     * by the ROTATED centre so the model's centre lands on the world origin. */
    content = new THREE.Group();
    const centred = displayCentre();
    content.position.set(0, 0, 0);
    frame = new THREE.Group();
    frame.quaternion.copy(SOURCE_TO_DISPLAY);
    frame.position.copy(centred).multiplyScalar(-1);

    const modelRoot = gltf.scene;
    const sectionMaterials = new Map();
    modelRoot.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = false;
      const swap = (material) => {
        if (!sectionMaterials.has(material)) {
          sectionMaterials.set(material, new THREE.MeshPhongMaterial({
            color: material.color ? material.color.clone() : new THREE.Color(0x8899aa),
            specular: 0x444444,
            shininess: 40,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 2,
            polygonOffsetUnits: 2,
          }));
        }
        return sectionMaterials.get(material);
      };
      node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
    });
    sectionMaterials.forEach((_, original) => disposeMaterial(original));
    modelRoot.position.set(0, 0, 0);

    frame.add(modelRoot);
    content.add(frame);
    scene.add(content);
    indexGeometry(modelRoot);

    /* The key and opposite fill retain their source-space direction as the
     * camera orbits; panning translates the lights with the geometry. */
    const ambient = new THREE.AmbientLight(0xffffff, AMBIENT);
    const key = new THREE.DirectionalLight(0xffffff, KEY_LIGHT);
    key.position.set(0, 0, radius * 4).applyQuaternion(SOURCE_TO_DISPLAY);
    key.target.position.set(0, 0, 0);
    const fill = new THREE.DirectionalLight(0xffffff, KEY_LIGHT * 0.2);
    fill.position.copy(key.position).multiplyScalar(-1);
    content.add(ambient, key, key.target, fill, fill.target);

    environment = createSodaEnvironment({
      bounds, upAxis: metadata.upAxis, maxShadowSize: renderer.capabilities.maxTextureSize,
    });
    frame.add(environment.group);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    resize();
    resetView();
    draw();
    if (!destroyed) settleReady();
  }

  /* Interaction mode: 'select' leaves left-drag inert, 'pan' pans, 'rotate'
   * orbits. The cursor class follows the active mode for feedback. */
  function setInteractionMode(mode) {
    invalidateTaps();
    interactionMode = mode === 'pan' ? 'pan' : mode === 'select' ? 'select' : 'rotate';
    if (canvas) {
      /* dataset/classList are optional so a non-DOM canvas stand-in still works. */
      if (canvas.dataset) canvas.dataset.sodaMode = interactionMode;
      canvas.classList?.toggle?.('is-mode-pan', interactionMode === 'pan');
      canvas.classList?.toggle?.('is-mode-select', interactionMode === 'select');
    }
    publish();
    return interactionMode;
  }

  /* Real projection change: swap the active camera and refit, preserving the
   * apparent size so the model does not jump. */
  function setProjection(type) {
    invalidateTaps();
    const next = type === 'perspective' ? 'perspective' : 'orthographic';
    if (!orthoCamera || !perspCamera) { cameraType = next; return cameraType; }
    cameraType = next;
    camera = next === 'perspective' ? perspCamera : orthoCamera;
    applyFrustum();
    publish();
    return cameraType;
  }

  async function start() {
    try {
      if (!modelUrl || !metadataUrl) throw new Error('SODA model and metadata URLs are required.');
      const assets = await loadAssets(modelUrl, metadataUrl, compressedModelUrl);
      if (destroyed) return;
      metadata = assets[0];
      SOURCE_TO_DISPLAY.setFromAxisAngle(new THREE.Vector3(1, 0, 0), metadata.upAxis === 'Y' ? 0 : -Math.PI / 2);
      sourceUp.set(0, metadata.upAxis === 'Y' ? 1 : 0, metadata.upAxis === 'Y' ? 0 : 1);
      bounds = { min: metadata.bounds.min.slice(), max: metadata.bounds.max.slice() };
      center = new THREE.Vector3(...metadata.center);
      counts = {
        nodeCount: metadata.nodeCount,
        memberCount: metadata.memberCount,
        sectionCount: metadata.sectionCount,
        triangleCount: metadata.triangleCount,
      };
      const [dx, dy, dz] = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
      radius = Math.max(Math.hypot(dx, dy, dz) / 2, 1e-3);

      const gltf = await new GLTFLoader().parseAsync(assets[1], new URL('.', modelUrl).href);
      if (destroyed) { disposeTree(gltf.scene); return; }
      buildScene(gltf);
    } catch (loadError) {
      assetCache.delete(assetKey(modelUrl, metadataUrl));
      if (destroyed) return;
      settleError(loadError);
    }
  }

  if (canvas) {
    setInteractionMode(interactionMode);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endGesture);
    canvas.addEventListener('pointercancel', endGesture);
    canvas.addEventListener('lostpointercapture', endGesture);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', abortPointers);
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
  }
  start();

  return {
    ready,
    getState: () => state(),
    /* Test and UI hooks. */
    get quaternion() { return rotation.toArray(); },
    get target() { return target.toArray(); },
    get zoom() { return zoom; },
    get frames() { return frames; },
    get counts() { return { ...counts }; },
    get sections() { return metadata ? metadata.sections.map((section) => ({ ...section })) : []; },
    get materials() { return materialSnapshot(); },
    get sourceMaterials() { return sourceMaterialsSnapshot(); },
    get selection() { return selectionSnapshot(); },
    selectMaterial: (id) => selectGeometry('material', id),
    selectSection: (id) => selectGeometry('section', id),
    clearSelection,
    get projection() { return cameraType; },
    get interactionMode() { return interactionMode; },
    get rotationMode() { return ROTATION_MODE; },
    setInteractionMode,
    get axisBasis() { return axisBasis(); },
    setProjection,
    get metadata() { return metadata; },
    restoreView(view) {
      rotation = normalisedQuaternion(new THREE.Quaternion(...view.quaternion));
      target.fromArray(view.target);
      zoom = view.zoom;
      setProjection(view.projection);
      baseFrustum = view.frustum;
      applyFrustum();
      applyCamera();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new Error('subscribe expects a function.');
      listeners.add(listener);
      if (status === 'ready') listener(state());
      return () => listeners.delete(listener);
    },
    setQuaternion(values) {
      if (!Array.isArray(values) || values.length !== 4 || !values.every((v) => Number.isFinite(v))) {
        throw new Error('setQuaternion expects four finite numbers.');
      }
      invalidateTaps();
      rotation = normalisedQuaternion(new THREE.Quaternion(values[0], values[1], values[2], values[3]));
      applyCamera();
      return rotation.toArray();
    },
    setTarget(values) {
      if (!Array.isArray(values) || values.length !== 3 || !values.every((v) => Number.isFinite(v))) {
        throw new Error('setTarget expects three finite numbers.');
      }
      invalidateTaps();
      target.set(values[0], values[1], values[2]);
      applyCamera();
      return target.toArray();
    },
    setZoom(value) {
      if (!Number.isFinite(value) || value <= 0) throw new Error('setZoom expects a positive number.');
      zoomBy(value / zoom);
      return zoom;
    },
    zoomBy,
    panByPixels,
    fit: fitView,
    resetView,
    isInteracting: () => gesture !== null,
    get activePointer() { return activePointer; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      status = 'destroyed';

      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      framePending = false;
      if (canvas) {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', endGesture);
        canvas.removeEventListener('pointercancel', endGesture);
        canvas.removeEventListener('lostpointercapture', endGesture);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        canvas.classList?.remove?.('is-dragging', 'is-panning', 'is-pinching');
      }
      abortPointers();
      listeners.clear();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', abortPointers);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      releaseSelection();
      environment?.dispose();
      environment = null;
      if (scene) disposeTree(scene);
      scene?.clear();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss?.();
      }
      scene = null;
      camera = null;
      content = null;
      frame = null;
      renderer = null;
      if (!settled) {
        settled = true;
        readyReject(new Error('SODA view was destroyed before it became ready.'));
      }
      publish();
    },
  };
}
