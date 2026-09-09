import * as THREE from 'three';

// All surfaces are actual geometry. The same baked buffers and matte materials
// are shared by the map relic and the larger inspection model.
const material = (name, color, extra = {}) => new THREE.MeshStandardMaterial({
  name, color, roughness: 0.78, metalness: 0, flatShading: true, ...extra,
});
let palette;
let primitive;
let crystalGeometry;
function ensureActorResources() {
  if (palette) return;
  palette = {
  ivory: material('warm ivory', '#f4dfb7'),
  ochre: material('matte ochre', '#d89c3a'),
  coral: material('clay coral', '#ed704b'),
  navy: material('deep navy', '#324b64'),
  cyan: material('turquoise facets', '#ffffff', { vertexColors: true, roughness: 0.32 }),
  skin: material('warm clay', '#c8976b'),
  orange: material('burnt orange canvas', '#bc6035'),
  brown: material('leather brown', '#71523c'),
  cream: material('traveler cream', '#f0deb7'),
};
primitive = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
  diamond: new THREE.OctahedronGeometry(1, 0),
};
  crystalGeometry = facetedCrystal();
}

function mesh(parent, geometry, mat, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(...position);
  item.scale.set(...scale);
  item.rotation.set(...rotation);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function beveledPlate(width, height, depth, bevel = 0.025) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSegments: 1,
    steps: 1, bevelSize: bevel, bevelThickness: bevel,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// A crescent has a deliberate opening and gently tapered, blunt ends. Broad
// bevels catch the key light without adding engraved or jewelry-like detail.
function crescent(radius, width, startDegrees, endDegrees) {
  const shape = new THREE.Shape();
  const points = 30;
  const edges = [[], []];
  for (let i = 0; i <= points; i += 1) {
    const t = i / points;
    const angle = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(startDegrees, endDegrees, t));
    const endSoftening = 0.68 + 0.32 * Math.sin(Math.PI * t);
    const centerRadius = radius - width / 2;
    for (let edge = 0; edge < 2; edge += 1) {
      const r = centerRadius + (edge === 0 ? 1 : -1) * width * endSoftening / 2;
      edges[edge].push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
  }
  shape.moveTo(...edges[0][0]);
  for (const point of edges[0].slice(1)) shape.lineTo(...point);
  for (const point of edges[1].reverse()) shape.lineTo(...point);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.15, steps: 1, bevelEnabled: true,
    bevelThickness: 0.025, bevelSize: 0.021, bevelSegments: 1,
  });
  geometry.translate(0, 0, -0.075);
  return geometry;
}

function facetedCrystal() {
  const positions = [];
  const colors = [];
  const swatches = ['#14bfd0', '#45d7dd', '#2fcddd', '#0faac1', '#139aaf', '#0cabbc', '#22c2ce', '#66dee0'];
  const rings = [
    { radius: 0.82, z: -0.12 },
    { radius: 1.0, z: 0.015 },
    { radius: 0.70, z: 0.25 },
  ].map(({ radius, z }) => Array.from({ length: 8 }, (_, i) => {
    const angle = (i + 0.5) * Math.PI / 4;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, z];
  }));
  function triangle(a, b, c, color) {
    positions.push(...a, ...b, ...c);
    const rgb = new THREE.Color(color);
    for (let i = 0; i < 3; i += 1) colors.push(rgb.r, rgb.g, rgb.b);
  }
  for (let i = 0; i < 8; i += 1) {
    const next = (i + 1) % 8;
    triangle([0, 0, -0.12], rings[0][next], rings[0][i], '#108da4');
    for (let band = 0; band < 2; band += 1) {
      triangle(rings[band][i], rings[band][next], rings[band + 1][next], swatches[i]);
      triangle(rings[band][i], rings[band + 1][next], rings[band + 1][i], swatches[i]);
    }
    triangle([0, 0, 0.25], rings[2][i], rings[2][next], i < 3 ? '#2bcbd4' : '#20c0ca');
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}



