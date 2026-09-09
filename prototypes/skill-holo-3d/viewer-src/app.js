import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { divinityShader } from './ssr-divinity.js';

const stage = document.querySelector('#stage');
const loading = document.querySelector('#loading');
const $ = (id) => document.getElementById(id);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
const TIER_MODE = { C: 0, R: 1, SR: 2, SSR: 3 };
const TIER_ART = {
  C: { title: '素木放大镜', technique: '看清线索', structure: '单片玻璃 · 素木握柄', description: '先把一条线索看清楚。一片玻璃、一圈铜箍，是这件装备最初的形态。', note: 'C · 基础器具。朴素材质与单一镜片，不含镭射、闪点或金边。' },
  R: { title: '双轴勘察镜', technique: '建立校准', structure: '双轴镜组 · 精密校准机构', description: '把观察变成可校准的方法。双镜组与机械刻度，让每一次勘察有据可循。', note: 'R · 精密器具。镜组、刻度与机械结构升级；仍不含任何镭射或闪点。' },
  SR: { title: '三相解析镜', technique: '看见关系', structure: '三相棱镜 · 金色解析框架', description: '从孤立线索中看见关系。三组棱镜与金色框架，组成一套完整的解析结构。', note: 'SR · 解析器具。三相结构、金色框架与装备局部折光；背景保持清晰，不铺满闪点。' },
  SSR: { title: '万象重构镜', technique: '重连框架', structure: '神魂晶核 · 开放星轨 · 宇宙神域', description: '一枚晶核，容纳一个流动的世界。神魂穿行于元素之间，开放镜环与星海相接，神器在自己的神域中醒来。', note: 'SSR · 神域形态。晶核内神魂游动，星轨连接宇宙；卡体只随鼠标微倾。此处是永久解锁的演示记录，不代表真实授奖。' },
};
const tierTextures = {};


let renderer, composer, canonicalRoot, face, uniforms, config, ssrEmblem;
let ssrUnlockedInMemory = false, shaderFailure = null;
const goldMeshes = [];
const cardMeshes = [], raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
let flipped = false, activeTier = 'C';
let targetX = 0.025, targetY = -0.13, targetZoom = 1, rotationX = targetX, rotationY = targetY;
let lastTime = 0, needsRender = true;
let spiritTime = 0, lastSpiritRender = 0, motionPaused = false, stageInView = true;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-5, 5, 5.65, -5.65, 0.1, 100);
camera.position.set(0, 0, 20);
camera.lookAt(0, 0, 0);

