import * as THREE from 'three';

/** Procedural, texture-free toy garden. All coordinates use Y up. */
export function createWorld() {
  const group = new THREE.Group();
  group.name = 'toy-wilds-world';
  const colliders = [];
  const animated = [];
  let seed = 4179;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.94, metalness: 0, flatShading: true, ...extra,
  });
  const m = {
    ground: material('#C77B52'), clay: material('#D88754'), sand: material('#E8AC66'),
    path: material('#F1BF78'), stone: material('#7E8991'), stoneLight: material('#A3A6A5'),
    stoneDark: material('#646C78'), ivory: material('#F7DBA7'), ivoryDark: material('#D5B685'),
    trunk: material('#74513C'), wood: material('#896249'), woodCap: material('#B78558'),
    leaf: material('#E96E35'), leafRed: material('#D95530'), leafGold: material('#E7A642'),
    grass: material('#E7B943'), teal: material('#32A59F'), tealDark: material('#168A91'),
    belly: material('#EDDBAB'), eyes: material('#173C3B'), white: material('#FFF1D2'),
    coral: material('#E36B42'), metal: material('#544B43'), lily: material('#9CB164'),
    glass: material('#FFC369', { emissive: '#FF9B38', emissiveIntensity: 0.9, roughness: 0.55 }),
    water: material('#FFFFFF', { roughness: 0.34, metalness: 0.12, vertexColors: true }),
    fall: material('#70D4CE', { roughness: 0.35, metalness: 0.04 }),
    foam: material('#C1EECE', { roughness: 0.6 }),
  };
  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1), rock: new THREE.IcosahedronGeometry(1, 0),
    leaf: new THREE.IcosahedronGeometry(1, 1), cylinder: new THREE.CylinderGeometry(1, 1, 1, 7),
    cone: new THREE.ConeGeometry(1, 1, 4), sphere: new THREE.IcosahedronGeometry(1, 1),
  };
  const named = (name, parent = group) => {
    const g = new THREE.Group(); g.name = name; parent.add(g); return g;
  };
  const mesh = (geometry, mat, parent, position = [0, 0, 0], scale = [1, 1, 1], shadow = true) => {
    const obj = new THREE.Mesh(geometry, mat);
    obj.position.set(...position); obj.scale.set(...scale);
    obj.castShadow = shadow; obj.receiveShadow = true;
    parent.add(obj); return obj;
  };
  const instances = (name, geometry, mat, transforms, parent, castShadow = false) => {
    const obj = new THREE.InstancedMesh(geometry, mat, transforms.length);
    const dummy = new THREE.Object3D();
    transforms.forEach((t, i) => {
      dummy.position.set(...t.p); dummy.rotation.set(...(t.r || [0, 0, 0]));
      dummy.scale.set(...t.s); dummy.updateMatrix(); obj.setMatrixAt(i, dummy.matrix);
      if (t.c) obj.setColorAt(i, new THREE.Color(t.c));
    });
    obj.name = name; obj.castShadow = castShadow; obj.receiveShadow = true;
    obj.instanceMatrix.needsUpdate = true;
    if (obj.instanceColor) obj.instanceColor.needsUpdate = true;
    parent.add(obj); return obj;
  };

  // Ground remains level beyond the garden; the raised edges are scenery.
  const terrain = named('terracotta-terrain');
  mesh(new THREE.PlaneGeometry(160, 160), m.ground, terrain, [0, -0.045, 0], [1, 1, 1], false).rotation.x = -Math.PI / 2;
  mesh(new THREE.CylinderGeometry(19.7, 20, 0.18, 12), m.clay, terrain, [0, -0.11, 0], [1, 1, 1], false);

  // The branching route is built as a quiet sand ribbon with irregular paving.
  const paths = named('branching-stone-paths');
  const routes = [
    [[0, 15], [0, 10], [-0.7, 6], [-0.4, 3], [0.8, 2]],
    [[-0.4, 5.3], [-4, 4.9], [-8, 3.7], [-10, 0], [-10.6, -5], [-9, -10]],
    [[-0.2, 6.7], [4, 6.2], [8.5, 4.9], [11.5, 1.5], [12, -4.5]],
    [[-2.6, 4.8], [-3, 0.7], [-2.8, -3], [-3.2, -7.5], [-0.7, -12.3]],
  ];
  const paving = [];
  routes.forEach((points, routeIndex) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i], [x2, z2] = points[i + 1];
      const dx = x2 - x1, dz = z2 - z1, length = Math.hypot(dx, dz);
      const a = Math.atan2(dx, dz), width = routeIndex === 0 ? 2.5 : 2.1;
      const base = mesh(geo.box, m.sand, paths, [(x1 + x2) / 2, 0.018, (z1 + z2) / 2], [width, 0.024, length + 0.35], false);
      base.rotation.y = a;
      const rows = Math.ceil(length / 0.75);
      for (let row = 0; row < rows; row++) {
        const t = (row + 0.5) / rows;
        for (let col = 0; col < 3; col++) {
          const side = (col - 1) * width / 3;
          paving.push({
            p: [x1 + dx * t + Math.cos(a) * side, 0.049, z1 + dz * t - Math.sin(a) * side],
            s: [width / 3 - 0.06 - random() * 0.07, 0.045 + random() * 0.015, length / rows - 0.085],
            r: [0, a + (random() - 0.5) * 0.07, 0],
            c: ['#F0B96F', '#E5A861', '#F5C580', '#EBAE67'][Math.floor(random() * 4)],
          });
        }
      }
    }
  });
  instances('individual-ochre-pavers', geo.box, m.white, paving, paths);

  const pond = named('crescent-pond');
  const pondX = 5, pondZ = -4, pondRadius = 3.65;
  const waterPositions = [], waterColors = [], color = new THREE.Color();
  const sectors = 36, radialSteps = 6;
  const addWaterTriangle = (a, b, c, shade) => {
    waterPositions.push(...a, ...b, ...c); color.set(shade);
    for (let k = 0; k < 3; k++) waterColors.push(color.r, color.g, color.b);
  };
  const polar = (r, a) => [pondX + Math.cos(a) * r, 0.067, pondZ + Math.sin(a) * r];
  const waterPalette = ['#36B0AC', '#3CBBB5', '#43C1B9', '#31ABA9', '#4AC4BC'];
  for (let ring = 0; ring < radialSteps; ring++) {
    for (let s = 0; s < sectors; s++) {
      const r1 = pondRadius * ring / radialSteps, r2 = pondRadius * (ring + 1) / radialSteps;
      const a1 = s / sectors * Math.PI * 2, a2 = (s + 1) / sectors * Math.PI * 2;
      addWaterTriangle(polar(r1, a1), polar(r2, a2), polar(r2, a1), waterPalette[Math.floor(random() * 5)]);
      if (ring > 0) addWaterTriangle(polar(r1, a1), polar(r1, a2), polar(r2, a2), waterPalette[Math.floor(random() * 5)]);
    }
  }
  const waterGeometry = new THREE.BufferGeometry();
  waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
  waterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
  waterGeometry.computeVertexNormals();
  mesh(new THREE.CylinderGeometry(3.87, 3.96, 0.15, 36), m.tealDark, pond, [pondX, -0.008, pondZ], [1, 1, 1], false);
  mesh(waterGeometry, m.water, pond, [0, 0, 0], [1, 1, 1], false).name = 'faceted-teal-water';
  colliders.push({ x: pondX, z: pondZ, r: 3.8 });

  // A radial annular sector, with real thickness and readable low-poly faces.
  function arcGeometry(radius, width, start, sweep, height, segments = 36) {
    const p = [], idx = [];
    for (let i = 0; i <= segments; i++) {
      const a = start + sweep * i / segments;
      for (const y of [0, height]) {
        for (const r of [radius - width / 2, radius + width / 2]) p.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < segments; i++) {
      const n = i * 4, t = n + 4;
      idx.push(n + 2, t + 2, n + 3, n + 3, t + 2, t + 3);
      idx.push(n, n + 1, t, n + 1, t + 1, t);
      idx.push(n, t, n + 2, n + 2, t, t + 2);
      idx.push(n + 1, n + 3, t + 1, n + 3, t + 3, t + 1);
    }
    const e = segments * 4;
    idx.push(0, 2, 1, 1, 2, 3, e, e + 1, e + 2, e + 1, e + 3, e + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const channelRings = named('three-ivory-crescent-channels', pond);
  [2.86, 2.09, 1.32].forEach((radius, i) => {
    const arc = mesh(arcGeometry(radius, 0.25, 2.92 + i * 0.06, 4.73, 0.15), m.ivory, channelRings, [pondX, 0.055, pondZ]);
    arc.name = `ivory-crescent-${i + 1}`;
    const inlay = mesh(arcGeometry(radius, 0.052, 2.95 + i * 0.06, 4.68, 0.012), m.ivoryDark, channelRings, [pondX, 0.207, pondZ], [1, 1, 1], false);
    inlay.name = `crescent-carved-inlay-${i + 1}`;
  });
  const bridge = named('coral-channel-bridge', pond);
  const bridgeAngle = 2.17;
  bridge.position.set(pondX + Math.cos(bridgeAngle) * 2.12, 0.27, pondZ + Math.sin(bridgeAngle) * 2.12);
  bridge.rotation.y = -bridgeAngle;
  mesh(geo.box, m.wood, bridge, [0, -0.1, 0], [2.04, 0.1, 0.56]);
  for (let i = 0; i < 7; i++) mesh(geo.box, m.coral, bridge, [-0.9 + i * 0.3, 0, 0], [0.27, 0.13, 0.67]);

  const shore = named('polygon-shore-rocks', pond);
  const shoreRocks = [];
  for (let i = 0; i < 25; i++) {
    const a = i / 25 * Math.PI * 2;
    const radius = 3.73 + random() * 0.08;
    shoreRocks.push({ p: [pondX + Math.cos(a) * radius, 0.14 + random() * 0.2, pondZ + Math.sin(a) * radius], s: [0.48 + random() * 0.17, 0.38 + random() * 0.27, 0.44 + random() * 0.12], r: [random() * 0.3, a, 0.12], c: ['#929AA4', '#7E8B99', '#A3A8AA'][i % 3] });
  }
  instances('shoreline-faceted-stones', geo.rock, m.white, shoreRocks, shore, true);

  const cliffs = named('rear-rock-edge-and-cascade');
  const cliffPositions = [
    [0.9, -9.5, 1.1, 1.1], [2.5, -9.2, 1.4, 1.65], [4.1, -8.9, 1.15, 1.7],
    [5.9, -9.2, 1.3, 2], [7.5, -8.8, 1.5, 1.6], [9, -9.1, 1.1, 1.15],
    [8.8, -7.7, 0.95, 0.7], [2.4, -7.8, 0.8, 0.65],
  ];
  cliffPositions.forEach(([x, z, radius, height], i) => {
    const rock = mesh(geo.rock, i % 3 === 0 ? m.stoneLight : m.stone, cliffs, [x, height * 0.68, z], [radius, height, radius * 0.8]);
    rock.rotation.set(0.1, i * 0.87, -0.1); colliders.push({ x, z, r: radius * 0.82 });
  });
  const fallGroup = named('small-terraced-waterfall', cliffs);
  [[5.1, 1.79, -8.42, 0.94, 0.2, 0.85], [5.1, 1.08, -7.96, 0.83, 1.22, 0.16], [5.1, 0.41, -7.74, 1.13, 0.16, 0.55], [5.1, 0.22, -7.43, 1.05, 0.38, 0.12]].forEach(t => mesh(geo.box, m.fall, fallGroup, t.slice(0, 3), t.slice(3), false));
  const fallStreaks = [];
  for (let i = 0; i < 6; i++) fallStreaks.push({ p: [4.78 + i * 0.13, 1.05 + random() * 0.13, -7.865], s: [0.029, 0.7 + random() * 0.2, 0.015], c: i % 2 ? '#B0E8D8' : '#89DFD4' });
  instances('waterfall-silk-streaks', geo.box, m.white, fallStreaks, fallGroup);
  const foamPatches = [];
  for (let i = 0; i < 16; i++) foamPatches.push({ p: [4.43 + random() * 1.37, 0.079, -7.49 + random() * 0.54], s: [0.07 + random() * 0.14, 0.013, 0.07 + random() * 0.11] });
  instances('cascade-foam', geo.cylinder, m.foam, foamPatches, fallGroup);

  const lilies = [];
  [[7.2, -5.4], [7.7, -3.5], [3.2, -5.5], [6.3, -1.6], [4.3, -6.8], [2.15, -3.8]].forEach(([x, z], i) => {
    lilies.push({ p: [x, 0.104, z], s: [0.22 + i % 2 * 0.07, 0.065, 0.18 + i % 3 * 0.025], r: [0, i, 0] });
  });
  instances('polygon-lily-pads', geo.cylinder, m.lily, lilies, pond);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: '#B5E9CD', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  [[6.65, -5.05, 0.58], [5.1, -7.15, 0.36], [3.3, -3.7, 0.28]].forEach(([x, z, radius], i) => {
    const ripple = mesh(new THREE.RingGeometry(radius, radius + 0.018, 24, 1, 0.1, Math.PI * 1.55), rippleMaterial.clone(), pond, [x, 0.083 + i * 0.002, z], [1, 1, 1], false);
    ripple.rotation.x = -Math.PI / 2; animated.push({ kind: 'ripple', obj: ripple, phase: i * 1.9 });
  });

  // The pedestal remains comfortably reachable from the arrival path.
  const pedestal = named('equipment-pedestal');
  pedestal.position.set(1, 0, 1);
  mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.02, 12), m.sand, pedestal, [0, 0.022, 0], [1, 1, 1], false);
  mesh(new THREE.CylinderGeometry(1.02, 1.14, 0.25, 10), m.stoneLight, pedestal, [0, 0.125, 0]);
  mesh(new THREE.CylinderGeometry(0.92, 1.02, 0.18, 10), m.ivoryDark, pedestal, [0, 0.34, 0]);
  mesh(new THREE.CylinderGeometry(0.9, 0.94, 0.22, 12), m.ivory, pedestal, [0, 0.54, 0]);
  mesh(new THREE.CylinderGeometry(0.59, 0.59, 0.008, 24), m.ivoryDark, pedestal, [0, 0.646, 0], [1, 1, 1], false);
  mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.01, 24), m.ivory, pedestal, [0, 0.645, 0], [1, 1, 1], false);
  [[0, 0.09, 1.11, 1.12, 0.18, 0.46], [0, 0.19, 0.84, 1.2, 0.16, 0.48]].forEach(t => mesh(geo.box, m.stoneLight, pedestal, t.slice(0, 3), t.slice(3)));
  colliders.push({ x: 1, z: 1, r: 0.75 });

  // A small, curious pond spirit: soft proportions, angular silhouette.
  const guardian = named('friendly-pond-serpent-guardian', pond);
  guardian.position.set(6.65, 0, -5.05); guardian.rotation.y = 0.3;
  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.12, 0.03, -0.22), new THREE.Vector3(-0.29, 0.35, -0.19),
    new THREE.Vector3(-0.15, 0.9, 0.01), new THREE.Vector3(0.03, 1.42, 0.09),
    new THREE.Vector3(0.03, 1.75, 0.39),
  ]);
  mesh(new THREE.TubeGeometry(neckCurve, 12, 0.25, 6, false), m.teal, guardian);
  const bellyCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.13, 0.08, 0.01), new THREE.Vector3(-0.24, 0.38, 0.035),
    new THREE.Vector3(-0.12, 0.92, 0.24), new THREE.Vector3(0.02, 1.38, 0.32),
    new THREE.Vector3(0.03, 1.67, 0.53),
  ]);
  mesh(new THREE.TubeGeometry(bellyCurve, 9, 0.16, 4, false), m.belly, guardian);
  const head = mesh(geo.rock, m.teal, guardian, [0.03, 1.86, 0.5], [0.4, 0.33, 0.54]);
  head.rotation.x = -0.12;
  mesh(geo.rock, m.belly, guardian, [0.03, 1.7, 0.8], [0.29, 0.15, 0.28]);
  mesh(geo.rock, m.tealDark, guardian, [0.03, 1.84, 0.86], [0.29, 0.18, 0.21]);
  [-1, 1].forEach(side => {
    mesh(geo.sphere, m.white, guardian, [side * 0.295 + 0.03, 1.94, 0.66], [0.074, 0.092, 0.061], false);
    mesh(geo.sphere, m.eyes, guardian, [side * 0.315 + 0.03, 1.94, 0.695], [0.045, 0.061, 0.038], false);
    mesh(geo.sphere, m.white, guardian, [side * 0.314 + 0.026, 1.968, 0.721], [0.013, 0.017, 0.01], false);
    const horn = mesh(geo.cone, m.ivory, guardian, [side * 0.2 + 0.03, 2.18, 0.36], [0.105, 0.42, 0.105]);
    horn.rotation.set(-0.4, 0, side * -0.28);
    const fin = mesh(geo.cone, m.tealDark, guardian, [side * 0.39, 0.32, -0.13], [0.13, 0.42, 0.23]);
    fin.rotation.z = side * 0.8;
  });
  for (let i = 0; i < 4; i++) {
    const spine = mesh(geo.cone, m.ivoryDark, guardian, [-0.16 + i * 0.054, 0.7 + i * 0.27, -0.2], [0.12, 0.25, 0.13]);
    spine.rotation.x = -0.5;
  }
  const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.2, 0.03, -0.27), new THREE.Vector3(-0.65, 0.08, -0.46), new THREE.Vector3(-0.99, 0.29, -0.72), new THREE.Vector3(-1.21, 0.12, -0.84)]);
  mesh(new THREE.TubeGeometry(tailCurve, 8, 0.18, 5, false), m.tealDark, guardian);
  animated.push({ kind: 'guardian', obj: guardian, baseY: guardian.position.y });

  const grove = named('autumn-polygon-grove');
  const treePositions = [[-7.4, 1.4, 1], [-12, -3.3, 1.12], [-6.4, -8.8, 1.16], [-11.4, 8.8, 0.98], [11.7, 7.7, 1.03], [12.6, -5.5, 1.16], [9.4, -12, 1.06], [-1.4, -13.6, 1.1], [-14.2, 3.4, 0.85]];
  treePositions.forEach(([x, z, scale], index) => {
    const tree = named(`coral-tree-${index + 1}`, grove); tree.position.set(x, 0, z); tree.scale.setScalar(scale);
    const trunk = mesh(geo.cylinder, m.trunk, tree, [0, 1.05, 0], [0.23, 2.1, 0.26]); trunk.rotation.z = index % 2 ? 0.055 : -0.07;
    [-1, 1].forEach(side => {
      const branch = mesh(geo.cylinder, m.trunk, tree, [side * 0.27, 1.77, 0], [0.11, 0.95, 0.13]); branch.rotation.z = side * -0.64;
    });
    [[0, 2.8, 0, 1.15, 1.25, 1.03], [-0.72, 2.38, 0.08, 0.79, 0.85, 0.76], [0.7, 2.53, -0.09, 0.85, 0.99, 0.86], [0.09, 3.48, -0.01, 0.66, 0.66, 0.64]].forEach((t, i) => {
      const crown = mesh(geo.leaf, (index + i) % 4 === 0 ? m.leafRed : (index + i) % 5 === 0 ? m.leafGold : m.leaf, tree, t.slice(0, 3), t.slice(3));
      crown.rotation.y = index + i * 0.81;
    });
    const roots = [];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + index;
      roots.push({ p: [Math.cos(a) * 0.23, 0.12, Math.sin(a) * 0.23], s: [0.13, 0.24, 0.39], r: [0, -a + Math.PI / 2, 0] });
    }
    instances(`tree-root-${index}`, geo.rock, m.trunk, roots, tree, true);
    colliders.push({ x, z, r: 0.45 * scale });
  });

  const edge = named('raised-garden-rock-edges');
  const edgeRocks = [];
  for (let i = 0; i < 29; i++) {
    const a = Math.PI + i / 28 * Math.PI;
    const x = Math.cos(a) * (14.6 + random()), z = Math.sin(a) * (14.5 + random());
    const r = 0.65 + random() * 0.85, h = 0.5 + random() * 0.8;
    edgeRocks.push({ p: [x, h * 0.53, z], s: [r, h, r * 0.85], r: [0.08, a * 3, 0.12], c: i % 2 ? '#9B9693' : '#A5A19A' });
    colliders.push({ x, z, r: r * 0.82 });
  }
  instances('rear-border-boulders', geo.rock, m.white, edgeRocks, edge, true);

  const fences = named('low-timber-fences');
  function fence(x, z, length, angle) {
    const f = named('fence-section', fences); f.position.set(x, 0, z); f.rotation.y = angle;
    for (const offset of [-length / 2, 0, length / 2]) {
      mesh(geo.box, m.wood, f, [offset, 0.47, 0], [0.17, 0.94, 0.19]);
      mesh(geo.box, m.woodCap, f, [offset, 0.95, 0], [0.21, 0.06, 0.23]);
    }
    for (const y of [0.35, 0.73]) mesh(geo.box, m.wood, f, [0, y, 0], [length, 0.13, 0.13]);
    const count = Math.ceil(length / 0.5);
    for (let i = 0; i <= count; i++) {
      const localX = -length / 2 + i * length / count;
      colliders.push({ x: x + Math.cos(angle) * localX, z: z - Math.sin(angle) * localX, r: 0.24 });
    }
  }
  fence(-6.3, 8.1, 3.7, -0.16); fence(7.1, 9.2, 4, 0.19);
  fence(-10.9, -6.5, 3.2, -1.3); fence(11.8, -0.8, 2.9, -1.32);

  const lanterns = named('warm-stone-lanterns');
  [[-1.65, 2.7], [3.05, 2.28], [-8.4, 1], [9.55, 3.6], [-3.8, -6]].forEach(([x, z], i) => {
    const l = named(`lantern-${i + 1}`, lanterns); l.position.set(x, 0, z);
    mesh(geo.cylinder, m.stoneLight, l, [0, 0.2, 0], [0.32, 0.4, 0.32]);
    mesh(geo.box, m.metal, l, [0, 0.45, 0], [0.34, 0.1, 0.34]);
    mesh(geo.box, m.glass, l, [0, 0.68, 0], [0.235, 0.39, 0.235], false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(geo.box, m.metal, l, [sx * 0.13, 0.68, sz * 0.13], [0.045, 0.46, 0.045]);
    mesh(geo.cone, m.metal, l, [0, 0.96, 0], [0.32, 0.2, 0.32]);
    mesh(geo.sphere, m.metal, l, [0, 1.115, 0], [0.055, 0.075, 0.055]);
    colliders.push({ x, z, r: 0.33 });
  });

  // Grass, fallen leaves, pebble chips and tiny flowers are four shared batches.
  const details = named('golden-grass-and-wildflowers');
  const grass = [], petals = [], flowerCenters = [], pebbles = [], fallenLeaves = [];
  const grassClumps = [[-5.8, 2.1], [-7.9, 3.1], [-9.1, 7.5], [-4.2, 7.6], [4.7, 8.8], [8.7, 7.4], [10.1, 5.6], [10.4, -4], [-4.4, -4], [-5.5, -7.4], [-1, -10.3], [1.3, -8.6], [8.7, -10.6], [11.5, -8.7], [2.3, 0.2], [-0.8, -0.9], [1.7, -4.4], [8.8, -1.4], [6.8, 0.7], [-12.5, 5.3], [-13, -5.6], [11.8, 10.3], [-11.6, 11.6]];
  grassClumps.forEach(([x, z], i) => {
    for (let blade = 0; blade < 8; blade++) {
      const a = blade * 2.399 + i, h = 0.35 + random() * 0.5;
      grass.push({ p: [x + Math.cos(a) * 0.18, h * 0.43, z + Math.sin(a) * 0.18], s: [0.12 + random() * 0.06, h, 0.085], r: [Math.cos(a) * 0.42, a, Math.sin(a) * 0.42], c: ['#E8B835', '#F1C54D', '#D99E2F'][blade % 3] });
    }
    for (let flower = 0; flower < 3; flower++) {
      const fx = x + 0.45 + random() * 0.35, fz = z - 0.5 + random() * 0.65;
      flowerCenters.push({ p: [fx, 0.12, fz], s: [0.051, 0.04, 0.051] });
      for (let petal = 0; petal < 5; petal++) {
        const a = petal / 5 * Math.PI * 2;
        petals.push({ p: [fx + Math.cos(a) * 0.073, 0.115, fz + Math.sin(a) * 0.073], s: [0.056, 0.027, 0.055] });
      }
    }
  });
  for (let i = 0; i < 100; i++) {
    const x = (random() - 0.5) * 28, z = (random() - 0.5) * 28;
    if (Math.hypot(x - pondX, z - pondZ) < 4.3 || Math.hypot(x - 1, z - 1) < 1.8) continue;
    pebbles.push({ p: [x, 0.06, z], s: [0.055 + random() * 0.1, 0.055 + random() * 0.08, 0.075 + random() * 0.1], r: [0, random() * 6, 0], c: i % 3 ? '#D8AB76' : '#C9B18C' });
  }
  treePositions.forEach(([x, z]) => {
    for (let i = 0; i < 15; i++) {
      const a = random() * Math.PI * 2, r = 0.6 + random() * 1.3;
      fallenLeaves.push({ p: [x + Math.cos(a) * r, 0.034, z + Math.sin(a) * r], s: [0.1, 0.022, 0.065], r: [0, random() * 6, 0], c: i % 3 === 0 ? '#F2C455' : '#E6903F' });
    }
  });
  instances('faceted-golden-grass', geo.cone, m.white, grass, details);
  instances('cream-wildflower-petals', geo.sphere, m.ivory, petals, details);
  instances('wildflower-gold-centers', geo.sphere, m.grass, flowerCenters, details);
  instances('scattered-pebbles', geo.rock, m.white, pebbles, details);
  instances('fallen-autumn-leaves', geo.rock, m.white, fallenLeaves, details);

  return {
    group, colliders, spawn: { x: 0, z: 9 }, pickup: { x: 1, z: 1 },
    bounds: { minX: -17, maxX: 17, minZ: -17, maxZ: 17 },
    update(time, { active = true, reducedMotion = false } = {}) {
      if (!active || reducedMotion) return;
      animated.forEach(({ kind, obj, phase = 0, baseY = 0 }) => {
        if (kind === 'guardian') obj.position.y = baseY + Math.sin(time * 1.05) * 0.045;
        if (kind === 'ripple') {
          const cycle = (time * 0.24 + phase) % 1;
          obj.scale.setScalar(0.87 + cycle * 0.42);
          obj.material.opacity = 0.28 * Math.sin(cycle * Math.PI);
        }
      });
    },
  };
}
