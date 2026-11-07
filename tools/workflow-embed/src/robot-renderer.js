import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const modelUrl = new URL('../../SIDA-Logo-3D/建造者机器人立体图标.glb', document.currentScript.src).href;

function mount(canvas, size, onReady) {
  let disposed = false;
  let frame = 0;
  let visible = true;
  let renderer;
  let environmentMap;
  let root;
  let observer;
  let cleanup = () => {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const disposeEnvironment = () => { environmentMap?.dispose(); environmentMap = null; };
  const disposeModel = () => root?.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose();
  });

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
    root.position.set(-center.x, -box.min.y, -center.z);
    scene.add(root);
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
    const draw = () => renderer.render(scene, camera);
    draw();
    onReady();

    const started = performance.now();
    let pointer = 0;
    let pointerTarget = 0;
    const spin = (now) => {
      pointer += (pointerTarget - pointer) * 0.08;
      root.rotation.y = Math.sin((now - started) / 7000 * Math.PI * 2) * 14 * Math.PI / 180 + pointer * 6 * Math.PI / 180;
      draw();
      frame = requestAnimationFrame(spin);
    };
    const resume = () => { if (!reduced && !disposed && visible && !document.hidden && !frame) frame = requestAnimationFrame(spin); };
    const onPointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      const half = Math.max(rect.width, 1) / 2;
      pointerTarget = Math.max(-1, Math.min(1, (event.clientX - rect.left - half) / half));
    };
    const onLeave = () => { pointerTarget = 0; };
    const onVisibility = () => document.hidden ? stop() : resume();
    const onResize = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size, size, false);
      draw();
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      visible ? resume() : stop();
    }, { threshold: 0.05 });
    observer.observe(canvas);
    cleanup = () => {
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
    resume();
  }).catch(() => { disposeModel(); disposeEnvironment(); renderer?.dispose(); });

  return () => { disposed = true; stop(); cleanup(); disposeModel(); disposeEnvironment(); renderer?.dispose(); };
}

window.SIDAWelcomeRobot = { mount };
