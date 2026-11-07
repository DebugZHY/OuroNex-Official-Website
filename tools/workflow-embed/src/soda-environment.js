import * as THREE from 'three';

function gridStep(size) {
  const magnitude = 10 ** Math.floor(Math.log10(size));
  const fraction = size / magnitude;
  return magnitude * (fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10);
}

const floorVertex = /* glsl */`
varying vec2 vFloorPosition;
void main() {
  vFloorPosition = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const floorFragment = /* glsl */`
uniform vec2 halfExtent;
uniform vec2 footprint;
uniform vec2 gridOffset;
uniform float minorStep;
uniform float visibility;
uniform vec3 paperColor;
uniform vec3 lineColor;
varying vec2 vFloorPosition;

float gridLine(vec2 position, float spacing) {
  vec2 cell = position / spacing;
  vec2 pixel = max(fwidth(cell), vec2(0.00001));
  vec2 distanceToLine = abs(fract(cell - 0.5) - 0.5);
  vec2 coverage = 1.0 - smoothstep(vec2(0.0), pixel * 0.85, distanceToLine);
  float density = 1.0 - smoothstep(0.25, 0.7, max(pixel.x, pixel.y));
  return max(coverage.x, coverage.y) * density;
}

void main() {
  float edge = 1.0 - smoothstep(0.55, 1.0, length(vFloorPosition / halfExtent));
  vec2 coordinates = vFloorPosition + gridOffset;
  float minor = gridLine(coordinates, minorStep);
  float major = gridLine(coordinates, minorStep * 5.0);
  vec2 contact = vFloorPosition / footprint;
  float grounding = 0.025 * exp(-1.6 * dot(contact, contact));
  float lines = max(minor * 0.12, major * 0.20);
  float ink = lines + grounding * (1.0 - lines);
  float alpha = 0.06 + ink * (1.0 - 0.06);
  vec3 color = mix(paperColor, lineColor, ink / alpha);
  gl_FragColor = vec4(color, alpha * edge * visibility);
  #include <colorspace_fragment>
}
`;

/* The group uses source coordinates and belongs beside modelRoot in frame.
 * Its local XY plane becomes horizontal after the source-up conversion. */
export function createSodaEnvironment({ bounds, upAxis, maxShadowSize = 2048 }) {
  const vertical = upAxis === 'Y' ? 1 : 2;
  const horizontal = upAxis === 'Y' ? 2 : 1;
  const width = Math.max(bounds.max[0] - bounds.min[0], 0.001);
  const depth = Math.max(bounds.max[horizontal] - bounds.min[horizontal], 0.001);
  const height = Math.max(bounds.max[vertical] - bounds.min[vertical], 0.001);
  const span = Math.max(width, depth, height * 0.35);
  const step = gridStep(span / 28);
  const gap = Math.max(span * 0.0005, height * 0.001, 0.000001);
  const halfExtent = new THREE.Vector2(
    Math.max(width * 0.8, span * 0.65) + step * 2,
    Math.max(depth * 0.8, span * 0.65) + step * 2,
  );
  const midpoint = bounds.min.map((value, index) => (value + bounds.max[index]) / 2);
  const group = new THREE.Group();
  group.name = 'soda-workspace-environment';
  group.position.fromArray(midpoint);
  group.position.setComponent(vertical, bounds.min[vertical] - gap);
  if (upAxis === 'Y') group.rotation.x = -Math.PI / 2;

  const geometry = new THREE.PlaneGeometry(halfExtent.x * 2, halfExtent.y * 2);
  const grid = new THREE.ShaderMaterial({
    uniforms: {
      halfExtent: { value: halfExtent },
      footprint: { value: new THREE.Vector2(Math.max(width / 2, step), Math.max(depth / 2, step)) },
      gridOffset: { value: new THREE.Vector2(midpoint[0] % (step * 5),
        (upAxis === 'Y' ? -midpoint[2] : midpoint[1]) % (step * 5)) },
      minorStep: { value: step },
      visibility: { value: 1 },
      paperColor: { value: new THREE.Color(0xeef2f5) },
      lineColor: { value: new THREE.Color(0x8297a5) },
    },
    vertexShader: floorVertex,
    fragmentShader: floorFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  const floor = new THREE.Mesh(geometry, grid);
  floor.name = 'soda-workspace-grid';
  floor.renderOrder = -20;
  floor.raycast = () => {};

  const shadowMaterial = new THREE.ShadowMaterial({
    color: 0x526473, opacity: 0.20, depthWrite: false, side: THREE.FrontSide, toneMapped: false,
  });
  /* Fade the real shadow mask before the receiver's geometric boundary. */
  shadowMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.groundHalfExtent = { value: halfExtent };
    shader.vertexShader = `varying vec2 vGroundPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPosition = position.xy;');
    shader.fragmentShader = `varying vec2 vGroundPosition;\nuniform vec2 groundHalfExtent;\n${shader.fragmentShader}`
      .replace('#include <tonemapping_fragment>',
        'gl_FragColor.a *= 1.0 - smoothstep(0.55, 1.0, length(vGroundPosition / groundHalfExtent));\n#include <tonemapping_fragment>');
  };
  shadowMaterial.customProgramCacheKey = () => 'soda-workspace-shadow';
  const receiver = new THREE.Mesh(geometry, shadowMaterial);
  receiver.name = 'soda-workspace-shadow';
  receiver.position.z = gap * 0.05;
  receiver.receiveShadow = true;
  receiver.renderOrder = -19;
  receiver.raycast = () => {};

  /* Zero radiance leaves the model's existing illumination unchanged.
   * ShadowMaterial reads this light's depth mask independently of radiance. */
  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.name = 'soda-workspace-shadow-light';
  light.position.set(span * 0.28, -span * 0.32, span * 1.6 + height + gap);
  light.target.position.set(0, 0, height * 0.3 + gap);
  light.castShadow = true;
  const mapSize = 2 ** Math.floor(Math.log2(Math.max(1, Math.min(2048, maxShadowSize))));
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.radius = 3;
  light.shadow.bias = -0.00012;
  light.shadow.normalBias = span * 0.0001;
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
  group.add(floor, receiver, light, light.target);

  const normal = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let fitted = false;
  let disposed = false;

  function fitShadow() {
    const camera = light.shadow.camera;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    const ray = light.target.position.clone().sub(light.position).normalize();
    for (const x of [-width / 2, width / 2]) {
      for (const y of [-depth / 2, depth / 2]) {
        for (const z of [gap, height + gap]) {
          const local = new THREE.Vector3(x, y, z);
          box.expandByPoint(point.copy(local).applyMatrix4(group.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
          local.addScaledVector(ray, -z / ray.z);
          box.expandByPoint(point.copy(local).applyMatrix4(group.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
        }
      }
    }
    const margin = Math.max(step * 2, span * 0.07);
    camera.left = box.min.x - margin;
    camera.right = box.max.x + margin;
    camera.bottom = box.min.y - margin;
    camera.top = box.max.y + margin;
    camera.near = Math.max(span * 0.001, -box.max.z - margin);
    camera.far = Math.max(camera.near + span, -box.min.z + margin);
    camera.updateProjectionMatrix();
    fitted = true;
  }

  /* Called by every demand draw, including when the floor is hidden. Pan
   * moves light and casters together: only their world-to-shadow matrix changes. */
  function update(camera, selected) {
    if (disposed) return;
    group.updateWorldMatrix(true, true);
    normal.set(0, 0, 1).transformDirection(group.matrixWorld);
    origin.setFromMatrixPosition(group.matrixWorld);
    camera.getWorldPosition(eye);
    const altitude = eye.sub(origin).dot(normal);
    camera.getWorldDirection(direction).negate();
    const facing = direction.dot(normal);
    const fade = THREE.MathUtils.smoothstep(facing, 0.025, 0.18)
      * THREE.MathUtils.smoothstep(altitude, gap, span * 0.035);
    grid.uniforms.visibility.value = fade * (selected ? 0.32 : 1);
    shadowMaterial.opacity = 0.20 * fade * (selected ? 0.28 : 1);
    floor.visible = receiver.visible = fade > 0.0001;

    const shadow = light.shadow;
    shadow.camera.up.set(0, 1, 0).transformDirection(group.matrixWorld);
    shadow.updateMatrices(light);
    if (!fitted) {
      fitShadow();
      shadow.updateMatrices(light);
    }
  }

  return {
    group,
    update,
    getState() {
      return {
        sourceFloorPosition: group.position.toArray(),
        floorNormal: normal.toArray(),
        visible: floor.visible,
        gridSpacing: grid.uniforms.minorStep.value,
        gridVisibility: grid.uniforms.visibility.value,
        shadowOpacity: shadowMaterial.opacity,
        shadowMapSize: light.shadow.mapSize.toArray(),
        shadowMapAllocated: light.shadow.map !== null,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      geometry.dispose();
      grid.dispose();
      shadowMaterial.dispose();
      light.shadow.dispose();
      group.clear();
    },
  };
}