const vertex = /* glsl */`
varying vec2 vUv;
void main(){
  // Blender's exported V is restored once here; every layer uses this same card space.
  vUv=vec2(uv.x,1.0-uv.y);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const shared = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime,uFoil,uScale,uDepth,uBgDepth,uSafeScale,uMode,uFullFoil,uEquipmentFoil;
uniform vec2 uSafeOffset;
uniform vec3 uView;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
vec3 spectrum(float t){t=fract(t);vec3 pink=vec3(1.,.25,.59),yellow=vec3(1.,.84,.27),blue=vec3(.16,.66,1.);if(t<.35)return mix(pink,yellow,t/.35);if(t<.70)return mix(yellow,blue,(t-.35)/.35);return mix(blue,vec3(.84,1.,.95),(t-.70)/.30);}
vec3 overlay(vec3 b,vec3 f){return mix(2.*b*f,1.-2.*(1.-b)*(1.-f),step(vec3(.5),b));}
float inside(vec2 p){return step(0.,p.x)*step(0.,p.y)*step(p.x,1.)*step(p.y,1.);}
// Signed-depth parallax: the canonical card-root view vector is divided by its normal axis.
vec2 parallax(vec2 p,float s,float d){return (p-.5)*s+.5+uView.xy/max(abs(uView.z),.35)*d*.14;}
float wave(vec2 p){vec2 a=p+uView.xy*2.4;return .5+.5*sin((a.x*.848-a.y*.530)*6.283*.55+7.*noise(a*1.5));}
float star(vec2 p){vec2 q=p*105.,id=floor(q),f=fract(q);float first=9.,second=9.;for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 o=vec2(hash(id+g),hash(id+g+43.3));float d=length(g+o-f);if(d<first){second=first;first=d;}else second=min(second,d);}}float edge=1.-smoothstep(.01,.035,second-first);float sparse=step(.90,hash(id+8.8));float twinkle=pow(.5+.5*sin(uTime*1.8+hash(id)*30.+uView.x*27.+uView.y*21.),6.);return edge*sparse*twinkle;}

`;
const frontFragment = shared + divinityShader + /* glsl */`
uniform sampler2D tSubject,tBackground,tText,tLine,tCrystalMask;
uniform float uSpiritTime;
void main(){
  vec2 uv=vUv;
  vec2 su=parallax(uv,uScale,uDepth)*uSafeScale+uSafeOffset;
  vec2 bu=parallax(uv,1.,uBgDepth);
  vec4 sub=texture2D(tSubject,clamp(su,0.,1.)); sub.a*=inside(su);
  vec3 bg=texture2D(tBackground,clamp(bu,0.,1.)).rgb;
  if(uMode>2.5){
    // The exact core mask uses the subject's signed-depth UV, so the spirit
    // stays inside the glass during hover, scale and parallax changes.
    float core=texture2D(tCrystalMask,clamp(su,0.,1.)).r*sub.a*inside(su);
    if(core>.001){
      vec2 cp=(su-vec2(533./1024.,1.-622./1536.))/vec2(175./1024.,165./1536.);
      sub.rgb=mix(sub.rgb,divineCrystal(cp,sub.rgb,uSpiritTime),core);
    }
    bg=divineCosmos(bu,bg,uSpiritTime);
  }
  float w=wave(uv); vec3 foil=spectrum(w*.8+noise(uv*5.)*.12);
  // SR foil is confined to equipment alpha; only SSR may affect the surrounding card.
  // C and R drive both uniforms to zero, including edges and the reverse face.
  float full=uFullFoil;
  float equipment=uEquipmentFoil;
  vec3 subject=mix(sub.rgb,overlay(sub.rgb,foil),equipment*.34);
  bg=mix(bg,overlay(bg,foil),full*.36);
  vec3 col=mix(bg,subject,sub.a);
  float sweep=pow(max(0.,sin((uv.x*.83+uv.y*.35+uView.x*1.8+uView.y*.9)*6.283)),12.);
  col+=foil*sweep*(full*.22+equipment*sub.a*.15);
  float line=1.-smoothstep(.06,.25,texture2D(tLine,clamp(su,0.,1.)).r);
  col+=vec3(1.,.94,.78)*line*inside(su)*sub.a*sweep*equipment*.22;
  col+=vec3(.66,.86,1.)*star(bu)*full*.65*(1.-sub.a*.7);
  // Text is the final printed layer. It is never added as emissive light or foil.
  vec4 text=texture2D(tText,uv); col=mix(col,text.rgb,text.a);
  gl_FragColor=vec4(pow(max(col,vec3(0.)),vec3(2.2)),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const edgeFragment = shared + /* glsl */`
