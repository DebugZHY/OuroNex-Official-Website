import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildIconModel } from './icon-model.js';

const stage = document.getElementById('stage');
const loading = document.getElementById('loading');
const fallback = document.getElementById('fallback');
const statsLabel = document.getElementById('mesh-stats');
const rotateToggle = document.getElementById('rotate-toggle');
const plateToggle = document.getElementById('plate-toggle');
const exportButton = document.getElementById('export-glb');
const resetButton = document.getElementById('reset-view');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const toast = document.getElementById('toast');
const query = new URLSearchParams(location.search);
const captureMode = query.get('capture') === '1';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function setSwitch(button, value) {
  button.setAttribute('aria-checked', String(value));
}

function setActiveView(name) {
  viewButtons.forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function init() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0a1420, 0);
  renderer.domElement.setAttribute('aria-label', '可拖动旋转的建造者机器人三维模型');
  renderer.domElement.setAttribute('role', 'img');
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a1420, 28, 95);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 220);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = !captureMode;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.65;
  controls.minDistance = 10;
  controls.maxDistance = 38;
  controls.minPolarAngle = 0.16;
  controls.maxPolarAngle = Math.PI - 0.16;
  controls.autoRotateSpeed = 0.85;
  controls.screenSpacePanning = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.72;
  room.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xc9e6ff, 0x182238, 1.55));

  const key = new THREE.DirectionalLight(0xffedcf, 3.15);
  key.position.set(7, 11, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 36;
  key.shadow.normalBias = 0.035;
  key.shadow.bias = -0.0002;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x75cfff, 1.4);
  fill.position.set(-9, 3, -10);
  scene.add(fill);

  const bounce = new THREE.DirectionalLight(0xffa53d, 0.48);
  bounce.position.set(1, -7, 5);
  scene.add(bounce);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(180, 80).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0c1725, roughness: 0.96, metalness: 0.02 }),
  );
  ground.position.y = -4.58;
  ground.receiveShadow = true;
  ground.name = 'StudioGround';
  scene.add(ground);

  const model = buildIconModel();
  scene.add(model.root);

  const viewDirections = {
    three: new THREE.Vector3(6.2, 3.2, 15.8),
    front: new THREE.Vector3(0, 0.45, 17.35),
    side: new THREE.Vector3(17.35, 0.7, 0),
    back: new THREE.Vector3(0, 0.45, -17.35),
  };
  let currentView = 'three';
  let cameraTween = null;
  let paused = captureMode;

  function fittedPosition(name) {
    const direction = viewDirections[name].clone();
    const narrowScreenScale = Math.max(1, 0.91 / camera.aspect);
    return direction.multiplyScalar(narrowScreenScale);
  }

  function stopAutoRotate() {
    controls.autoRotate = false;
    setSwitch(rotateToggle, false);
  }

  function setView(name, immediate = false) {
    currentView = name;
    stopAutoRotate();
    setActiveView(name);
    const destination = fittedPosition(name);
    if (immediate || reduceMotion || captureMode) {
      cameraTween = null;
      camera.position.copy(destination);
      controls.target.set(0, 0, 0);
      controls.update();
    } else {
      cameraTween = {
        startedAt: performance.now(),
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition: destination,
        toTarget: new THREE.Vector3(0, 0, 0),
      };
    }
  }

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!cameraTween && !controls.autoRotate) {
      camera.position.copy(fittedPosition(currentView));
      controls.target.set(0, 0, 0);
      controls.update();
    }
    renderer.render(scene, camera);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();
  setView(query.get('view') in viewDirections ? query.get('view') : 'three', true);

  controls.addEventListener('start', () => {
    cameraTween = null;
    setActiveView('');
  });

  viewButtons.forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  rotateToggle.addEventListener('click', () => {
    cameraTween = null;
    controls.autoRotate = !controls.autoRotate;
    setSwitch(rotateToggle, controls.autoRotate);
    setActiveView(controls.autoRotate ? '' : currentView);
  });

  plateToggle.addEventListener('click', () => {
    model.backplate.visible = !model.backplate.visible;
    setSwitch(plateToggle, model.backplate.visible);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  });

  resetButton.addEventListener('click', () => {
    model.backplate.visible = true;
    setSwitch(plateToggle, true);
    setView('three');
    showToast('已恢复初始立体视角');
  });

  exportButton.addEventListener('click', () => {
    exportButton.disabled = true;
    exportButton.querySelector('span').textContent = '正在导出';
    model.root.updateMatrixWorld(true);
    const exporter = new GLTFExporter();
    exporter.parse(
      model.root,
      (result) => {
        const blob = new Blob([result], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = '建造者机器人立体图标.glb';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        exportButton.disabled = false;
        exportButton.querySelector('span').textContent = '导出模型';
        showToast('GLB 模型已导出，可用于其他 3D 软件');
      },
      () => {
        exportButton.disabled = false;
        exportButton.querySelector('span').textContent = '导出模型';
        showToast('导出未完成，请稍后重试');
      },
      { binary: true, onlyVisible: true },
    );
  });

  let meshCount = 0;
  let triangleCount = 0;
  model.root.traverse((object) => {
    if (!object.isMesh) return;
    meshCount += 1;
    const geometry = object.geometry;
    triangleCount += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  });

  function renderFrame(now) {
    if (captureMode && paused) return;

    if (cameraTween) {
      const progress = Math.min(1, (now - cameraTween.startedAt) / 260);
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
      if (progress === 1) cameraTween = null;
    }

    if (!paused) controls.update();
    renderer.render(scene, camera);
  }

  function sample(t) {
    const safeTime = Number.isFinite(Number(t)) ? Number(t) : 0;
    const angle = 0.37 + (safeTime / 12) * Math.PI * 2;
    const distance = 17.4 * Math.max(1, 0.91 / camera.aspect);
    camera.position.set(Math.sin(angle) * distance, 3.2, Math.cos(angle) * distance);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  window.__seek = (t) => {
    paused = true;
    cameraTween = null;
    stopAutoRotate();
    controls.enableDamping = false;
    sample(t);
    renderer.render(scene, camera);
  };
  window.__play = () => {
    paused = false;
    controls.enableDamping = !captureMode;
  };
  window.__setView = (name) => {
    if (name in viewDirections) {
      paused = true;
      setView(name, true);
      renderer.render(scene, camera);
    }
  };

  renderer.render(scene, camera);
  loading.style.display = 'none';
  statsLabel.textContent = `${meshCount} 个实体 · ${(triangleCount / 1000).toFixed(1)}k 三角面`;
  renderer.setAnimationLoop(renderFrame);

  if (query.has('t')) window.__seek(query.get('t'));
  window.__SCENE_READY__ = true;
}

init().catch(() => {
  loading.style.display = 'none';
  fallback.hidden = false;
  statsLabel.textContent = 'WebGL 不可用';
});
