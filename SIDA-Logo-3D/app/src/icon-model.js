import * as THREE from 'three';

const PALETTE = {
  navy: 0x111d31,
  navySide: 0x0a1425,
  rear: 0x1b2b43,
  blue: 0x168fc9,
  blueDeep: 0x17628f,
  cyan: 0x45d4df,
  cyanLight: 0x75ecf1,
  orange: 0xf57e20,
  orangeDeep: 0xe9571c,
  amber: 0xffb52e,
  yellow: 0xffca48,
  bolt: 0x6f879f,
};

function physical(color, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: options.roughness ?? 0.3,
    metalness: options.metalness ?? 0.08,
    clearcoat: options.clearcoat ?? 0.42,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.26,
    envMapIntensity: options.envMapIntensity ?? 0.8,
  });
}

function roundedRectShape(width, height, radius, cx = 0, cy = 0) {
  const x = cx - width / 2;
  const y = cy - height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  shape.closePath();
  return shape;
}

function sectorShape(cx, cy, outerRadius, innerRadius, startDeg, endDeg) {
  const start = THREE.MathUtils.degToRad(startDeg);
  const end = THREE.MathUtils.degToRad(endDeg);
  const clockwise = end < start;
  const shape = new THREE.Shape();
  shape.moveTo(cx + Math.cos(start) * outerRadius, cy + Math.sin(start) * outerRadius);
  shape.absarc(cx, cy, outerRadius, start, end, clockwise);
  shape.lineTo(cx + Math.cos(end) * innerRadius, cy + Math.sin(end) * innerRadius);
  shape.absarc(cx, cy, innerRadius, end, start, !clockwise);
  shape.closePath();
  return shape;
}

function domeShape(width, height, baseY) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, baseY);
  shape.bezierCurveTo(-width * 0.48, baseY + height * 0.48, -width * 0.25, baseY + height, 0, baseY + height);
  shape.bezierCurveTo(width * 0.25, baseY + height, width * 0.48, baseY + height * 0.48, width / 2, baseY);
  shape.closePath();
  return shape;
}

function extruded(shape, depth, material, z = 0, bevel = 0.045, name = 'ReliefPart') {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 28,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel * 0.25,
    bevelSegments: 4,
  });
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

function roundedPart(parent, config) {
  const {
    width, height, radius, x = 0, y = 0, z = 0, depth = 0.2,
    bevel = 0.04, material, name,
  } = config;
  const mesh = extruded(roundedRectShape(width, height, radius, x, y), depth, material, z, bevel, name);
  parent.add(mesh);
  return mesh;
}

function arcPoints(cx, cy, radius, startDeg, endDeg, z, count = 56) {
  const start = THREE.MathUtils.degToRad(startDeg);
  const end = THREE.MathUtils.degToRad(endDeg);
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = THREE.MathUtils.lerp(start, end, index / count);
    return new THREE.Vector3(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, z);
  });
}

function tubeFromPoints(points, radius, material, name, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length * 2), radius, 10, closed);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

function addArcTube(parent, config) {
  const {
    cx, cy, radius, start, end, z, thickness, material, name,
  } = config;
  const points = arcPoints(cx, cy, radius, start, end, z);
  const mesh = tubeFromPoints(points, thickness, material, name);
  parent.add(mesh);
  const capGeometry = new THREE.SphereGeometry(thickness, 16, 12);
  for (const [index, point] of [points[0], points.at(-1)].entries()) {
    const cap = new THREE.Mesh(capGeometry, material);
    cap.position.copy(point);
    cap.castShadow = true;
    cap.name = `${name}Cap${index + 1}`;
    parent.add(cap);
  }
  return mesh;
}

function addCable(parent, config) {
  const { outlineMaterial, thickness = 0.09, ...rest } = config;
  addArcTube(parent, {
    ...rest,
    z: config.z - 0.1,
    thickness: thickness * 1.65,
    material: outlineMaterial,
    name: `${config.name}Outline`,
  });
  addArcTube(parent, { ...rest, thickness, material: config.material, name: config.name });
}

function addSector(parent, config) {
  const { cx, cy, outer, inner, start, end, z, depth, bevel = 0.035, material, name } = config;
  const mesh = extruded(sectorShape(cx, cy, outer, inner, start, end), depth, material, z, bevel, name);
  parent.add(mesh);
  return mesh;
}