// Collapse only rigid parts with matching materials. This keeps both copies of
// the relic inexpensive while retaining independently animated traveler limbs.
function bakeRigid(source) {
  source.updateMatrixWorld(true);
  const batches = new Map();
  source.traverse((item) => {
    if (!item.isMesh) return;
    const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone();
    geometry.applyMatrix4(item.matrixWorld);
    if (!batches.has(item.material)) batches.set(item.material, []);
    batches.get(item.material).push(geometry);
  });
  const baked = [];
  for (const [mat, geometries] of batches) {
    const geometry = new THREE.BufferGeometry();
    const attributes = mat.vertexColors ? ['position', 'normal', 'color'] : ['position', 'normal'];
    for (const attribute of attributes) {
      const length = geometries.reduce((total, part) => total + part.getAttribute(attribute).array.length, 0);
      const values = new Float32Array(length);
      let offset = 0;
      for (const part of geometries) {
        const array = part.getAttribute(attribute).array;
        values.set(array, offset);
        offset += array.length;
      }
      geometry.setAttribute(attribute, new THREE.BufferAttribute(values, 3));
    }
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    baked.push({ geometry, material: mat });
    geometries.forEach((part) => part.dispose());
  }
  return baked;
}

function instantiateBaked(parts, name, materials) {
  const group = new THREE.Group();
  group.name = name;
  for (const part of parts) {
    const item = mesh(group, part.geometry, materials?.get(part.material) || part.material);
    item.name = `${name} · ${part.material.name}`;
  }
  return group;
}

let relicParts;

export function createRelic() {
  ensureActorResources();
  if (!relicParts) {
    const model = new THREE.Group();
    const coreY = 0.37;
    mesh(model, crystalGeometry, palette.cyan, [0, coreY, 0.065], [0.43, 0.43, 0.65]);

    mesh(model, crescent(0.59, 0.10, 77, 382), palette.ivory, [0.015, coreY - 0.015, 0.055]);
    mesh(model, crescent(0.79, 0.145, 92, 363), palette.ivory, [-0.035, coreY + 0.025, 0]);
    mesh(model, crescent(1.00, 0.18, 82, 331), palette.ivory, [0.015, coreY + 0.035, -0.035]);

    // Broad clay-colored clasp at the shared opening, with a plain ochre foot.
    mesh(model, beveledPlate(0.18, 0.40, 0.16), palette.coral, [0.46, 1.06, 0.015], [1, 1, 1], [0, 0, -0.49]);
    mesh(model, beveledPlate(0.23, 0.065, 0.18, 0.015), palette.ochre, [0.36, 0.89, 0.03], [1, 1, 1], [0, 0, -0.49]);
    mesh(model, primitive.diamond, palette.ochre, [0.46, 1.08, 0.137], [0.065, 0.09, 0.045]);

    // Four small retaining tabs frame the central octagon.
    const tabGeometry = beveledPlate(0.105, 0.072, 0.10, 0.012);
    for (const degrees of [78, 163, 235, 286]) {
      const angle = THREE.MathUtils.degToRad(degrees);
      mesh(model, tabGeometry, palette.ochre,
        [Math.cos(angle) * 0.452, coreY + Math.sin(angle) * 0.452, 0.16],
        [1, 1, 1], [0, 0, angle - Math.PI / 2]);
    }

    // Simple raised diamond marks, spaced far apart on the outer ivory shell.
    for (const [x, y, angle] of [[-0.55, 1.07, -0.45], [0.58, -0.23, -0.50]]) {
      mesh(model, primitive.diamond, palette.ivory, [x, y, 0.105], [0.073, 0.115, 0.046], [0, 0, angle]);
    }

    // Two ochre round fasteners supply small secondary cyan accents.
    for (const [x, y] of [[-0.84, 0.73], [0.69, -0.12]]) {
      mesh(model, primitive.cylinder, palette.ochre, [x, y, 0.075], [0.12, 0.08, 0.12], [Math.PI / 2, 0, 0]);
      mesh(model, crystalGeometry, palette.cyan, [x, y, 0.122], [0.083, 0.083, 0.19]);
    }

    // The fork is deliberately open down its center, with two thick toy grips.
    const grip = beveledPlate(0.15, 0.82, 0.155, 0.019);
    const endCap = beveledPlate(0.168, 0.15, 0.17, 0.019);
    for (const side of [-1, 1]) {
      const angle = -side * 0.09;
      mesh(model, grip, palette.navy, [side * 0.137, -1.07, -0.012], [1, 1, 1], [0, 0, angle]);
      mesh(model, endCap, palette.ivory, [side * 0.173, -1.47, -0.012], [1, 1, 1], [0, 0, angle]);
      mesh(model, beveledPlate(0.152, 0.05, 0.178, 0.009), palette.ochre,
        [side * 0.177, -1.535, 0.001], [1, 1, 1], [0, 0, angle]);
    }
    mesh(model, beveledPlate(0.27, 0.27, 0.20), palette.coral, [0, -0.62, 0.025], [1, 1, 1], [0, 0, -0.10]);
    mesh(model, beveledPlate(0.29, 0.060, 0.19, 0.012), palette.ochre, [0, -0.78, 0.003]);
    mesh(model, primitive.diamond, palette.ochre, [0, -0.615, 0.161], [0.067, 0.084, 0.041]);

    relicParts = bakeRigid(model);
  }
  const relic = instantiateBaked(relicParts, 'Tide compass');
  relic.userData.kind = 'relic';
  return relic;
}