void main(){
  vec3 ink=vec3(.028,.085,.10), gold=vec3(.67,.42,.12);
  // Gold is separately mesh-gated; this shader has no residual rainbow at foil=0.
  vec3 col=ink+gold*uFullFoil*.24+spectrum(wave(vUv))*uFullFoil*.42;
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const backFragment = shared + /* glsl */`
uniform sampler2D tBack;
void main(){
  // A viewed back face reverses model U; flip the generated lettering once at sampling.
  vec4 art=texture2D(tBack,vec2(1.-vUv.x,vUv.y)); vec2 p=vUv-.5;
  float filigree=.5+.5*sin(length(p*vec2(1.,1.5))*100.+noise(p*15.)*4.);
  vec3 col=mix(vec3(.018,.048,.058),vec3(.055,.115,.12),filigree*.35);
  float border=step(.465,max(abs(p.x),abs(p.y)));
  col+=spectrum(wave(vUv))*border*uFullFoil*.55;
  col=mix(col,art.rgb,art.a);
  gl_FragColor=vec4(pow(col,vec3(2.2)),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function backTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1536;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#c9ac69'; ctx.lineWidth = 2;
  ctx.strokeRect(74, 74, 876, 1388); ctx.strokeRect(88, 88, 848, 1360);
  ctx.save(); ctx.translate(512, 635); ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-190, -190, 380, 380); ctx.strokeRect(-174, -174, 348, 348); ctx.restore();
  ctx.textAlign = 'center'; ctx.fillStyle = '#d9c38f'; ctx.font = '148px KaiTi, STKaiti, serif';
  ctx.fillText('技', 512, 690); ctx.font = '31px KaiTi, STKaiti, serif';
  ctx.fillText(config.collection || '技能样卡', 512, 1030); ctx.font = '20px Georgia'; ctx.fillStyle = '#9cafad';
  ctx.fillText('OPTICAL SKILL CARD', 512, 1090); ctx.fillText(config.edition || 'SAMPLE / 01', 512, 1300);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.NoColorSpace; return texture;
}

function createSsrEmblem() {
  const group = new THREE.Group(); group.name = 'ssr-open-reconnect-emblem';
  const aqua = new THREE.MeshBasicMaterial({ color: 0x78f5de, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
  const gold = new THREE.MeshBasicMaterial({ color: 0xe6bd68, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending, depthWrite: false });
  const outer = new THREE.Mesh(new THREE.TorusGeometry(.43, .027, 10, 64, Math.PI * 1.62), aqua);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(.29, .018, 8, 48, Math.PI * 1.40), gold);
  outer.rotation.z = .28; inner.rotation.z = Math.PI + .15;
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .42, 8), gold); bridge.rotation.z = -.68;
  group.add(outer, inner, bridge); group.position.set(1.95, -2.7, .35); group.visible = false;
  return group;
}

async function init() {
  config = await fetch('./card-config.json').then((r) => { if (!r.ok) throw Error('找不到 card-config.json'); return r.json(); });
  document.title = '依赖镜头 · 装备进化';
  for (const [id, key] of Object.entries({ 'card-title': 'title', collection: 'collection', subtitle: 'subtitle', description: 'description', tagline: 'tagline', technique: 'technique', edition: 'edition' })) {
    if (config[key]) $(id).textContent = config[key];
  }
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    const detail = gl.getProgramInfoLog(program) || gl.getShaderInfoLog(vertexShader) || gl.getShaderInfoLog(fragmentShader) || '未知 GLSL 编译错误';
    shaderFailure = `材质 Shader 编译失败：${detail.trim()}`;
    console.error(shaderFailure, { vertexShader, fragmentShader });
  };
  stage.append(renderer.domElement);
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  // High threshold prevents the final printed text texture from becoming a glow source.
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(720, 1000), .14, .32, 1.32)); composer.addPass(new OutputPass());
  const assets = config.assets || {};
  const required = ['model', 'subject', 'background', 'text', 'lineart'];
  for (const name of required) if (!assets[name]) throw Error(`card-config.json 缺少 assets.${name}`);
  const loader = new THREE.TextureLoader();
  const prepareTexture = (texture) => {
    // The shader retains the template's explicit pow(2.2) transfer; art layers stay unconverted.
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  };
  const background = prepareTexture(await loader.loadAsync(assets.background));
  const [divineBackground, crystalMask] = await Promise.all(['background', 'crystal-mask'].map(async (name) => {
    const path = `./assets/tiers/SSR/${name}.png`;
    try { return prepareTexture(await loader.loadAsync(path)); }
    catch { throw Error(`SSR 神域素材缺失：${path}`); }
  }));
  await Promise.all(Object.keys(TIER_ART).map(async (tier) => {
    const entries = await Promise.all(['subject', 'lineart', 'text'].map(async (name) => {
      const file = tier === 'SSR' && name === 'subject' ? 'subject-divine' : name;
      const path = `./assets/tiers/${tier}/${file}.png`;
      try { return [name, prepareTexture(await loader.loadAsync(path))]; }
      catch { throw Error(`${tier} 装备素材缺失：${path}。每个等级必须使用独立原画。`); }
    }));
    tierTextures[tier] = Object.fromEntries(entries);
    tierTextures[tier].background = tier === 'SSR' ? divineBackground : background;
  }));
  const initial = tierTextures.C;
  const prm = config.parameters || {};
  uniforms = {
    tSubject: { value: initial.subject }, tBackground: { value: background }, tText: { value: initial.text }, tLine: { value: initial.lineart }, tBack: { value: backTexture() }, tCrystalMask: { value: crystalMask }, uSpiritTime: { value: 0 },
    uTime: { value: 0 }, uView: { value: new THREE.Vector3(0, 0, 1) }, uFoil: { value: prm.foil ?? .65 }, uFullFoil: { value: 0 }, uEquipmentFoil: { value: 0 }, uMode: { value: TIER_MODE.C },
    uScale: { value: prm.subjectScale ?? 1.25 }, uDepth: { value: prm.subjectDepth ?? .4 }, uBgDepth: { value: prm.backgroundDepth ?? -.25 },
    uSafeScale: { value: config.safeArea?.scale ?? 1.12 }, uSafeOffset: { value: new THREE.Vector2(...(config.safeArea?.offset ?? [-.06, -.085])) },
  };
  const frontMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: frontFragment, side: THREE.FrontSide, transparent: true });
  const edgeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: edgeFragment });
  const backMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: backFragment });
  // MeshBasic is deliberate: the viewer has no scene lights and gold must stay legible at every angle.
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xd9b66d });
  const gltf = await new GLTFLoader().loadAsync(assets.model);
  canonicalRoot = new THREE.Group(); canonicalRoot.name = 'canonical-card-root'; canonicalRoot.add(gltf.scene); scene.add(canonicalRoot);
  const found = new Set();
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const role = object.material?.name;
    if (role === 'web_front') { object.material = frontMat; face = object; cardMeshes.push(object); found.add(role); }
    else if (role === 'web_edge') { object.material = edgeMat; cardMeshes.push(object); found.add(role); }
    else if (role === 'web_back') { object.material = backMat; cardMeshes.push(object); found.add(role); }
    else if (role === 'web_gold') { object.material = goldMat; goldMeshes.push(object); cardMeshes.push(object); found.add(role); }
    else if (role === 'web_text') object.visible = false;
  });
  if (!face) throw Error('GLB 缺少 web_front 材质，无法建立卡面。');
  for (const role of ['web_edge', 'web_back', 'web_gold']) if (!found.has(role)) throw Error(`GLB 缺少 ${role} 材质，请重新导出 card.glb。`);
  ssrEmblem = createSsrEmblem(); canonicalRoot.add(ssrEmblem);
  setupControls(); applyTier('C');
  new ResizeObserver(resize).observe(stage); resize();
  new IntersectionObserver(([entry]) => { stageInView = entry.isIntersecting; requestRender(); }, { threshold: 0 }).observe(stage);
  document.addEventListener('visibilitychange', () => { lastTime = performance.now(); requestRender(); });
  motionPreference.addEventListener('change', (event) => {
    reducedMotion = event.matches;
    if (reducedMotion) { targetX = 0; targetY = flipped ? Math.PI : 0; }
    updateMotionControl(); requestRender();
  });
  // Force a real first render before claiming readiness; onShaderError makes GPU compile failures visible here.
  composer.render(); if (shaderFailure) throw Error(shaderFailure);
  loading.remove();
  window.__holo = { ready: true, config, renderer, root: canonicalRoot, uniforms, reset, setTier: applyTier, modelSource: assets.model };
  renderer.setAnimationLoop(animate);
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h || !renderer) return;
  const aspect = w / h, halfH = 5.65 / targetZoom;
  camera.left = -halfH * aspect; camera.right = halfH * aspect; camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); needsRender = true;
}
function requestRender() { needsRender = true; }
function reset() { targetX = .025; targetY = -.13; targetZoom = 1; flipped = false; $('view-label').textContent = 'FRONT · 正面'; resize(); requestRender(); }
function flip() { flipped = !flipped; targetY = flipped ? Math.PI : 0; targetX = 0; $('view-label').textContent = flipped ? 'BACK · 背面' : 'FRONT · 正面'; stage.setAttribute('aria-pressed', String(flipped)); requestRender(); }
function unlocked() { try { return ssrUnlockedInMemory || localStorage.getItem('skill-holo-ssr-demo') === 'unlocked'; } catch { return ssrUnlockedInMemory; } }
function unlockSsr() {
  ssrUnlockedInMemory = true;
  try { localStorage.setItem('skill-holo-ssr-demo', 'unlocked'); } catch { /* private browsing persists this preview in memory */ }
  showSsr(); applyTier('SSR');
}
function showSsr() {
  $('ssr-preview').hidden = false;
  $('ssr-evolution').hidden = false;
  $('breakthrough').hidden = true;
}
function updateFoil() {
  uniforms.uEquipmentFoil.value = activeTier === 'SR' || activeTier === 'SSR' ? uniforms.uFoil.value : 0;
  uniforms.uFullFoil.value = activeTier === 'SSR' ? uniforms.uFoil.value : 0;
}
function updateMotionControl() {
  const button = $('realm-motion');
  button.hidden = activeTier !== 'SSR';
  button.disabled = reducedMotion;
  button.setAttribute('aria-pressed', String(!motionPaused && !reducedMotion));
  button.textContent = reducedMotion ? '神域静止 · 减少动态' : motionPaused ? '继续神域流动' : '暂停神域流动';
}
function applyTier(tier) {
  if (!TIER_ART[tier] || (tier === 'SSR' && !unlocked())) return;
  const art = TIER_ART[tier], textures = tierTextures[tier];
  if (!textures) throw Error(`${tier} 的独立装备素材尚未载入。`);
  activeTier = tier;
  uniforms.uMode.value = TIER_MODE[tier];
  uniforms.tSubject.value = textures.subject;
  uniforms.tLine.value = textures.lineart;
  uniforms.tText.value = textures.text;
  uniforms.tBackground.value = textures.background;
  updateFoil();
  updateMotionControl();
  document.body.dataset.tier = tier;
  const foilEnabled = tier === 'SR' || tier === 'SSR';
  $('foil').disabled = !foilEnabled;
  $('foil-hint').textContent = foilEnabled ? (tier === 'SR' ? '装备局部折光' : '全幅镭射') : 'SR 起解锁';
  $('foil-value').value = foilEnabled ? `${Math.round(uniforms.uFoil.value * 100)}%` : '未解锁';
  $('foil-control').classList.toggle('locked', !foilEnabled);
  goldMeshes.forEach((mesh) => { mesh.visible = foilEnabled; });
  ssrEmblem.visible = tier === 'SSR';
  document.querySelectorAll('[data-tier]').forEach((button) => {
    const selected = button.dataset.tier === tier;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('card-title').textContent = art.title;
  $('subtitle').textContent = `${tier} · 依赖镜头`;
  $('description').textContent = art.description;
  $('technique').textContent = art.technique;
  $('structure').textContent = art.structure;
  $('capability').textContent = art.technique;
  $('tagline').textContent = 'EQUIPMENT EVOLUTION';
  $('tier-note').textContent = art.note;
  document.title = `${art.title} · 装备进化`;
  stage.setAttribute('aria-label', `${tier} ${art.title}，可交互三维卡牌。鼠标移入卡面轻微倾斜，点击翻面；按 Enter 或空格翻面。`);
  requestRender();
}

function setupControls() {
  for (const [id, name, label] of [['foil', 'uFoil', 'foil-value'], ['scale', 'uScale', 'scale-value'], ['depth', 'uDepth', 'depth-value'], ['bg-depth', 'uBgDepth', 'bg-depth-value']]) {
    const input = $(id); input.value = uniforms[name].value;
    const update = () => { uniforms[name].value = Number(input.value); if (id === 'foil') updateFoil(); $(label).value = id === 'foil' ? `${Math.round(input.value * 100)}%` : Number(input.value).toFixed(2); requestRender(); };
    input.addEventListener('input', update); update();
  }
  document.querySelectorAll('[data-tier]').forEach((button) => button.addEventListener('click', () => applyTier(button.dataset.tier)));
  if (unlocked()) showSsr();
  $('breakthrough').addEventListener('click', unlockSsr);
  $('realm-motion').addEventListener('click', () => { motionPaused = !motionPaused; updateMotionControl(); requestRender(); });
  const cardHit = (event) => {
    const rect = stage.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1));
    raycaster.setFromCamera(pointer, camera); return raycaster.intersectObjects(cardMeshes, false).length > 0;
  };
  const settle = () => { targetX = 0; targetY = flipped ? Math.PI : 0; requestRender(); };
  stage.addEventListener('pointermove', (event) => {
    if (reducedMotion || event.pointerType !== 'mouse') return;
    if (!cardHit(event)) { settle(); return; }
    const rect = stage.getBoundingClientRect(); const nx = (event.clientX - rect.left) / rect.width * 2 - 1; const ny = (event.clientY - rect.top) / rect.height * 2 - 1;
    targetY = (flipped ? Math.PI : 0) + THREE.MathUtils.clamp(nx, -.47, .47) * .175;
    targetX = THREE.MathUtils.clamp(-ny, -.72, .72) * .14; requestRender();
  });
  stage.addEventListener('pointerleave', settle);
  stage.addEventListener('click', (event) => { if (!cardHit(event)) return; flip(); stage.focus({ preventScroll: true }); });
  stage.addEventListener('keydown', (event) => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); flip(); });
  $('details').onclick = () => $('about').showModal(); $('about').querySelector('.close').onclick = () => $('about').close();
}
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, .1) || 0; lastTime = now;
  const pending = Math.abs(targetX - rotationX) > .0001 || Math.abs(targetY - rotationY) > .0001;
  // Only the living SSR front animates at rest. Hidden, offscreen, reversed,
  // paused and reduced-motion states stop its clock and repeated GPU renders.
  const living = activeTier === 'SSR' && !flipped && !motionPaused && !reducedMotion && stageInView && !document.hidden;
  if (living) spiritTime += dt;
  const spiritFrame = living && now - lastSpiritRender >= 1000 / 30;
  if (!pending && !needsRender && !spiritFrame) return;
  const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 8); rotationX += (targetX - rotationX) * ease; rotationY += (targetY - rotationY) * ease;
  canonicalRoot.rotation.set(rotationX, rotationY, 0); canonicalRoot.updateMatrixWorld(true);
  // uView is intentionally computed from the unmodified canonical root, never from a converted front mesh.
  uniforms.uView.value.copy(camera.position).applyMatrix4(new THREE.Matrix4().copy(canonicalRoot.matrixWorld).invert()).normalize();
  uniforms.uTime.value = 0;
  uniforms.uSpiritTime.value = spiritTime;
  composer.render();
  lastSpiritRender = now;
  needsRender = false;
}

init().catch((error) => {
  console.error(error); loading.textContent = `卡牌无法加载。\n${error.message}\n请确认 GLB、四套独立装备 PNG 与本地静态服务都已就绪。`; loading.setAttribute('role', 'alert'); window.__holo = { ready: false, error: error.message };
});
