import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildIconModel } from './icon-model.js';

const VIEW_DIRECTION = new THREE.Vector3(6.2, 3.2, 15.8);
const PITCH_LIMIT = 0.62;

// The camera sits off the +Z axis, so the mark only faces the viewer when the
// resting yaw cancels that azimuth; double-click restores this pose.
const VIEW = VIEW_DIRECTION.clone().normalize();
const DEFAULT_YAW = Math.asin(VIEW.x);

// Resting pose: square to the viewer, turned about 3 degrees to their right.
// The pitch stays at zero: the camera is off-axis in azimuth, so any pitch leans
// the mark's vertical axis off the screen vertical instead of squaring it up.
const POSE_YAW = DEFAULT_YAW + 0.055;
const POSE_PITCH = 0;

// Idle sway: a slow, even swing either side of the resting pose.
const SWAY_AMPLITUDE = 0.145;
const SWAY_PERIOD_MS = 7600;
const FRAME_INTERVAL_MS = 1000 / 30;
const REST_LABEL = 'SIDA 3D mark, drag to rotate, double-click to reset';

function mount(host) {
  if (host.dataset.sida3dReady === '1') return null;
  host.dataset.sida3dReady = '1';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0a1420, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', host.dataset.sida3dLabel || REST_LABEL);
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 220);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.72;
  room.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xc9e6ff, 0x182238, 1.55));
  const key = new THREE.DirectionalLight(0xffedcf, 3.15);
  key.position.set(7, 11, 12);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x75cfff, 1.4);
  fill.position.set(-9, 3, -10);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xffa53d, 0.48);
  bounce.position.set(1, -7, 5);
  scene.add(bounce);

  const pivot = new THREE.Group();
  const model = buildIconModel();
  pivot.add(model.root);
  scene.add(pivot);

  const target = new THREE.Vector3();
  const bounds = new THREE.Box3().setFromObject(model.root);
  const size = bounds.getSize(new THREE.Vector3());
  bounds.getCenter(target);
  model.root.position.sub(target);
  const radius = Math.max(size.x, size.y, size.z) * 0.68;

  // baseYaw/basePitch hold the pose the swing hangs off; the swing itself is
  // added on top at paint time so a drag never fights the animation.
  let baseYaw = POSE_YAW;
  let basePitch = POSE_PITCH;
  let frame = 0;
  let dragging = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let swayOrigin = performance.now();
  let lastPaint = 0;
  let onScreen = true;
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function placeCamera() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const distance = (radius / Math.tan((camera.fov * Math.PI) / 360)) / Math.min(1, camera.aspect);
    camera.position.copy(VIEW_DIRECTION).normalize().multiplyScalar(Math.max(distance, 12)).add(target);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  function animating() {
    return !(reduceMotion && reduceMotion.matches);
  }

  function swayOffset(now) {
    if (dragging || !animating()) return 0;
    const phase = (((now - swayOrigin) % SWAY_PERIOD_MS) + SWAY_PERIOD_MS) % SWAY_PERIOD_MS;
    return Math.sin((phase / SWAY_PERIOD_MS) * Math.PI * 2) * SWAY_AMPLITUDE;
  }

  function paint(now) {
    lastPaint = now;
    pivot.rotation.set(basePitch, baseYaw + swayOffset(now), 0);
    renderer.render(scene, camera);
  }

  // One still frame, used on first paint and whenever the motion stops.
  function draw() {
    cancelAnimationFrame(frame);
    frame = 0;
    paint(performance.now());
  }

  function tick(now) {
    frame = 0;
    if (!onScreen || document.hidden || dragging || !animating()) return;
    if (now - lastPaint >= FRAME_INTERVAL_MS) paint(now);
    frame = requestAnimationFrame(tick);
  }

  function resume() {
    if (frame || !onScreen || document.hidden || dragging || !animating()) return;
    frame = requestAnimationFrame(tick);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    dragging = true;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(pointerId);
    canvas.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    baseYaw += dx * 0.008;
    basePitch = THREE.MathUtils.clamp(basePitch + dy * 0.006, -PITCH_LIMIT, PITCH_LIMIT);
    draw();
  });

  function release(event) {
    if (!dragging || (event && event.pointerId !== pointerId)) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
    swayOrigin = performance.now();
    draw();
    resume();
  }

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);

  canvas.addEventListener('dblclick', () => {
    baseYaw = POSE_YAW;
    basePitch = POSE_PITCH;
    swayOrigin = performance.now();
    draw();
    resume();
  });

  new ResizeObserver(() => {
    placeCamera();
    paint(performance.now());
  }).observe(host);

  // The swing costs frames, so it only runs while the mark is on screen and
  // the tab is in front; everything else falls back to a single still.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) {
        resume();
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }).observe(host);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      resume();
    }
  });

  if (reduceMotion && reduceMotion.addEventListener) {
    reduceMotion.addEventListener('change', () => {
      if (animating()) resume();
      else draw();
    });
  }

  placeCamera();
  draw();
  resume();
  return { canvas, renderer, scene, camera, pivot };
}

function boot() {
  const hosts = [...document.querySelectorAll('[data-sida-3d]')];
  if (!hosts.length) return;
  if (!window.WebGL2RenderingContext && !document.createElement('canvas').getContext('webgl')) return;
  const start = (host) => {
    try {
      mount(host);
    } catch (error) {
      host.classList.add('is-unavailable');
      console.warn('SIDA 3D mark unavailable', error);
    }
  };
  if (!('IntersectionObserver' in window)) {
    hosts.forEach(start);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      start(entry.target);
    });
  }, { rootMargin: '200px 0px' });
  hosts.forEach((host) => observer.observe(host));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