let explorerBodyParts;
let explorerLegParts;
let explorerArmParts;

function buildExplorerParts() {
  const body = new THREE.Group();
  mesh(body, beveledPlate(0.26, 0.29, 0.18, 0.027), palette.navy, [0, 0.565, 0]);
  mesh(body, primitive.cube, palette.brown, [0, 0.445, 0], [0.31, 0.052, 0.235]);
  mesh(body, primitive.cylinder, palette.skin, [0, 0.845, 0.015], [0.145, 0.225, 0.145]);
  // A short cream scarf reads from the overhead gameplay camera.
  mesh(body, primitive.cylinder, palette.cream, [0, 0.731, 0.005], [0.155, 0.07, 0.155]);
  mesh(body, beveledPlate(0.070, 0.15, 0.018, 0.008), palette.cream, [0.080, 0.64, 0.134], [1, 1, 1], [0, 0, -0.12]);

  // A small card folio replaces the warehouse-sized hiking pack. Identity
  // accessories live outside the baked torso so each lineage has a silhouette.
  mesh(body, beveledPlate(0.18, 0.18, 0.07, 0.015), palette.orange, [0.16, 0.49, -0.12]);
  mesh(body, primitive.cube, palette.brown, [-0.045, 0.60, 0.115], [0.035, 0.30, 0.026], [0, 0, -0.55]);
  for (const side of [-1, 1]) {
    mesh(body, primitive.cube, palette.navy, [side * 0.065, 0.885, 0.145], [0.025, 0.031, 0.013]);
  }

  const leg = new THREE.Group();
  mesh(leg, primitive.cube, palette.navy, [0, -0.14, 0], [0.113, 0.285, 0.12]);
  mesh(leg, beveledPlate(0.108, 0.10, 0.17, 0.014), palette.brown, [0, -0.332, 0.026]);
  const arm = new THREE.Group();
  mesh(arm, primitive.cylinder, palette.cream, [0, -0.092, 0], [0.070, 0.20, 0.070]);
  mesh(arm, primitive.cylinder, palette.skin, [0, -0.203, 0.012], [0.052, 0.070, 0.052]);

  explorerBodyParts = bakeRigid(body);
  explorerLegParts = bakeRigid(leg);
  explorerArmParts = bakeRigid(arm);
}

