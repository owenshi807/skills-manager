import { SCENE_STORAGE, LEGACY_STORAGE, migrateSceneProfiles, projectSceneSkillIds, isSceneProfileRecord } from './scene-loadouts.js';
const PAGE_SIZE = 24;
const LINEAGES = {
  explorer: { label: '旷野族 · 探险者', emblem: '◇', coat: '#304A56', accent: '#DD7843', hat: '#F2D9A5', traits: '轻装旅行 · 宽沿帽 · 腰间小卡套', summary: '沿着还没有名字的小径，找到下一项本领。' },
  maker: { label: '铸造族 · 工匠', emblem: '⚒', coat: '#596A78', accent: '#D6A24A', hat: '#E7D9B8', traits: '工坊装束 · 厚实围裙 · 黄铜配色', summary: '把想法放上工作台，让零件找到自己的位置。' },
  sage: { label: '星语族 · 贤者', emblem: '✧', coat: '#666586', accent: '#81B9B0', hat: '#D8D0AE', traits: '星图装束 · 青绿饰边 · 柔软披肩', summary: '收集散落的星点，编成可以辨认的图谱。' },
  ranger: { label: '林风族 · 游侠', emblem: '⌁', coat: '#4C705C', accent: '#C9965C', hat: '#C8CC9D', traits: '林间装束 · 苔绿外套 · 轻便行囊', summary: '观察风向与足迹，在变化里找到前路。' },
};

const REVIEW_GRADES = new Set(['C', 'R', 'SR', 'SSR']);
const REVIEW_SSR_STATUSES = new Set(['supported', 'not_established', 'recorded']);
const REVIEW_FRESHNESS = new Set(['matched', 'changed']);

function isSceneReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return false;
  const text = ['reviewId', 'reviewedAt', 'gradeLabel', 'title', 'value', 'useWhen', 'ability', 'boundary', 'basis', 'scope', 'evidenceSummary'];
  if (!text.every(key => typeof review[key] === 'string') ||
      !REVIEW_GRADES.has(review.currentGrade) || !REVIEW_GRADES.has(review.visualGrade) ||
      !REVIEW_SSR_STATUSES.has(review.ssrStatus) || !REVIEW_FRESHNESS.has(review.freshness) ||
      !(review.nextStep === null || typeof review.nextStep === 'string')) return false;
  if (!review.art || typeof review.art !== 'object' || Array.isArray(review.art) || typeof review.art.url !== 'string' || typeof review.art.alt !== 'string') return false;
  if (review.breakthrough !== null && (!review.breakthrough || typeof review.breakthrough !== 'object' || Array.isArray(review.breakthrough) ||
      !['before', 'after', 'example', 'boundary'].every(key => typeof review.breakthrough[key] === 'string'))) return false;
  return true;
}

function reviewSsrLabel(review) {
  if (review.ssrStatus === 'recorded') return 'SSR 突破已留档';
  if (review.ssrStatus === 'supported') return 'SSR 突破获本次支持';
  return 'SSR 突破尚未建立';
}

function newAgent(name, lineage) {
  return { id: `local:${crypto.randomUUID()}`, name, lineage, createdAt: new Date().toISOString() };
}

function readLocalProfiles() {
  let current = null, legacy = null, warning = '', canPersist = true;
  try {
    const currentText = localStorage.getItem(SCENE_STORAGE);
    if (currentText !== null) {
      current = JSON.parse(currentText);
      if (!isSceneProfileRecord(current)) throw new Error('Unknown or damaged scene profile format');
    }
  } catch {
    canPersist = false;
    warning = '本机场景配装暂时无法读取；原记录已保留，本次更改暂不保存。';
  }
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE)); }
  catch { warning ||= '旧配装暂时无法读取，原记录已保留。'; }
  const profiles = migrateSceneProfiles(current, legacy, () => newAgent('旷野探险者', 'explorer'));
  if (current?.version === 4 && (!Array.isArray(current.agents) || current.agents.length !== profiles.agents.length || profiles.agents.some(agent => !current.agents.some(stored => stored?.id === agent.id)))) {
    canPersist = false;
    warning = '部分本机角色记录无法辨认；原记录已保留，本次更改暂不保存。';
  }
  return { profiles, warning, canPersist };
}

