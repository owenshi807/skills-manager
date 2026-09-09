import * as THREE from 'three';
import { createWorld } from './world.js';
import { createRelic, createExplorer, disposeActorResources } from './actors.js';
import { createNavigation } from './navigation.js';
import { createCard } from './card.js';
import { createInventory } from './inventory.js';

const debug = {
  mounts: 0, disposals: 0, activeEngines: 0, activeAnimationFrames: 0,
  activeListeners: 0, activeObservers: 0, liveGeometries: 0, liveMaterials: 0, liveTextures: 0,
};
let activeEngine = null;
export const readEngineDebug = () => ({ ...debug });

function collectResources(scenes) {
  const geometry = new Set(), material = new Set(), texture = new Set();
  for (const scene of scenes) scene.traverse(item => {
    if (item.geometry) geometry.add(item.geometry);
    for (const mat of Array.isArray(item.material) ? item.material : item.material ? [item.material] : []) {
      material.add(mat);
      for (const value of Object.values(mat)) if (value?.isTexture) texture.add(value);
      for (const uniform of Object.values(mat.uniforms || {})) if (uniform.value?.isTexture) texture.add(uniform.value);
    }
  });
  return { geometry, material, texture };
}

/** One engine owns its DOM listeners, GPU resources, observers and frame loop. */
export function mountToyWilds({ root, canvas, readInventory, readDocument, onManageScene, sceneId, sceneName }) {
  if (activeEngine) throw new Error('另一片旷野尚未退出，请先返回工作台。');
  const $ = id => root.querySelector(`#${id}`);
  let renderer = null, inventory = null, frame = 0, disposed = false, observer = null;
  let resources = null, rendererSize = { width: 0, height: 0 };
  const scenes = [], removers = [];
  const oldMode = root.getAttribute('data-mode');
  const previousText = Object.getOwnPropertyDescriptor(window, 'render_game_to_text');
  const previousAdvance = Object.getOwnPropertyDescriptor(window, 'advanceTime');
  let textHook, advanceHook;
  let active = !document.hidden, manual = false, last = performance.now();
  const keys = new Set();
  const engine = { dispose, resize: () => {}, pause() { active = false; keys.clear(); }, resume() { active = !document.hidden; last = performance.now(); } };
  activeEngine = engine;
  debug.mounts += 1;
  debug.activeEngines += 1;
  // Persistent counters contain no scene/DOM references and allow exit audits.
  window.__toyWildsDebug = debug;

  function on(target, type, handler, options) {
    if (!target.addEventListener && type === 'change' && target.addListener) {
      target.addListener(handler); debug.activeListeners += 1;
      removers.push(() => { target.removeListener(handler); debug.activeListeners -= 1; });
      return;
    }
    target.addEventListener(type, handler, options);
    debug.activeListeners += 1;
    removers.push(() => { target.removeEventListener(type, handler, options); debug.activeListeners -= 1; });
  }

  function restoreHook(name, hook, previous) {
    if (window[name] !== hook) return;
    if (previous) Object.defineProperty(window, name, previous);
    else delete window[name];
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) { cancelAnimationFrame(frame); frame = 0; debug.activeAnimationFrames -= 1; }
    for (const remove of removers.splice(0)) remove();
    if (observer) { observer.disconnect(); observer = null; debug.activeObservers -= 1; }
    inventory?.dispose();
    const owned = collectResources(scenes);
    for (const item of owned.texture) item.dispose();
    for (const item of owned.material) item.dispose();
    for (const item of owned.geometry) item.dispose();
    for (const scene of scenes) {
      scene.traverse(item => { if (item.shadow?.dispose) item.shadow.dispose(); });
      scene.clear();
    }
    disposeActorResources();
    renderer?.renderLists.dispose();
    renderer?.dispose();
    // The detached canvas no longer needs a live WebGL context.
    renderer?.forceContextLoss();
    if (resources) {
      debug.liveGeometries -= resources.geometry.size;
      debug.liveMaterials -= resources.material.size;
      debug.liveTextures -= resources.texture.size;
    }
    restoreHook('render_game_to_text', textHook, previousText);
    restoreHook('advanceTime', advanceHook, previousAdvance);
    if (oldMode === null) root.removeAttribute('data-mode');
    else root.setAttribute('data-mode', oldMode);
    canvas.style.cursor = '';
    debug.activeEngines -= 1;
    debug.disposals += 1;
    if (activeEngine === engine) activeEngine = null;
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene(); scenes.push(scene);
    scene.background = new THREE.Color(0xeac194); scene.fog = new THREE.Fog(0xeac194, 55, 100);
    const world = createWorld(); scene.add(world.group);
    const navigation = createNavigation(world);
    scene.add(new THREE.HemisphereLight(0xfff7e4, 0x92927e, 2));
    const sun = new THREE.DirectionalLight(0xfff1df, 3);
    sun.position.set(-12, 22, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 0.5, far: 65 });
    sun.shadow.normalBias = 0.035; sun.shadow.bias = -0.0001; scene.add(sun);
    const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 140);
    const focus = new THREE.Vector3(1, 0, 2), cameraOffset = new THREE.Vector3(17, 22, 24);
    camera.position.copy(focus).add(cameraOffset); camera.lookAt(focus);
    const explorer = createExplorer(); explorer.group.position.set(world.spawn.x, 0, world.spawn.z); scene.add(explorer.group);
    const relic = createRelic(); relic.scale.setScalar(0.42); relic.position.set(world.pickup.x, 1.3, world.pickup.z); relic.rotation.y = 0.45; scene.add(relic);
    const destination = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.33, 28), new THREE.MeshBasicMaterial({ color: 0xfff1ca, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    destination.rotation.x = -Math.PI / 2; destination.position.y = 0.035; destination.visible = false; scene.add(destination);

    const cardScene = new THREE.Scene(); scenes.push(cardScene); cardScene.background = new THREE.Color(0xe6e6d9);
    cardScene.add(new THREE.HemisphereLight(0xffffff, 0x708675, 2.5));
    const cardLight = new THREE.DirectionalLight(0xffeacf, 3.4); cardLight.position.set(-4, 6, 8); cardScene.add(cardLight);
    const cardFill = new THREE.DirectionalLight(0x82dee7, 1.3); cardFill.position.set(4, 1, 5); cardScene.add(cardFill);
    const cardCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 80), card = createCard(); cardScene.add(card.group);

    const avatarScene = new THREE.Scene(); scenes.push(avatarScene); avatarScene.background = new THREE.Color(0xcdd5b9);
    avatarScene.add(new THREE.HemisphereLight(0xfff9e8, 0x748a78, 2.8));
    const avatarLight = new THREE.DirectionalLight(0xffedd4, 3.3); avatarLight.position.set(-2, 5, 4); avatarScene.add(avatarLight);
    const avatar = createExplorer(); avatar.group.rotation.y = -0.3; avatarScene.add(avatar.group);
    const avatarCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 20); avatarCamera.position.set(1.7, 1.15, 3); avatarCamera.lookAt(0, 0.58, 0);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.88, 0.13, 12), new THREE.MeshStandardMaterial({ color: 0xb3bda1, roughness: 1 }));
    platform.position.y = -0.07; avatarScene.add(platform);

    const state = { mode: 'welcome', collected: false, path: [], time: 0, walk: 0, near: false, toast: 0, steps: 0 };
    const media = matchMedia('(prefers-reduced-motion: reduce)'); let reduced = media.matches, cardReturn = 'inventory', inventoryView = 'profile';
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();

    function updateSize() {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
      if (Math.abs(rendererSize.width - width) < 0.1 && Math.abs(rendererSize.height - height) < 0.1) return rect;
      rendererSize = { width, height };
      // CSS owns the layout size. Backing pixels use the displayed rect, so
      // app-scale / CSS zoom never multiplies the canvas layout a second time.
      renderer.setSize(width, height, false);
      const aspect = width / height, span = aspect < 0.8 ? 24 : 15.8;
      camera.left = -span * aspect / 2; camera.right = span * aspect / 2; camera.top = span / 2; camera.bottom = -span / 2; camera.updateProjectionMatrix();
      cardCamera.aspect = aspect; cardCamera.position.set(0, 0, Math.max(11.3, 5 / (2 * Math.tan(THREE.MathUtils.degToRad(19)) * aspect)));
      cardCamera.lookAt(0, 0, 0); cardCamera.updateProjectionMatrix();
      return rect;
    }

    function notify(message) { $('message').textContent = message; state.toast = 3.5; $('message').classList.add('visible'); }
    function setMode(mode, nextView) {
      if (nextView) inventoryView = nextView;
      state.mode = mode; root.dataset.mode = mode; keys.clear(); state.path = []; destination.visible = false; card.settle();
      $('welcome').hidden = mode !== 'welcome'; $('pause-panel').hidden = mode !== 'paused'; $('card-ui').hidden = mode !== 'card';
      $('region').hidden = ['card', 'inventory'].includes(mode); $('map-footer').hidden = ['card', 'inventory'].includes(mode);
      $('marker').hidden = mode !== 'world'; $('travel').hidden = true; $('pause').hidden = mode === 'welcome';
      canvas.setAttribute('aria-label', mode === 'card' ? '万象重构镜三维样卡，移入轻转，点击或 Enter、空格翻面，Esc 返回装备袋' : '玩具旷野，点击小径移动，WASD 或方向键行走，接近镜体按 E 拾取');
      if (inventory) { if (mode === 'inventory') inventory.open(state.collected, inventoryView); else inventory.close(); }
      if (mode === 'world' || mode === 'card') canvas.focus({ preventScroll: true });
      else if (mode === 'welcome') $('start').focus({ preventScroll: true });
      else if (mode === 'paused') $('resume').focus({ preventScroll: true });
      render();
    }
    function reset() {
      state.collected = false; state.near = false; state.steps = 0; state.walk = 0; state.time = 0;
      explorer.group.position.set(world.spawn.x, 0, world.spawn.z); explorer.animateWalk(0, false); relic.visible = true; card.reset();
      $('bag-label').textContent = '角色'; $('quest').textContent = '沿着暖色小径，找到池畔的镜。'; setMode('world');
    }
    function openCard() { if (!state.collected) return; inventoryView = inventory.state.view; cardReturn = 'inventory'; card.reset(); setMode('card'); }
    function pickup() {
      if (state.mode !== 'world' || state.collected) return;
      if (!state.near) { notify('再走近一些，就能拾取镜体。'); return; }
      state.collected = true; relic.visible = false; $('bag-label').textContent = '角色';
      $('quest').textContent = '样卡已收藏。去卡库，为旅伴挑选本领。'; setMode('inventory');
    }
    function route(target) {
      if (state.mode !== 'world') return;
      canvas.focus({ preventScroll: true });
      state.path = navigation.path(explorer.group.position, target);
      if (state.path.length) { const p = state.path.at(-1); destination.position.set(p.x, 0.035, p.z); destination.visible = true; $('travel').hidden = false; }
      else notify('这边走不通，试试旁边的小径。');
    }
    function approach() { if (state.collected) setMode('inventory'); else if (state.near) pickup(); else route({ x: world.pickup.x, z: world.pickup.z + 1.65 }); }
    function aim(event, cam) {
      const rect = updateSize(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, cam);
    }
    function onCard(event) { aim(event, cardCamera); return raycaster.intersectObject(card.body, false).length > 0; }

    on($('start'), 'click', () => setMode('world')); on($('resume'), 'click', () => setMode('world')); on($('restart'), 'click', reset);
    on($('bag'), 'click', () => setMode('inventory', 'profile')); on($('armory'), 'click', () => setMode('inventory', 'armory')); on($('return'), 'click', () => setMode(cardReturn)); on($('marker'), 'click', approach);
    on($('pause'), 'click', () => setMode(state.mode === 'paused' ? 'world' : 'paused'));
    on(canvas, 'pointermove', event => {
      if (state.mode !== 'card') return;
      if (event.pointerType !== 'mouse' || !onCard(event)) { card.settle(); return; }
      card.hover(pointer.x * 2, -pointer.y, reduced); canvas.style.cursor = 'pointer';
    });
    on(canvas, 'pointerleave', () => { card.settle(); canvas.style.cursor = 'default'; });
    on(canvas, 'click', event => {
      if (state.mode === 'card') { if (onCard(event)) { card.flip(); canvas.focus({ preventScroll: true }); } return; }
      if (state.mode !== 'world') return;
      aim(event, camera); const hits = raycaster.intersectObject(relic, true);
      if (relic.visible && hits.length) { approach(); return; }
      if (raycaster.ray.intersectPlane(ground, hit)) route({ x: hit.x, z: hit.z });
      canvas.focus({ preventScroll: true });
    });
    on(root, 'keydown', event => {
      if (root.querySelector('#inventory-detail[data-open]')) return;
      const key = event.key.toLowerCase();
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (state.mode === 'inventory') { if (key === 'escape') { event.preventDefault(); setMode('world'); } return; }
      if (event.target instanceof HTMLElement && event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
      if (event.target instanceof HTMLButtonElement && ['enter', ' '].includes(key)) return;
      if (key === 'escape') {
        event.preventDefault();
        if (state.mode === 'card') setMode(cardReturn); else if (state.mode === 'paused') setMode('world'); else if (state.mode === 'world') setMode('paused');
        return;
      }
      if (state.mode === 'card') { if (['enter', ' '].includes(key) && !event.repeat) { event.preventDefault(); card.flip(); } return; }
      if (state.mode !== 'world') return;
      if (key === 'p' && !event.repeat) { setMode('paused'); return; }
      if (key === 'e' && !event.repeat) { event.preventDefault(); pickup(); return; }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) {
        event.preventDefault(); keys.add(key); state.path = []; destination.visible = false; $('travel').hidden = true;
      }
    });
    on(window, 'keyup', event => keys.delete(event.key.toLowerCase()));
    on(window, 'blur', () => keys.clear());
    on(document, 'visibilitychange', () => { active = !document.hidden; keys.clear(); last = performance.now(); if (!active) card.settle(); });
    on(media, 'change', event => { reduced = event.matches; card.settle(); render(); });
    on(canvas, 'webglcontextlost', event => {
      if (disposed) return; event.preventDefault(); active = false; keys.clear();
      $('fatal').hidden = false; $('fatal').textContent = '三维画面已暂停。请返回工作台，再从场景入口重新进入。';
    });
    on(canvas, 'webglcontextrestored', () => { if (!disposed) { active = !document.hidden; $('fatal').hidden = true; render(); } });

    function step(dt) {
      if (!active || disposed) return;
      if (state.toast > 0) { state.toast -= dt; if (state.toast <= 0) $('message').classList.remove('visible'); }
      if (state.mode === 'card') { card.update(dt, cardCamera, reduced); return; }
      if (state.mode !== 'world') return;
      state.time += dt;
      let dx = 0, dz = 0;
      const horizontal = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      const vertical = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
      if (horizontal || vertical) { dx = horizontal * 0.816 + vertical * 0.578; dz = -horizontal * 0.578 + vertical * 0.816; }
      else if (state.path.length) {
        const p = state.path[0], pos = explorer.group.position; dx = p.x - pos.x; dz = p.z - pos.z;
        if (Math.hypot(dx, dz) < 0.075) { state.path.shift(); dx = 0; dz = 0; }
        if (!state.path.length) { destination.visible = false; $('travel').hidden = true; }
      }
      const length = Math.hypot(dx, dz), pos = explorer.group.position, oldX = pos.x, oldZ = pos.z;
      if (length > 0.001) {
        const travel = Math.min(3.3 * dt, length); dx = dx / length * travel; dz = dz / length * travel;
        if (navigation.walkable(pos.x + dx, pos.z)) pos.x += dx;
        if (navigation.walkable(pos.x, pos.z + dz)) pos.z += dz;
        const moved = Math.hypot(pos.x - oldX, pos.z - oldZ);
        if (moved > 0) { state.steps += moved; state.walk += dt * 9; explorer.group.rotation.y = Math.atan2(dx, dz); }
        else if (state.path.length) { state.path = []; destination.visible = false; $('travel').hidden = true; }
      }
      const moving = Math.hypot(pos.x - oldX, pos.z - oldZ) > 0.0001;
      explorer.animateWalk(state.walk, moving && !reduced); state.near = Math.hypot(pos.x - world.pickup.x, pos.z - world.pickup.z) < 2.3;
      world.update(state.time, { active: true, reducedMotion: reduced });
      const nextFocus = new THREE.Vector3(1 + pos.x * 0.32, 0, 1 + pos.z * 0.22);
      focus.lerp(nextFocus, 1 - Math.exp(-dt * 3)); camera.position.copy(focus).add(cameraOffset); camera.lookAt(focus);
    }

    function project(x, y, z, cam = camera) {
      const rect = canvas.getBoundingClientRect(), p = new THREE.Vector3(x, y, z).project(cam);
      return { x: Math.round(rect.left + (p.x * 0.5 + 0.5) * rect.width), y: Math.round(rect.top + (-p.y * 0.5 + 0.5) * rect.height), visible: p.z < 1 && p.x > -1 && p.x < 1 && p.y > -1 && p.y < 1 };
    }

    function render() {
      if (disposed) return;
      const rect = updateSize(), width = rendererSize.width, height = rendererSize.height;
      renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height);
      if (state.mode === 'inventory' && inventory) {
        renderer.setClearColor(0xe6e4ce); renderer.clear();
        const slot = inventory.viewport;
        const left = Math.max(rect.left, slot.left), right = Math.min(rect.right, slot.right);
        const top = Math.max(rect.top, slot.top), bottom = Math.min(rect.bottom, slot.bottom);
        if (slot.width > 0 && slot.height > 0 && right > left && bottom > top) {
          avatarCamera.aspect = slot.width / slot.height; avatarCamera.updateProjectionMatrix();
          renderer.setViewport(slot.left - rect.left, rect.bottom - slot.bottom, slot.width, slot.height);
          renderer.setScissor(left - rect.left, rect.bottom - bottom, right - left, bottom - top); renderer.setScissorTest(true);
          renderer.render(avatarScene, avatarCamera);
        }
        renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); return;
      }
      if (state.mode === 'card') {
        renderer.render(cardScene, cardCamera); $('return').textContent = '← 返回装备袋';
        $('card-help').textContent = (card.state.flipped ? '点击卡片回到正面' : '移入卡片轻转 · 点击卡片翻面') + ' · Esc 返回装备袋'; return;
      }
      renderer.render(scene, camera);
      const p = project(world.pickup.x, 2.25, world.pickup.z), scaleX = rect.width / canvas.clientWidth, scaleY = rect.height / canvas.clientHeight;
      $('marker').hidden = state.mode !== 'world' || !p.visible || state.collected;
      $('marker').style.left = (p.x - rect.left) / scaleX + 'px'; $('marker').style.top = (p.y - rect.top) / scaleY + 'px';
      $('marker').classList.toggle('near', state.near); $('marker-label').textContent = state.near ? 'E 拾取 · 万象重构镜' : '万象重构镜';
      $('distance').textContent = Math.round(Math.hypot(explorer.group.position.x - world.pickup.x, explorer.group.position.z - world.pickup.z)) + ' m';
      $('hint').textContent = state.near && !state.collected ? 'E 拾取 / 点击镜体' : '点击地面前往 / WASD 行走';
    }

    inventory = createInventory({ root, readInventory, readDocument, onManageScene, onClose: () => setMode('world'), onDemo: openCard, onChange: () => {
      if (disposed || !inventory) return;
      const profile = inventory.state; inventoryView = profile.view;
      explorer.setAppearance(profile.appearance); avatar.setAppearance(profile.appearance);
      explorer.setEquipment(profile.draftSceneIds.length); avatar.setEquipment(profile.draftSceneIds.length);
      if (state.mode === 'inventory') render();
    }, on });
    explorer.setAppearance(inventory.state.appearance); avatar.setAppearance(inventory.state.appearance);
    explorer.setEquipment(inventory.state.draftSceneIds.length); avatar.setEquipment(inventory.state.draftSceneIds.length);
    if (sceneName) $('region').querySelector('span').textContent = `${sceneName} · 秋日水域`;
    resources = collectResources(scenes);
    debug.liveGeometries += resources.geometry.size; debug.liveMaterials += resources.material.size; debug.liveTextures += resources.texture.size;
    engine.resize = () => { if (!disposed) render(); };
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => { if (!disposed) render(); }); observer.observe(canvas.parentElement); debug.activeObservers += 1;
    }
    on(window, 'resize', engine.resize);
    on(root, 'scroll', () => { if (state.mode === 'inventory') render(); }, { passive: true, capture: true });

    textHook = () => JSON.stringify({
      ready: !disposed, mode: state.mode, sceneId, sceneName,
      coordinateSystem: 'Y up; X east, Z south; arrows camera-relative; screen positions are physical CSS viewport coordinates',
      viewport: { left: canvas.getBoundingClientRect().left, top: canvas.getBoundingClientRect().top, ...rendererSize },
      player: { x: +explorer.group.position.x.toFixed(3), z: +explorer.group.position.z.toFixed(3), lineage: explorer.group.userData.lineage, equippedCount: explorer.group.userData.equippedCount },
      pickup: { ...world.pickup, near: state.near, collected: state.collected, screen: project(world.pickup.x, 1.3, world.pickup.z), approachScreen: project(world.pickup.x, 0, world.pickup.z + 1.65) },
      inventory: state.collected ? ['wanxiang-mirror'] : [], equipmentBag: inventory.state,
      awardWritten: false, profileWritten: false, pathLength: state.path.length, bounds: world.bounds, obstacles: world.colliders,
      card: card.state, reducedMotion: reduced, worldTime: +state.time.toFixed(3), drawCalls: renderer.info.render.calls,
      resources: readEngineDebug(), rendererMemory: { ...renderer.info.memory },
    });
    advanceHook = milliseconds => {
      if (disposed || !Number.isFinite(milliseconds) || milliseconds < 0) return;
      manual = true; const ms = Math.min(milliseconds, 60_000), count = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let index = 0; index < count; index += 1) step(ms / 1000 / count);
      render();
    };
    Object.defineProperty(window, 'render_game_to_text', { configurable: true, writable: true, value: textHook });
    Object.defineProperty(window, 'advanceTime', { configurable: true, writable: true, value: advanceHook });
    function schedule() {
      if (disposed) return;
      debug.activeAnimationFrames += 1;
      frame = requestAnimationFrame(now => {
        frame = 0; debug.activeAnimationFrames -= 1;
        if (disposed) return;
        const dt = Math.min((now - last) / 1000, 0.05); last = now;
        if (!manual) { step(dt); if (active) render(); }
        schedule();
      });
    }
    setMode('welcome'); schedule();
    return engine;
  } catch (error) {
    dispose();
    throw error;
  }
}