export function createExplorer() {
  ensureActorResources();
  if (!explorerBodyParts) buildExplorerParts();
  const group = new THREE.Group();
  group.name = 'Small traveler';
  // Per-character colors must never mutate the shared relic palette.
  const materials = new Map(Object.values(palette).map(mat => [mat, mat.clone()]));
  const body = instantiateBaked(explorerBodyParts, 'Traveler body', materials);
  group.add(body);
  const legs = [];
  const arms = [];
  for (const side of [-1, 1]) {
    const leg = instantiateBaked(explorerLegParts, side < 0 ? 'Left leg' : 'Right leg', materials);
    leg.position.set(side * 0.092, 0.396, 0);
    group.add(leg);
    legs.push(leg);
    const arm = instantiateBaked(explorerArmParts, side < 0 ? 'Left arm' : 'Right arm', materials);
    arm.position.set(side * 0.212, 0.703, 0);
    arm.rotation.z = side * 0.09;
    group.add(arm);
    arms.push(arm);
  }
  const cream = materials.get(palette.cream), accent = materials.get(palette.ochre);
  const coat = materials.get(palette.navy), leather = materials.get(palette.brown);
  const outfits = {};
  for (const lineage of ['explorer', 'maker', 'sage', 'ranger']) {
    const outfit = new THREE.Group(); outfit.name = `Lineage: ${lineage}`;
    group.add(outfit); outfits[lineage] = outfit;
    if (lineage === 'explorer') {
      mesh(outfit, primitive.cylinder, cream, [0, 1.007, 0.015], [0.28, 0.043, 0.235]);
      mesh(outfit, new THREE.CylinderGeometry(0.125, 0.198, 0.157, 8), cream, [0, 1.105, 0.004]);
      mesh(outfit, primitive.cylinder, accent, [0, 1.045, 0.004], [0.199, 0.042, 0.199]);
    } else if (lineage === 'maker') {
      mesh(outfit, new THREE.SphereGeometry(0.185, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), accent, [0, 0.982, 0]);
      mesh(outfit, primitive.cube, leather, [0, 1.01, 0.172], [0.3, 0.066, 0.052]);
      for (const side of [-1, 1]) mesh(outfit, primitive.cylinder, cream, [side * 0.085, 1.01, 0.205], [0.063, 0.034, 0.063], [Math.PI / 2, 0, 0]);
      mesh(outfit, primitive.cube, accent, [0, 0.548, 0.143], [0.23, 0.22, 0.038]);
    } else if (lineage === 'sage') {
      mesh(outfit, new THREE.ConeGeometry(0.215, 0.43, 5), cream, [0, 1.16, -0.022], [1, 1, 1], [0, 0, -0.15]);
      mesh(outfit, primitive.cylinder, accent, [0, 0.999, 0], [0.238, 0.054, 0.22]);
      mesh(outfit, new THREE.ConeGeometry(0.25, 0.45, 5, 1, true), coat, [0, 0.49, -0.12], [1, 1, 0.8]);
      mesh(outfit, primitive.diamond, accent, [0, 0.723, 0.17], [0.06, 0.082, 0.028]);
    } else {
      mesh(outfit, new THREE.ConeGeometry(0.225, 0.22, 4), cream, [0, 1.04, -0.015], [1, 1, 1], [0, Math.PI / 4, 0]);
      mesh(outfit, primitive.diamond, accent, [0.16, 1.17, -0.015], [0.054, 0.20, 0.026], [0, 0, -0.35]);
      mesh(outfit, new THREE.ConeGeometry(0.26, 0.34, 6, 1, true), cream, [0, 0.60, -0.09], [1, 1, 0.85]);
    }
  }
  // Only assigned Skills produce carried cards; the shared library never does.
  const carried = new THREE.Group(); carried.name = 'Equipped Skill cards';
  group.add(carried);
  for (let index = 0; index < 3; index += 1) {
    const smallCard = new THREE.Group(); carried.add(smallCard);
    smallCard.position.set(0.25 + index * 0.035, 0.58, 0.13 + index * 0.018);
    smallCard.rotation.z = -0.18 + index * 0.18;
    mesh(smallCard, primitive.cube, cream, [0, 0, 0], [0.15, 0.22, 0.013]);
    mesh(smallCard, primitive.diamond, accent, [0, 0.01, 0.012], [0.04, 0.06, 0.012]);
  }
  const defaultAppearance = { lineage: 'explorer', coat: '#324b64', accent: '#d89c3a', hat: '#f0deb7' };
  function setAppearance(appearance = defaultAppearance) {
    const lineage = Object.hasOwn(outfits, appearance.lineage) ? appearance.lineage : 'explorer';
    for (const [name, outfit] of Object.entries(outfits)) outfit.visible = name === lineage;
    for (const [mat, value, fallback] of [[coat, appearance.coat, defaultAppearance.coat], [accent, appearance.accent, defaultAppearance.accent], [cream, appearance.hat, defaultAppearance.hat]]) {
      mat.color.set(/^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback);
    }
    group.userData.lineage = lineage;
  }
  function setEquipment(count = 0) {
    const visible = Math.max(0, Math.min(3, Number.isFinite(count) ? Math.floor(count) : 0));
    carried.children.forEach((item, index) => { item.visible = index < visible; });
    group.userData.equippedCount = count;
  }
  setAppearance(); setEquipment();
  // Unused cloned materials are not in the scene graph and are disposed here.
  const used = new Set(); group.traverse(item => { if (item.material) used.add(item.material); });
  for (const mat of materials.values()) if (!used.has(mat)) mat.dispose();
  function animateWalk(phase, moving) {
    const swing = moving ? Math.sin(phase) * 0.48 : 0;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
    arms[0].rotation.x = -swing * 0.64;
    arms[1].rotation.x = swing * 0.64;
    body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.023 : 0;
  }
  return { group, animateWalk, setAppearance, setEquipment };
}

// Scene instances share actor buffers only for the lifetime of one engine.
// Engine disposal calls this after disposing scene resources.
export function disposeActorResources() {
  const geometries = new Set(Object.values(primitive || {}));
  if (crystalGeometry) geometries.add(crystalGeometry);
  for (const parts of [relicParts, explorerBodyParts, explorerLegParts, explorerArmParts]) {
    for (const part of parts || []) geometries.add(part.geometry);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const mat of Object.values(palette || {})) mat.dispose();
  palette = primitive = crystalGeometry = undefined;
  relicParts = explorerBodyParts = explorerLegParts = explorerArmParts = undefined;
}
