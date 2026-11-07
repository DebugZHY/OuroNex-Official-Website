import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const modelUrl = new URL('../../SIDA-Logo-3D/建造者机器人立体图标.glb', document.currentScript.src).href;
const diagnostics = new WeakMap();
const SWAY = 14 * Math.PI / 180;
const PITCH_LIMIT = Math.PI / 4;

function mount(canvas, size, onReady) {
  let disposed = false;
  let frame = 0;
  let lastTick = null;
  let idleTime = 0;
  let idleYaw = 0;
  let drawCount = 0;
  let notified = false;
  let renderer;
  let environmentMap;
  let root;
  let pivot;
  let observer;
  let drag = null;
  let pointerType = 'mouse';
  let hovered = canvas.matches(':hover') && window.matchMedia('(any-hover: hover)').matches;
  let visible = !('IntersectionObserver' in window);
  let draw = () => {};
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const originalCursor = canvas.style.cursor;
  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; lastTick = null; };
  const canDraw = () => !disposed && visible && !document.hidden;
  const canSway = () => canDraw() && pivot && !hovered && !drag && !media.matches;
  const spin = (now) => {
    frame = 0;
    if (!canSway()) { lastTick = null; return; }
    // Advance only while active: hidden time and hover time never become a pose jump.
    if (lastTick !== null) idleTime += Math.min(Math.max(now - lastTick, 0), 64);
    lastTick = now;
    pivot.rotation.y = idleYaw + Math.sin(idleTime / 7000 * Math.PI * 2) * SWAY;
    draw();
    syncMotion();
  };
  const syncMotion = () => {
    if (!canSway()) stop();
    else if (!frame) frame = requestAnimationFrame(spin);
  };
  const inside = (event) => {
    const rect = canvas.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  const userRotation = (yaw, pitch) => {
    if (!pivot) return;
    stop();
    pivot.rotation.set(Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)), yaw, 0, 'YXZ');
    // Idle sway will start at this exact user pose, never at the original orientation.
    idleYaw = pivot.rotation.y;
    idleTime = 0;
    draw();
  };
  const releaseDrag = () => {
    const previous = drag;
    drag = null;
    canvas.style.cursor = originalCursor;
    if (previous) {
      try {
        if (canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
      } catch (_) { /* The pointer or canvas may already have left the document. */ }
    }
  };
  const moveDrag = (event) => {
    const rect = canvas.getBoundingClientRect();
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    hovered = pointerType !== 'touch' && inside(event);
    if (dx || dy) userRotation(pivot.rotation.y + dx / Math.max(rect.width, 1) * Math.PI,
      pivot.rotation.x + dy / Math.max(rect.height, 1) * Math.PI / 2);
  };
  const onEnter = (event) => {
    if (event.pointerType === 'touch' || (drag && drag.id !== event.pointerId)) return;
    pointerType = event.pointerType;
    hovered = true;
    syncMotion();
  };
  const onLeave = (event) => {
    if (event.pointerType === 'touch' || (drag && drag.id !== event.pointerId)) return;
    hovered = false;
    syncMotion();
  };
  const onDown = (event) => {
    if (!pivot || !canDraw() || drag || event.isPrimary === false || event.button !== 0) return;
    event.preventDefault();
    stop();
    pointerType = event.pointerType;
    hovered = pointerType !== 'touch' && inside(event);
    idleYaw = pivot.rotation.y;
    idleTime = 0;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    } catch (_) { releaseDrag(); syncMotion(); }
  };
  const onMove = (event) => {
    if (drag) {
      if (drag.id === event.pointerId) moveDrag(event);
    } else if (event.pointerType !== 'touch') {
      pointerType = event.pointerType;
      hovered = inside(event);
      syncMotion();
    }
  };
  const onUp = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    moveDrag(event);
    releaseDrag();
    syncMotion();
  };
  const onCancel = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    // Cancellation/lost capture preserves the last rendered pose; no inertia or reset.
    releaseDrag();
    syncMotion();
  };
  const onKey = (event) => {
    if (!pivot || !canDraw() || drag || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = 5 * Math.PI / 180;
    const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    userRotation(pivot.rotation.y + delta[0], pivot.rotation.x + delta[1]);
    syncMotion();
  };
  const refreshVisibility = () => {
    if (disposed) return;
    if (!canDraw()) {
      stop();
      releaseDrag();
      hovered = false;
    } else {
      // A touch's sticky CSS :hover must never keep automatic motion paused after release.
      hovered = pointerType !== 'touch' && canvas.matches(':hover');
      draw();
      syncMotion();
    }
  };
  const onResize = () => {
    if (!renderer || disposed) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    draw();
  };
  const disposeModel = () => {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root?.traverse((node) => {
      if (!node.isMesh) return;
      if (node.geometry) geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!material) continue;
        materials.add(material);
        Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
      }
    });
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
    root?.removeFromParent();
    root = null;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    listeners.forEach(remove => remove());
    observer?.disconnect();
    releaseDrag();
    disposeModel();
    environmentMap?.dispose();
    environmentMap = null;
    renderer?.dispose();
    renderer = null;
    diagnostics.delete(canvas);
  };

  // Diagnostics read the real pivot, scheduler and render calls; no separate UI pose exists.
  diagnostics.set(canvas, () => Object.freeze({
    loaded: Boolean(pivot && renderer), ready: notified, hovered, dragging: Boolean(drag),
    pointerId: drag?.id ?? null, visible, hidden: document.hidden, reducedMotion: media.matches,
    autoAnimating: Boolean(frame), drawCount,
    rotation: pivot ? Object.freeze({ x: pivot.rotation.x, y: pivot.rotation.y, z: pivot.rotation.z, order: pivot.rotation.order }) : null,
    center: pivot ? Object.freeze(pivot.position.toArray()) : null,
  }));
  listen(canvas, 'pointerenter', onEnter);
  listen(canvas, 'pointerleave', onLeave);
  listen(canvas, 'pointerdown', onDown);
  listen(canvas, 'pointermove', onMove);
  listen(canvas, 'pointerup', onUp);
  listen(canvas, 'pointercancel', onCancel);
  listen(canvas, 'lostpointercapture', onCancel);
  listen(canvas, 'keydown', onKey);
  listen(window, 'resize', onResize);
  listen(document, 'visibilitychange', refreshVisibility);
  listen(media, 'change', syncMotion);
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refreshVisibility();
    }, { threshold: 0.05 });
    observer.observe(canvas);
  }

  new GLTFLoader().loadAsync(modelUrl).then((gltf) => {
    root = gltf.scene;
    if (disposed) { disposeModel(); return; }
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      environmentMap = pmrem.fromScene(environment, 0.04, 0.1, 100, { size: 64 });
      scene.environment = environmentMap.texture;
      scene.environmentIntensity = 0.8;
    } finally {
      environment.dispose();
      pmrem.dispose();
    }
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const height = box.max.y - box.min.y;
    // This gives the same rest transform as the original ground-aligned model, but rotations
    // now pivot about its centre. Authored scale and upright orientation remain on the root.
    root.position.set(-center.x, -center.y, -center.z);
    pivot = new THREE.Group();
    pivot.position.set(0, height * 0.5, 0);
    pivot.rotation.order = 'YXZ';
    pivot.add(root);
    scene.add(pivot);
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
    const camera = new THREE.PerspectiveCamera(34, 1, radius / 20, radius * 40);
    const distance = (radius / Math.sin(camera.fov * Math.PI / 360)) * 1.05;
    camera.position.set(distance * 0.3, height * 0.62, distance * 0.95);
    camera.lookAt(0, height * 0.5, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2.4, 3.6, 2.8);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.85);
    fill.position.set(-3, 1.2, -1.4);
    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(0, -2, -3);
    // Soft ambient and ground fill make the dark lower shell readable.
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x71839a, 1.6);
    scene.add(key, fill, rim, ambient, hemisphere);
    draw = () => {
      if (!canDraw() || !renderer) return;
      renderer.render(scene, camera);
      drawCount++;
      if (!notified) { notified = true; onReady?.(); }
    };
    draw();
    syncMotion();
  }).catch(dispose);

  return dispose;
}

window.SIDAWelcomeRobot = { mount, getState: canvas => diagnostics.get(canvas)?.() ?? null };
