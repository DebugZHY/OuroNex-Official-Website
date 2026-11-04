import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildIconModel } from './icon-model.js';

const VIEW_DIRECTION = new THREE.Vector3(6.2, 3.2, 15.8);
const PITCH_LIMIT = 0.62;

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
  canvas.setAttribute('aria-label', host.dataset.sida3dLabel || 'SIDA 3D mark, drag to rotate');
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

  let yaw = -0.34;
  let pitch = 0.16;
  let frame = 0;
  let dragging = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;

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

  function draw() {
    frame = 0;
    pivot.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
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
    yaw += dx * 0.008;
    pitch = THREE.MathUtils.clamp(pitch + dy * 0.006, -PITCH_LIMIT, PITCH_LIMIT);
    requestDraw();
  });

  function release(event) {
    if (!dragging || (event && event.pointerId !== pointerId)) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
  }

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);

  new ResizeObserver(() => {
    placeCamera();
    requestDraw();
  }).observe(host);

  placeCamera();
  requestDraw();
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