function buildBackplate(materials) {
  const group = new THREE.Group();
  group.name = 'OptionalBackplate';
  roundedPart(group, {
    width: 8.65, height: 8.65, radius: 1.45, z: -0.62, depth: 0.62,
    bevel: 0.16, material: materials.navy, name: 'BeveledIconShell',
  });
  roundedPart(group, {
    width: 7.25, height: 7.25, radius: 1.05, z: -0.73, depth: 0.14,
    bevel: 0.07, material: materials.rear, name: 'RearInsetPanel',
  });

  const boltGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.11, 28, 1, false);
  boltGeometry.rotateX(Math.PI / 2);
  const slotGeometry = new THREE.BoxGeometry(0.17, 0.035, 0.025);
  for (const x of [-3.12, 3.12]) {
    for (const y of [-3.12, 3.12]) {
      const bolt = new THREE.Mesh(boltGeometry, materials.bolt);
      bolt.position.set(x, y, -0.83);
      bolt.castShadow = true;
      bolt.name = 'RearFastener';
      group.add(bolt);
      const slot = new THREE.Mesh(slotGeometry, materials.navySide);
      slot.position.set(x, y, -0.895);
      slot.rotation.z = (x * y > 0 ? 1 : -1) * Math.PI / 4;
      slot.name = 'FastenerSlot';
      group.add(slot);
    }
  }
  return group;
}

function buildRobot(pattern, m) {
  const robot = new THREE.Group();
  robot.name = 'RobotAssembly';
  pattern.add(robot);

  // Upper blue sweep: three physical layers create a navy outline and cyan rim.
  addSector(robot, { cx: 0, cy: 1.15, outer: 2.65, inner: 1.46, start: 130, end: 280, z: -0.02, depth: 0.34, material: m.navySide, name: 'BlueSweepOutline' });
  addSector(robot, { cx: 0, cy: 1.15, outer: 2.51, inner: 1.60, start: 130, end: 280, z: 0.27, depth: 0.27, material: m.cyan, name: 'BlueSweepCyanRim' });
  addSector(robot, { cx: 0, cy: 1.15, outer: 2.34, inner: 1.77, start: 131, end: 279, z: 0.50, depth: 0.24, material: m.blue, name: 'BlueSweepFace' });
  addArcTube(robot, { cx: 0, cy: 1.15, radius: 1.9, start: 205, end: 259, z: 0.79, thickness: 0.04, material: m.cyanLight, name: 'BlueSweepHighlight' });

  // Lower amber return sweep, modelled separately so the S silhouette remains legible.
  addSector(robot, { cx: 0.35, cy: -1.15, outer: 2.50, inner: 1.29, start: 95, end: -80, z: 0.0, depth: 0.34, material: m.navySide, name: 'AmberSweepOutline' });
  addSector(robot, { cx: 0.35, cy: -1.15, outer: 2.36, inner: 1.43, start: 95, end: -80, z: 0.29, depth: 0.28, material: m.amber, name: 'AmberSweepRim' });
  addSector(robot, { cx: 0.35, cy: -1.15, outer: 2.18, inner: 1.61, start: 94, end: -79, z: 0.53, depth: 0.25, material: m.orange, name: 'AmberSweepFace' });
  addArcTube(robot, { cx: 0.35, cy: -1.15, radius: 1.94, start: 59, end: -55, z: 0.83, thickness: 0.04, material: m.yellow, name: 'AmberSweepHighlight' });

  // Orange return at bottom left.
  addSector(robot, { cx: -0.4, cy: -0.9, outer: 2.63, inner: 1.62, start: 170, end: 292, z: 0.03, depth: 0.33, material: m.navySide, name: 'OrangeReturnOutline' });
  addSector(robot, { cx: -0.4, cy: -0.9, outer: 2.49, inner: 1.76, start: 170, end: 292, z: 0.31, depth: 0.27, material: m.amber, name: 'OrangeReturnRim' });
  addSector(robot, { cx: -0.4, cy: -0.9, outer: 2.31, inner: 1.94, start: 171, end: 291, z: 0.54, depth: 0.24, material: m.orangeDeep, name: 'OrangeReturnFace' });
  addArcTube(robot, { cx: -0.4, cy: -0.9, radius: 2.1, start: 220, end: 265, z: 0.83, thickness: 0.04, material: m.yellow, name: 'OrangeReturnHighlight' });

  // Head and face sit forward of the sweeps, preserving the reference's overlap order.
  roundedPart(robot, { width: 4.05, height: 2.32, radius: 0.78, x: 0, y: 1.25, z: 0.47, depth: 0.42, bevel: 0.08, material: m.navySide, name: 'HeadOuterShell' });
  roundedPart(robot, { width: 3.66, height: 1.91, radius: 0.60, x: 0, y: 1.30, z: 0.87, depth: 0.24, bevel: 0.06, material: m.blueDeep, name: 'FaceScreen' });
  roundedPart(robot, { width: 0.48, height: 0.92, radius: 0.24, x: -0.96, y: 1.34, z: 1.11, depth: 0.13, bevel: 0.035, material: m.cyan, name: 'LeftEye' });
  addArcTube(robot, { cx: 0.98, cy: 1.19, radius: 0.43, start: 18, end: 162, z: 1.24, thickness: 0.12, material: m.cyan, name: 'WinkingEye' });

  // Rounded torso, lifted from the orange return beneath it.
  roundedPart(robot, { width: 3.55, height: 1.45, radius: 0.68, x: 0, y: -1.31, z: 0.54, depth: 0.39, bevel: 0.075, material: m.navySide, name: 'TorsoOuterShell' });
  roundedPart(robot, { width: 3.22, height: 1.14, radius: 0.52, x: 0, y: -1.27, z: 0.91, depth: 0.25, bevel: 0.055, material: m.blueDeep, name: 'TorsoFace' });

  // Hard hat: orange lower shell, golden dome, raised ribs and a broad rounded brim.
  const helmetBase = extruded(domeShape(3.18, 1.66, 2.43), 0.39, m.orange, 0.63, 0.07, 'HelmetOrangeShell');
  robot.add(helmetBase);
  const helmetDome = extruded(domeShape(2.96, 1.60, 2.53), 0.30, m.amber, 1.00, 0.055, 'HelmetGoldenDome');
  robot.add(helmetDome);
  roundedPart(robot, { width: 2.98, height: 0.17, radius: 0.085, x: 0, y: 2.62, z: 1.31, depth: 0.11, bevel: 0.025, material: m.orange, name: 'HelmetBand' });
  roundedPart(robot, { width: 3.55, height: 0.29, radius: 0.145, x: 0, y: 2.40, z: 1.19, depth: 0.25, bevel: 0.045, material: m.yellow, name: 'HelmetBrim' });
  const ribConfigs = [
    { x: -0.46, y: 3.42, h: 0.76 },
    { x: 0, y: 3.55, h: 0.96 },
    { x: 0.46, y: 3.42, h: 0.76 },
  ];
  ribConfigs.forEach(({ x, y, h }, index) => {
    roundedPart(robot, { width: 0.12, height: h, radius: 0.06, x, y, z: 1.34, depth: 0.075, bevel: 0.02, material: m.orange, name: `HelmetRib${index + 1}` });
  });

  return robot;
}