/** Local character preparation and read-only scene cards. Members never become equipment cards. */
export function createInventory({ root, readInventory, readDocument, onManageScene, onClose, onDemo, onChange, on }) {
  const $ = id => root.querySelector(`#${id}`);
  let panel = $('inventory-panel');
  const loaded = readLocalProfiles();
  const profiles = loaded.profiles;
  const removers = [], flipped = new Set();
  let disposed = false, snapshot = null, stale = false, loading = false, readError = '', storageError = loaded.warning;
  let view = 'profile', demo = false, query = '', limit = PAGE_SIZE, restoreFocus = null, refreshPromise = null;
  let tiltedCard = null, detailReturnFocus = null, detailSession = 0, detailBackdrop = null;
  let detailInert = [];
  const selectedAgent = () => profiles.agents.find(agent => agent.id === profiles.selectedAgentRef);
  const selectedIds = () => profiles.sceneLoadouts[profiles.selectedAgentRef] || [];
  const appearance = () => {
    const lineage = selectedAgent().lineage, style = LINEAGES[lineage];
    return { lineage, coat: style.coat, accent: style.accent, hat: style.hat };
  };
  const element = (tag, className = '', value = '') => {
    const node = document.createElement(tag); node.className = className; node.textContent = value; return node;
  };
  const button = (className, label, action) => {
    const node = element('button', className, label); node.type = 'button'; if (action) node.dataset.action = action; return node;
  };
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  const emit = () => { if (!disposed) onChange?.(); };
  function listen(target, type, callback, options) {
    if (!target) return;
    // Panel events delegate through the stable game root, so an AX container
    // refresh can preserve all child controls without duplicating listeners.
    const delegated = target === panel;
    const surface = delegated ? root : target;
    const handler = delegated ? event => { if (panel.contains(event.target)) callback(event); } : callback;
    const listenerOptions = delegated && type === 'keydown' ? { ...options, capture: true } : options;
    if (on) on(surface, type, handler, listenerOptions); else surface.addEventListener(type, handler, listenerOptions);
    removers.push(() => surface.removeEventListener(type, handler, listenerOptions));
  }
  function refreshPanelAccessibility() {
    const scrollTop = panel.scrollTop, scrollLeft = panel.scrollLeft;
    const refreshed = panel.cloneNode(false);
    refreshed.append(...panel.childNodes); panel.replaceWith(refreshed); panel = refreshed;
    panel.scrollTop = scrollTop; panel.scrollLeft = scrollLeft;
  }
  function persist() {
    if (!loaded.canPersist) return;
    try { localStorage.setItem(SCENE_STORAGE, JSON.stringify(profiles)); storageError = loaded.warning; }
    catch { storageError = '浏览器未能保存本机角色与配装；本次会话中的更改仍然保留。'; }
  }
  function resetTilt() {
    if (tiltedCard) {
      tiltedCard.style.setProperty('--card-tilt-x', '0deg'); tiltedCard.style.setProperty('--card-tilt-y', '0deg');
      tiltedCard.querySelector('.scene-card-art')?.removeAttribute('data-holo-active'); tiltedCard = null;
    }
  }
  const cardKey = id => `${profiles.selectedAgentRef}/${id}`;
  function setFlipped(card, value) {
    card.dataset.flipped = String(value);
    const toggle = card.querySelector('[data-action="flip"]');
    toggle.setAttribute('aria-pressed', String(value));
    toggle.setAttribute('aria-label', `${value ? '翻到正面' : '翻到背面'}：${card.dataset.sceneName}`);
    card.querySelector('.skill-card-front').setAttribute('aria-hidden', String(value));
    card.querySelector('.skill-card-back').setAttribute('aria-hidden', String(!value));
  }
  function sceneDescription(scene) {
    return scene.description?.trim() ? scene.description : '这个场景还没有说明。打开场景手册，可以整理它要解决的问题。';
  }
  function createCard(scene, missing = false) {
    const equipped = selectedIds().includes(scene.id), card = element('article', 'skill-card scene-card inventory-scene');
    card.dataset.sceneId = scene.id; card.dataset.sceneName = scene.name;
    card.dataset.equipped = String(equipped); card.dataset.carried = String(equipped);
    const review = !missing && isSceneReview(scene.review) ? scene.review : null;
    if (review) {
      card.dataset.reviewed = 'true'; card.dataset.grade = review.currentGrade; card.dataset.visualGrade = review.visualGrade;
      card.dataset.ssr = review.ssrStatus; card.dataset.freshness = review.freshness;
    } else card.dataset.reviewed = 'false';
    if (missing) card.dataset.missing = 'true';
    const tilt = element('div', 'skill-card-tilt'), flip = button('skill-card-flip', '', 'flip'), turn = element('span', 'skill-card-turn');
    const front = element('span', 'skill-card-face skill-card-front'), back = element('span', 'skill-card-face skill-card-back');
    const members = scene.members || [];
    const composition = missing ? '场景记录待确认' : members.length ? `${members.length} 项内容 · 共同组成一个场景` : '等待加入第一项内容';
    if (review) {
      const art = element('span', 'scene-card-art');
      const fallback = element('span', 'scene-card-art-fallback', review.art.url ? '主视觉读取中…' : '待绘制 · 本次试评主视觉尚未入库');
      art.append(fallback);
      if (review.art.url) {
        const image = document.createElement('img');
        image.alt = review.art.alt || `${scene.name} 的场景主视觉`;
        image.addEventListener('load', () => { art.dataset.state = 'ready'; });
        image.addEventListener('error', () => { art.dataset.state = 'unavailable'; fallback.textContent = '待绘制 · 主视觉暂时不可用'; });
        image.src = review.art.url;
        art.append(image);
      }
      const overline = element('span', 'scene-card-overline');
      overline.append(element('span', 'scene-card-scene-name', scene.name), element('span', 'scene-card-grade-label', review.gradeLabel));
      const copy = element('span', 'scene-card-front-copy');
      copy.append(element('span', 'scene-card-specialty', review.title), element('span', 'scene-card-value-line', review.value));
      front.append(overline, art, copy, element('span', 'skill-card-hint', '点击或按 Enter 翻看用途与边界 ↻'));
      back.append(element('span', 'skill-card-source', `${review.gradeLabel} · 试点评审`), element('span', 'skill-name', review.title), element('span', 'scene-card-back-scene', scene.name));
    } else {
      const pendingArt = element('span', 'scene-card-pending-art', missing ? '场景记录待确认' : '待绘制');
      front.append(element('span', 'skill-card-source', missing ? '场景记录待确认' : '场景卡 · 品阶未评定'), pendingArt, element('span', 'skill-name', scene.name), element('span', 'scene-card-composition', composition), element('span', 'skill-card-hint', '轻触了解这个场景 ↻'));
      back.append(element('span', 'skill-card-source', '场景说明 · 尚未评审'), element('span', 'skill-name', scene.name));
    }
    const body = element('span', 'skill-card-copy');
    if (review) {
      const useWhen = element('span', 'skill-copy-row');
      useWhen.append(element('span', 'skill-copy-label', '适合用在'), element('span', '', review.useWhen));
      const ability = element('span', 'skill-copy-row');
      ability.append(element('span', 'skill-copy-label', '能做什么'), element('span', '', review.ability));
      body.append(useWhen, ability, element('span', 'skill-copy-condition', `边界：${review.boundary}`));
    } else body.append(element('span', 'skill-card-value', sceneDescription(scene)));
    if (!missing && !review) {
      const row = element('span', 'skill-copy-row');
      const memberNames = members.slice(0, 3).map(member => member.name).join('、');
      row.append(element('span', 'skill-copy-label', '场景组成'), element('span', '', members.length ? `${memberNames}${members.length > 3 ? '等' : ''} · 共 ${members.length} 项` : '还没有收录内容。'));
      body.append(row);
    } else if (missing) body.append(element('span', 'skill-copy-condition', '已保留这张场景卡的携带记录，可卸下或刷新确认。'));
    back.append(body, element('span', 'skill-card-hint', '场景手册展开内容 · 轻触翻回 ↻'));
    turn.append(front, back); flip.append(turn); tilt.append(flip); card.append(tilt);
    const actions = element('div', 'skill-actions');
    const equip = button(equipped ? 'skill-remove' : 'skill-add', equipped ? '卸下场景卡' : '携带场景卡', equipped ? 'remove' : 'add');
    equip.setAttribute('aria-label', `${equipped ? '卸下' : '携带'}场景 ${scene.name} ${equipped ? '于' : '给'} ${selectedAgent().name}`);
    equip.setAttribute('aria-pressed', String(equipped));
    if (missing && !equipped) equip.disabled = true;
    actions.append(equip);
    if (!missing) { const info = button('skill-info', '场景手册', 'detail'); info.setAttribute('aria-label', `查看 ${scene.name} 的场景手册`); actions.append(info); }
    card.append(actions); setFlipped(card, flipped.has(cardKey(scene.id))); return card;
  }
  function renderRoster() {
    const roster = $('agent-portraits'); if (!roster) return;
    roster.replaceChildren(...profiles.agents.map(agent => {
      const portrait = button('agent-portrait', ''); portrait.dataset.agentRef = agent.id; portrait.dataset.lineage = agent.lineage;
      portrait.setAttribute('aria-pressed', String(agent.id === profiles.selectedAgentRef)); portrait.setAttribute('aria-label', `选择角色 ${agent.name}`);
      portrait.append(element('span', 'agent-portrait-emblem', LINEAGES[agent.lineage].emblem), element('span', 'agent-portrait-name', agent.name), element('span', 'agent-portrait-lineage', LINEAGES[agent.lineage].label)); return portrait;
    }));
  }
  function renderEquipped() {
    const grid = $('equipped-cards'); if (!grid) return; grid.replaceChildren(); if (view !== 'profile') return;
    const scenes = new Map((snapshot?.scenes || []).map(scene => [scene.id, scene]));
    for (const id of selectedIds()) {
      const scene = scenes.get(id);
      grid.append(createCard(scene || { id, name: snapshot ? '场景待确认' : '场景待读取', description: snapshot ? '这张已携带的场景卡目前不在卡库中。' : '正在读取这张场景卡的内容。' }, !scene));
    }
    if (!selectedIds().length) grid.append(element('p', 'inventory-empty profile-empty', '还没有携带场景卡。去场景卡库，为这位旅伴选择要做的事。'));
    const legacyBox = $('legacy-loadout');
    if (legacyBox) {
      const ids = profiles.legacySkillIds[profiles.selectedAgentRef] || [];
      legacyBox.hidden = !ids.length;
      const list = $('legacy-loadout-list');
      const skills = new Map((snapshot?.skills || []).map(skill => [skill.id, skill]));
      list.replaceChildren(...ids.map(id => element('li', '', skills.get(id)?.name || id)));
    }
  }
  function renderArmory() {
    const grid = $('inventory-grid'); if (!grid) return;
    const scrollTop = panel.scrollTop, gridScrollTop = grid.scrollTop;
    grid.replaceChildren();
    const more = $('inventory-more'); if (more) more.hidden = true; if (view !== 'armory') return;
    const filtered = [...(snapshot?.scenes || [])]
      .filter(scene => `${scene.name} ${scene.description || ''} ${scene.review?.title || ''} ${scene.review?.value || ''} ${scene.members.map(member => member.name).join(' ')}`.toLocaleLowerCase().includes(query))
      // Keep source and loadout order intact. This ordering exists only in the
      // armory view so the two reviewed pilots are easy to inspect together.
      .sort((left, right) => Number(Boolean(right.review)) - Number(Boolean(left.review)));
    grid.append(...filtered.slice(0, limit).map(scene => createCard(scene)));
    if (!filtered.length && !loading) grid.append(element('p', 'inventory-empty', query ? '没有找到匹配的场景，试试场景或其中的技能名称。' : snapshot ? '还没有场景卡。先在场景中组织内容，再带上整张卡。' : '场景卡库尚未读取成功，请重试。'));
    if (more) { more.hidden = filtered.length <= limit; more.textContent = `继续查看 · ${Math.min(limit, filtered.length)} / ${filtered.length}`; }
    grid.scrollTop = gridScrollTop; panel.scrollTop = scrollTop;
  }
  function render() {
    if (disposed) return;
    const viewChanged = panel.dataset.view !== view;
    const scrollTop = viewChanged ? 0 : panel.scrollTop;
    resetTilt(); panel.dataset.view = view;
    const agent = selectedAgent(), style = LINEAGES[agent.lineage];
    $('profile-view').hidden = view !== 'profile'; $('armory-view').hidden = view !== 'armory';
    for (const name of ['profile', 'armory']) { const tab = $(`${name}-tab`); tab.setAttribute('aria-selected', String(name === view)); tab.tabIndex = name === view ? 0 : -1; }
    setText('inventory-title', view === 'profile' ? '我的角色' : '场景卡库'); setText('inventory-role-title', agent.name);
    setText('profile-lineage', `${style.label} · 本地角色`); setText('profile-summary', style.summary);
    setText('profile-traits', style.traits);
    setText('profile-status', '本地角色 · 配装只保存在本机'); setText('armory-agent-name', agent.name);
    setText('inventory-loadout-count', selectedIds().length); setText('inventory-library-count', snapshot?.sceneTotal ?? '—');
    setText('inventory-material-count', snapshot ? `${snapshot.sceneTotal} 张场景卡 · ${snapshot.total} 项底层技能${snapshot.unassignedSkillCount ? ` · ${snapshot.unassignedSkillCount} 项待归入场景` : ''}` : '正在打开你的场景收藏…');
    setText('inventory-source-state', snapshot ? `${stale ? '保留上次完整快照' : '场景卡库已读取'} · ${new Date(snapshot.observedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : loading ? '正在读取卡牌大师…' : '卡库尚未读取');
    const error = readError || storageError;
    if ($('inventory-error')) { $('inventory-error').hidden = !error; $('inventory-error').textContent = error; }
    if ($('inventory-loading')) { $('inventory-loading').hidden = !loading; $('inventory-loading').textContent = '正在读取场景与其中的内容…'; }
    if ($('inventory-refresh')) $('inventory-refresh').disabled = loading;
    const demoBox = $('inventory-demo');
    if (demoBox) { demoBox.hidden = !demo || view !== 'profile'; demoBox.replaceChildren(); if (demo) { const card = button('demo-chip', '◇ 万象重构镜 · 探索收藏 · 圣品样卡', 'demo'); card.id = 'inventory-demo-card'; demoBox.append(card); } }
    renderRoster(); renderEquipped(); renderArmory();
    if (viewChanged) {
      // WKWebView may retain the accessibility subtree of a formerly hidden
      // tabpanel. Give the active panel a fresh AX container, retaining its
      // inputs/cards and delegated listeners. Its stable ID preserves the tab
      // relationship; the external tab retains focus during view changes.
      const activePanel = $(`${view}-view`);
      const visiblePanel = activePanel.cloneNode(false);
      visiblePanel.append(...activePanel.childNodes);
      activePanel.replaceWith(visiblePanel);
      // WebKit can also retain the former tab's AX subtree on the enclosing
      // modal. Refresh that container while retaining controls and listeners.
      refreshPanelAccessibility();
    }
    // Replacing a long card list briefly shrinks its scroll range. Restore the
    // physical reader position after rebuilding, including equip and refresh.
    panel.scrollTop = scrollTop;
  }
  function focusView() { $(`${view}-tab`)?.focus({ preventScroll: true }); }
  function changeView(nextView, focus = true) { view = nextView === 'armory' ? 'armory' : 'profile'; render(); if (focus) focusView(); emit(); }
  function selectAgent(ref) {
    if (!profiles.agents.some(agent => agent.id === ref)) return;
    profiles.selectedAgentRef = ref; limit = PAGE_SIZE; persist(); render(); emit();
    [...($('agent-portraits')?.querySelectorAll('[data-agent-ref]') || [])].find(node => node.dataset.agentRef === ref)?.focus({ preventScroll: true });
  }
  function equipScene(id, equip) {
    if (equip && !snapshot?.scenes.some(scene => scene.id === id)) return;
    const ids = new Set(selectedIds()); if (equip) ids.add(id); else ids.delete(id);
    profiles.sceneLoadouts[profiles.selectedAgentRef] = [...ids]; persist(); render(); emit();
    const grid = $(view === 'profile' ? 'equipped-cards' : 'inventory-grid');
    const card = [...grid.querySelectorAll('[data-scene-id]')].find(node => node.dataset.sceneId === id);
    (card?.querySelector('[data-action="add"], [data-action="remove"]') || $(`${view}-tab`)).focus({ preventScroll: true });
  }
  function releaseDetailBackground() {
    for (const [node, inert] of detailInert) node.inert = inert;
    detailInert = [];
    detailBackdrop?.remove(); detailBackdrop = null;
  }
  function closeDetail() {
    detailSession++;
    releaseDetailBackground();
    const detail = $('inventory-detail');
    if (detail) { detail.hidden = true; detail.removeAttribute('data-open'); }
    if (!disposed && detailReturnFocus?.isConnected) { refreshPanelAccessibility(); detailReturnFocus.focus({ preventScroll: true }); }
  }
  function showDetail(scene, trigger) {
    const review = isSceneReview(scene.review) ? scene.review : null;
    let dialog = $('inventory-detail');
    if (!dialog) {
      dialog = element('section', 'inventory-detail'); dialog.id = 'inventory-detail'; dialog.hidden = true; dialog.tabIndex = 0; dialog.setAttribute('aria-labelledby', 'inventory-detail-title'); dialog.setAttribute('role', 'region'); panel.append(dialog);
      listen(document, 'keydown', event => {
        const activeDetail = $('inventory-detail');
        if (!activeDetail?.hasAttribute('data-open')) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDetail(); return; }
        if (event.key !== 'Tab') return;
        const nodes = [...activeDetail.querySelectorAll('button:not([disabled]),summary')].filter(node => node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (!activeDetail.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      });
    }
    const session = ++detailSession;
    detailReturnFocus = trigger;
    const header = element('header', 'handbook-header'), heading = element('div');
    const title = element('h2', '', review ? review.title : scene.name); title.id = 'inventory-detail-title';
    heading.append(
      element('span', 'eyebrow', review ? '场景试点评审手册' : '场景手册'),
      title,
      element('span', 'handbook-original-name', review ? `${scene.name} · ${review.gradeLabel} · ${reviewSsrLabel(review)}` : '品阶未评定 · 待绘制'),
    );
    const dismiss = button('handbook-dismiss', '×', 'close-detail'); dismiss.setAttribute('aria-label', '返回场景卡');
    header.append(heading, dismiss);
    const body = element('div', 'handbook-body');
    body.append(element('p', 'handbook-value', review ? review.value : sceneDescription(scene)));
    if (review) {
      const chapter = (label, value) => {
        const section = element('section', 'handbook-chapter');
        section.append(element('h3', '', label), element('p', '', value)); return section;
      };
      body.append(
        chapter('适合用在', review.useWhen),
        chapter('能做什么', review.ability),
        chapter('边界', review.boundary),
        chapter('鉴定依据', review.basis),
        chapter('证据类型与适用范围', `${review.evidenceSummary}\n适用范围：${review.scope}`),
      );
      const freshness = review.freshness === 'matched'
        ? `${review.reviewedAt} 鉴定留档；卡库成员与登记版本相符。外部知识库规则未在每次打开时重新审核。`
        : '场景材料已有变化；此试评保留作参考，使用前请重新核对。';
      body.append(element('p', 'handbook-review-state', freshness));
      if (review.nextStep) body.append(chapter('下一步', review.nextStep));
      if (review.breakthrough) {
        const breakthrough = element('details', 'handbook-fold handbook-breakthrough');
        breakthrough.append(element('summary', '', `${reviewSsrLabel(review)} · 展开突破观察`));
        breakthrough.append(element('p', 'handbook-note', '这份记录只说明本次审核看到的突破依据；不会把它当作自动发放的永久奖章。'));
        const grid = element('div', 'handbook-breakthrough-grid');
        for (const [label, value] of [['此前限制', review.breakthrough.before], ['新的做法', review.breakthrough.after], ['改变发生在', review.breakthrough.example], ['仍然适用的边界', review.breakthrough.boundary]]) {
          const item = element('section', 'handbook-breakthrough-item');
          item.append(element('h4', '', label), element('p', '', value)); grid.append(item);
        }
        breakthrough.append(grid); body.append(breakthrough);
      }
    }
    if (onManageScene) {
      const manage = button('game-action handbook-manage', '整理此场景 ↗');
      manage.addEventListener('click', () => { closeDetail(); onManageScene(scene.id); }); body.append(manage);
    }
    const composition = element('section', 'handbook-members');
    composition.append(element('h3', '', `场景里的内容 · ${scene.members.length}`), element('p', 'handbook-note', '这些技能共同组成这张场景卡。展开一项，阅读作者的完整说明。'));
    if (!scene.members.length) composition.append(element('p', 'handbook-note', '这里还没有内容。整理此场景，加入需要的技能。'));
    for (const skill of scene.members) {
      const original = element('details', 'handbook-fold handbook-member'), sourceBody = element('div', 'handbook-source-body');
      original.dataset.memberId = skill.id;
      original.append(element('summary', '', skill.name), element('p', 'handbook-member-description', skill.description || '这项技能尚未提供简短说明。'), sourceBody);
      const sourceStatus = element('p', 'handbook-note', '展开后读取这项技能的原始说明。'); sourceStatus.setAttribute('role', 'status'); sourceBody.append(sourceStatus);
      let sourceLoading = false, sourceLoaded = false;
      const loadSource = async () => {
        if (sourceLoading || sourceLoaded || disposed || session !== detailSession) return;
        sourceLoading = true; sourceStatus.textContent = '正在翻开原始说明…';
        const previousRetry = sourceBody.querySelector('button');
        const retryHadFocus = previousRetry === document.activeElement;
        previousRetry?.remove();
        if (retryHadFocus) original.querySelector('summary').focus({ preventScroll: true });
        try {
          if (!readDocument) throw new Error('当前预览尚未连接原始说明。');
          const doc = await readDocument(skill.id);
          if (disposed || session !== detailSession || !dialog.hasAttribute('data-open')) return;
          if (!doc || doc.skill_id !== skill.id || typeof doc.content !== 'string') throw new Error('原始说明未完整返回，请重试。');
          sourceLoaded = true;
          sourceStatus.textContent = doc.truncated ? '说明较长，当前显示前 128 KiB，尚未读完全部内容。' : 'Skill 原文 · 保留作者完整表述';
          sourceBody.append(element('pre', 'handbook-source', doc.content || '原始说明为空。'));
        } catch {
          if (disposed || session !== detailSession || !dialog.hasAttribute('data-open')) return;
          sourceStatus.textContent = '原始说明暂时打不开。场景卡与配装仍然保留。';
          const retry = button('handbook-retry', '重新读取'); retry.addEventListener('click', () => void loadSource()); sourceBody.append(retry);
        } finally { sourceLoading = false; }
      };
      original.addEventListener('toggle', () => { if (original.open) void loadSource(); });
      composition.append(original);
    }
    body.append(composition);
    const provenance = element('details', 'handbook-fold handbook-provenance');
    provenance.append(element('summary', '', '关于这张场景卡'), element('p', 'handbook-note', '场景说明和组成来自 Skill Manager。加入内容会丰富同一张卡；内容数量不代表品阶，也不等于已经验证了协作效果。'), element('p', 'handbook-note', '本机携带只保存这个角色选择的场景，不会运行技能或更改远端 Agent。'));
    body.append(provenance);
    dialog.replaceChildren(header, body);
    // Keep this folio inside the existing inventory modal. A second dynamic
    // dialog is excluded from WKWebView's AX tree in this host.
    releaseDetailBackground();
    dialog.hidden = false; dialog.setAttribute('data-open', 'true');
    // Refresh the formerly hidden container with its contents already present.
    const visibleDetail = dialog.cloneNode(false);
    visibleDetail.append(...dialog.childNodes); dialog.replaceWith(visibleDetail); dialog = visibleDetail;
    dialog.scrollTop = 0; dismiss.focus({ preventScroll: true });
    // Move focus into the visible folio before isolating its old focus owner.
    // Otherwise WebKit can retain an empty AX subtree for the inventory panel.
    detailInert = [...panel.children, root.querySelector('.toy-wilds-portal-bar')].filter(node => node && node !== dialog).map(node => [node, node.inert]);
    for (const [node] of detailInert) node.inert = true;
    detailBackdrop = element('div', 'handbook-backdrop'); detailBackdrop.setAttribute('aria-hidden', 'true'); panel.append(detailBackdrop);
    refreshPanelAccessibility(); dismiss.focus({ preventScroll: true });

  }
  function refresh() {
    if (disposed) return Promise.resolve(); if (refreshPromise) return refreshPromise;
    loading = true; readError = ''; render(); emit();
    refreshPromise = (async () => {
      try {
        const data = await readInventory(); if (disposed) return;
        if (!data || !Array.isArray(data.skills) || !Array.isArray(data.scenes) || !Array.isArray(data.targets) || !Number.isInteger(data.total) || data.total !== data.skills.length || data.skills.some(skill => !skill || typeof skill.id !== 'string' || !skill.id || typeof skill.name !== 'string') || new Set(data.skills.map(skill => skill.id)).size !== data.total || data.sceneTotal !== data.scenes.length || !Number.isInteger(data.unassignedSkillCount) || data.unassignedSkillCount < 0 || data.unassignedSkillCount > data.total || data.scenes.some(scene => !scene || typeof scene.id !== 'string' || !scene.id || typeof scene.name !== 'string' || typeof scene.description !== 'string' || !Array.isArray(scene.skillIds) || !Array.isArray(scene.members) || scene.grade !== null || !(scene.review == null || isSceneReview(scene.review)) || scene.members.some(member => !member || typeof member.id !== 'string' || typeof member.name !== 'string')) || new Set(data.scenes.map(scene => scene.id)).size !== data.sceneTotal) throw new Error('场景卡库数据不完整，未替换上次快照。');
        snapshot = data; stale = false;
      } catch (error) {
        if (disposed) return;
        readError = snapshot ? '实时读取失败，继续保留上次完整卡库。' : typeof error === 'string' && error.trim() ? error : error?.message || '读取卡牌大师失败，请重试。'; if (snapshot) stale = true;
      } finally { refreshPromise = null; if (!disposed) { loading = false; render(); emit(); } }
    })();
    return refreshPromise;
  }
  function open(collected, nextView = 'profile') {
    if (disposed) return; if (panel.hidden) restoreFocus = document.activeElement;
    demo = Boolean(collected); panel.hidden = false; changeView(nextView, false); $('inventory-close').focus({ preventScroll: true });
    if (!snapshot || Date.now() - Date.parse(snapshot.observedAt) > 30000) void refresh();
  }
  listen(panel, 'click', event => {
    const trigger = event.target.closest('button'); if (!trigger || trigger.disabled || !panel.contains(trigger)) return;
    if (trigger.dataset.action === 'close-detail') { closeDetail(); return; }
    if (trigger.id === 'inventory-close') { onClose?.(); return; }
    if (trigger.id === 'profile-tab') { changeView('profile'); return; }
    if (trigger.id === 'armory-tab' || trigger.id === 'profile-open-armory') { changeView('armory'); return; }
    if (trigger.id === 'inventory-refresh') { void refresh(); return; }
    if (trigger.id === 'inventory-more') { limit += PAGE_SIZE; renderArmory(); return; }
    if (trigger.dataset.agentRef) { selectAgent(trigger.dataset.agentRef); return; }
    if (trigger.dataset.action === 'demo') { onDemo?.(); return; }
    const card = trigger.closest('[data-scene-id]'); if (!card) return; const id = card.dataset.sceneId;
    if (trigger.dataset.action === 'flip') {
      const key = cardKey(id), value = !flipped.has(key); if (value) flipped.add(key); else flipped.delete(key); setFlipped(card, value);
    } else if (trigger.dataset.action === 'add' || trigger.dataset.action === 'remove') equipScene(id, trigger.dataset.action === 'add');
    else if (trigger.dataset.action === 'detail') { const scene = snapshot?.scenes.find(item => item.id === id); if (scene) showDetail(scene, trigger); }
  });
  listen($('inventory-search'), 'input', event => { query = event.target.value.trim().toLocaleLowerCase(); limit = PAGE_SIZE; renderArmory(); });
  listen($('agent-create-form'), 'submit', event => {
    event.preventDefault(); const name = $('agent-name').value.trim(), lineage = $('agent-lineage').value;
    const error = !name ? '给新角色起一个名字。' : name.length > 40 ? '角色名字请控制在 40 个字以内。' : !Object.hasOwn(LINEAGES, lineage) ? '请选择角色族系。' : profiles.agents.length >= 100 ? '本机角色已达到 100 个上限。' : '';
    if ($('agent-create-error')) { $('agent-create-error').hidden = !error; $('agent-create-error').textContent = error; }
    if (error) { $('agent-name').focus(); return; }
    const agent = newAgent(name, lineage); profiles.agents.push(agent); profiles.sceneLoadouts[agent.id] = []; profiles.legacySkillIds[agent.id] = []; profiles.selectedAgentRef = agent.id;
    $('agent-name').value = ''; view = 'profile'; limit = PAGE_SIZE; persist(); render(); emit(); focusView();
  });
  listen(panel, 'pointermove', event => {
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { resetTilt(); return; }
    const card = event.target.closest('.skill-card'), tilt = card?.querySelector('.skill-card-tilt'); if (!tilt) { resetTilt(); return; }
    if (tiltedCard !== tilt) resetTilt(); const rect = card.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    tiltedCard = tilt;
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1)), y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    tilt.style.setProperty('--card-tilt-x', `${(-y * 3).toFixed(2)}deg`); tilt.style.setProperty('--card-tilt-y', `${(x * 4).toFixed(2)}deg`);
    const art = card.querySelector('.scene-card-art');
    if (art) {
      art.style.setProperty('--holo-x', `${((x + 1) * 50).toFixed(1)}%`);
      art.style.setProperty('--holo-y', `${((y + 1) * 50).toFixed(1)}%`);
      art.dataset.holoActive = 'true';
    }
  }, { passive: true });
  listen(panel, 'pointerout', event => { if (!event.relatedTarget || !event.target.closest('.skill-card')?.contains(event.relatedTarget)) resetTilt(); }, { passive: true });
  listen(panel, 'keydown', event => {
    // The handbook owns Escape and focus while it is open.
    if (event.target.closest('#inventory-detail')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (view === 'armory') changeView('profile'); else onClose?.(); return; }
    if (['profile-tab', 'armory-tab'].includes(event.target.id) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); changeView(event.key === 'Home' ? 'profile' : event.key === 'End' ? 'armory' : view === 'profile' ? 'armory' : 'profile'); return;
    }
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button:not([disabled]):not([tabindex="-1"]),select:not([disabled]),input:not([disabled]),summary,[tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1); if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  persist(); render();
  return {
    open, openArmory() { open(demo, 'armory'); },
    close() {
      if (disposed || panel.hidden) return; closeDetail(); resetTilt(); panel.hidden = true;
      if (restoreFocus?.isConnected && root.contains(restoreFocus)) restoreFocus.focus({ preventScroll: true });
    },
    refresh,
    dispose() {
      if (disposed) return; disposed = true; resetTilt(); for (const remove of removers.splice(0)) remove();
      releaseDetailBackground(); const dialog = $('inventory-detail'); if (dialog) dialog.remove(); detailReturnFocus = null; restoreFocus = null; flipped.clear();
    },
    get viewport() { return $('inventory-character').getBoundingClientRect(); },
    get state() { return { selectedAgentRef: profiles.selectedAgentRef, agentName: selectedAgent().name, lineage: selectedAgent().lineage, appearance: appearance(), view, draftSceneIds: [...selectedIds()], draftSkillIds: projectSceneSkillIds(snapshot?.scenes, selectedIds()), localAgentCount: profiles.agents.length, ready: Boolean(snapshot), loading, error: readError || storageError || null, stale, total: snapshot?.total || 0, sceneTotal: snapshot?.sceneTotal || 0, unassignedSkillCount: snapshot?.unassignedSkillCount || 0, multicaBound: false, roleRef: profiles.selectedAgentRef }; },
  };
}
