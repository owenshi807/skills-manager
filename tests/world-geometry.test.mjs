import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/features/toy-wilds/world.js';

const world = createWorld();
world.group.updateMatrixWorld(true);
const pond = world.group.getObjectByName('crescent-pond');
const water = world.group.getObjectByName('faceted-teal-water');
const basin = pond.children.find(item => item.isMesh && item.geometry.type === 'CylinderGeometry');
const bounds = mesh => new THREE.Box3().setFromObject(mesh);
const waterBounds = bounds(water);
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const pondCenter = waterBounds.getCenter(new THREE.Vector3());
const waterRadius = (waterBounds.max.x - waterBounds.min.x) / 2;

after(() => {
  const geometries = new Set(), materials = new Set();
  world.group.traverse(item => {
    if (item.geometry) geometries.add(item.geometry);
    if (item.material) for (const material of Array.isArray(item.material) ? item.material : [item.material]) materials.add(material);
    if (item.isInstancedMesh) item.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
});

test('pond floor has physical depth beneath a single level water surface', () => {
  assert.ok(waterBounds.max.y - waterBounds.min.y < 1e-6, 'the calm water surface must stay level');
  assert.ok(waterBounds.min.y - bounds(basin).max.y >= 0.025, 'the basin top must be at least 0.025 world units below water, not coplanar');
  assert.equal(water.material.depthTest, true);
  assert.equal(water.material.depthWrite, true);
  assert.equal(water.material.polygonOffset, false, 'layering must come from geometry, not a depth offset');
  assert.equal(water.renderOrder, 0, 'layering must not depend on forced render order');
});

test('sampled water and basin hits remain separate across the whole pond', () => {
  for (const fraction of [0.12, 0.37, 0.64, 0.91]) {
    for (let sector = 0; sector < 13; sector += 1) {
      const angle = sector * Math.PI * 2 / 13 + 0.137;
      ray.set(new THREE.Vector3(pondCenter.x + Math.cos(angle) * waterRadius * fraction, 5, pondCenter.z + Math.sin(angle) * waterRadius * fraction), down);
      const hits = ray.intersectObjects([water, basin], false);
      assert.equal(hits.length, 2, 'every sampled column must hit one water face and one basin cap');
      assert.ok(hits[0].object === water, 'water must be the nearest surface');
      assert.ok(hits[1].object === basin, 'the basin must be behind the water');
      assert.ok(hits[0].point.y - hits[1].point.y >= 0.025, 'near-equal depth will reintroduce fan-shaped z-fighting');
    }
  }
});

test('water triangles tile the pond once and share continuous colors at their seams', () => {
  const positions = water.geometry.getAttribute('position');
  const colors = water.geometry.getAttribute('color');
  const seen = new Map();
  let area = 0, sharedVertices = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, i);
    const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
    const normal = b.sub(a).cross(c.sub(a));
    assert.ok(normal.y > 1e-6, 'water triangles must have nonzero area and face upward');
    area += normal.y / 2;
  }
  assert.ok(Math.abs(area / (Math.PI * waterRadius ** 2) - 1) < 0.01, 'triangles must cover one disk without duplicate caps or holes');
  for (let i = 0; i < positions.count; i += 1) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(value => value.toFixed(5)).join(',');
    const current = [colors.getX(i), colors.getY(i), colors.getZ(i)];
    const previous = seen.get(key);
    if (previous) {
      sharedVertices += 1;
      assert.ok(current.every((value, component) => Math.abs(value - previous[component]) < 1e-6), 'adjacent water triangles must not create artificial colored fans');
    } else seen.set(key, current);
  }
  assert.ok(sharedVertices > 100, 'the test must cover actual shared water seams');
});

test('pedestal ornament is attached in three distinct solid tiers', () => {
  const pedestal = world.group.getObjectByName('equipment-pedestal');
  const cylinders = pedestal.children.filter(item => item.isMesh && item.geometry.type === 'CylinderGeometry');
  const crown = cylinders.find(item => item.geometry.parameters.radiusTop === 0.9);
  const ring = cylinders.find(item => item.geometry.parameters.radiusTop === 0.59);
  const center = cylinders.find(item => item.geometry.parameters.radiusTop === 0.53);
  const layers = [crown, ring, center].map(bounds);
  for (let i = 1; i < layers.length; i += 1) {
    assert.ok(layers[i].max.y - layers[i - 1].max.y >= 0.015, 'nested caps must have visibly distinct top heights');
    assert.ok(layers[i].min.y < layers[i - 1].max.y, 'raised details must attach to the supporting solid rather than float');
  }
  assert.ok(layers[2].max.y < 0.73, 'the ornament must preserve the original low pedestal silhouette');
  for (const mesh of [crown, ring, center]) {
    assert.equal(mesh.material.polygonOffset, false);
    assert.equal(mesh.material.depthTest, true);
    assert.equal(mesh.renderOrder, 0);
  }
});

test('animated ripples stay above water and respect solid occlusion for two cycles', () => {
  const ripples = pond.children.filter(item => item.isMesh && item.geometry.type === 'RingGeometry');
  assert.equal(ripples.length, 3);
  const initialY = ripples.map(item => item.position.y);
  for (let frame = 0; frame <= 520; frame += 1) {
    world.update(frame / 60);
    world.group.updateMatrixWorld(true);
    for (const [index, ripple] of ripples.entries()) {
      assert.ok(bounds(ripple).min.y - waterBounds.max.y >= 0.015, 'a growing ripple must not collide with the water plane');
      assert.equal(ripple.position.y, initialY[index], 'only ripple radius and opacity should animate');
      assert.equal(ripple.material.transparent, true);
      assert.equal(ripple.material.depthWrite, false, 'transparent ripples must not occlude later transparent surfaces');
      assert.equal(ripple.material.depthTest, true, 'raised ivory channels and banks must still occlude ripples');
      assert.equal(ripple.material.polygonOffset, false);
      assert.ok(ripple.material.opacity >= 0 && ripple.material.opacity <= 0.28);
    }
  }
});