function buildCables(pattern, m) {
  const cables = new THREE.Group();
  cables.name = 'OrbitalCables';
  pattern.add(cables);
  const configs = [
    { cx: 0.1, cy: 0.4, radius: 3.25, start: 115, end: 195, z: 0.12, thickness: 0.105, material: m.blue, name: 'BlueOuterCable' },
    { cx: 0.1, cy: 0.65, radius: 3.0, start: 65, end: -5, z: 0.10, thickness: 0.105, material: m.cyan, name: 'CyanOuterCable' },
    { cx: 0.1, cy: 0.7, radius: 2.45, start: 70, end: -20, z: 0.08, thickness: 0.085, material: m.cyan, name: 'CyanInnerCable' },
    { cx: 0, cy: -0.1, radius: 3.35, start: -15, end: -82, z: 0.11, thickness: 0.105, material: m.amber, name: 'AmberOuterCable' },
    { cx: -0.2, cy: -0.4, radius: 3.25, start: 205, end: 260, z: 0.10, thickness: 0.105, material: m.orange, name: 'OrangeOuterCable' },
  ];
  configs.forEach((config) => addCable(cables, { ...config, outlineMaterial: m.navySide }));
  return cables;
}

export function buildIconModel() {
  const materials = {
    navy: physical(PALETTE.navy, { roughness: 0.25, metalness: 0.16 }),
    navySide: physical(PALETTE.navySide, { roughness: 0.32, metalness: 0.12 }),
    rear: physical(PALETTE.rear, { roughness: 0.38, metalness: 0.2 }),
    blue: physical(PALETTE.blue),
    blueDeep: physical(PALETTE.blueDeep, { roughness: 0.24, metalness: 0.14 }),
    cyan: physical(PALETTE.cyan, { roughness: 0.25, clearcoat: 0.55 }),
    cyanLight: physical(PALETTE.cyanLight, { roughness: 0.22, clearcoat: 0.6 }),
    orange: physical(PALETTE.orange),
    orangeDeep: physical(PALETTE.orangeDeep),
    amber: physical(PALETTE.amber, { roughness: 0.27 }),
    yellow: physical(PALETTE.yellow, { roughness: 0.25, clearcoat: 0.5 }),
    bolt: physical(PALETTE.bolt, { roughness: 0.22, metalness: 0.72, clearcoat: 0.2 }),
  };

  const root = new THREE.Group();
  root.name = 'BuilderRobot3DIcon';
  root.userData = {
    title: '建造者机器人立体图标',
    construction: 'Layered solid geometry with beveled relief, tubular cables and finished rear shell',
    units: 'meters (display scale)',
  };
  const backplate = buildBackplate(materials);
  const pattern = new THREE.Group();
  pattern.name = 'RaisedPattern';
  root.add(backplate, pattern);
  buildCables(pattern, materials);
  buildRobot(pattern, materials);

  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return { root, backplate, pattern, materials };
}
