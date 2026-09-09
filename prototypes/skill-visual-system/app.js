(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = {
    theme: 'archive', scene: 'knowledge', tier: 'c', inDeck: false, demoCards: 0,
    ssr: sessionStorage.getItem('scm-ssr') === 'true', activeEvent: null, eventToken: 0, timers: [], lastFocus: null,
  };
  const scenes = {
    knowledge: { index: 'SCENE 01 · KNOWLEDGE VAULT', title: '知识炼成', objective: '让资料沉淀为可追溯、可判断、可复用的方法。', method: '让证据在需要时说话', description: '依赖会改变结论时，重开来源、区分独立证据；无关时保持安静。', actions: ['识别共享上游，避免重复计数', '保留独立反证与适用条件', '把高代价边界交给机械保障'] },
    business: { index: 'SCENE 02 · BUSINESS FIELDWORK', title: '商业研判', objective: '让市场信号沉淀为可检验、可比较、可行动的判断。', method: '从信号到下注条件', description: '用依赖镜头拆开一个商业判断的证据链：谁在变化、变化因何发生、什么条件下值得投入。', actions: ['拆出一个判断的可观察信号', '写明反转信号和止损条件', '把关键不变量放进决策检查单'] },
  };
  const pathCopy = { intake: '按任务选用，不是强制三步：先保住可追溯的原始线索。', distill: '把资料压成自己的判断：留下条件，删去复述。', collide: '让不同来源互相质询：反例能暴露方法的边界。' };
  const tierInfo = {
    c: ['C / 纸面', '普通纸面', 'C：普通纸面。它只证明这张方法卡被记录下来。'],
    r: ['R / 局部镭射', '局部镭射', 'R：只在图像局部折光；卡框不变，也不把整页染成彩虹。'],
    sr: ['SR / 金属压边', '金属压边', 'SR：金属压边与更完整的镭射、景深出现；文字依然保持清晰安静。'],
    ssr: ['SSR / 永久突破', '结构重组', 'SSR：不是更亮的卡，而是新原则改变了方法结构。成就已在本 session 保留。'],
  };
  const artByTheme = { archive: './assets/archive.png', prism: './assets/prism.png', journal: './assets/journal.png' };
  const hero = $('#hero-card'), dialog = $('#breakthrough-dialog'), dialogStage = $('#dialog-stage');

  function queue(fn, ms) { const id = window.setTimeout(() => { state.timers = state.timers.filter((timer) => timer !== id); fn(); }, ms); state.timers.push(id); return id; }
  function clearTilt() { hero.style.setProperty('--rx', '0deg'); hero.style.setProperty('--ry', '0deg'); }
  function cancelEvent() { state.eventToken += 1; state.timers.forEach(clearTimeout); state.timers = []; state.activeEvent = null; hero.style.animation = ''; $('#rank-button').disabled = false; $('#breakthrough-button').disabled = false; }
  function setStatus(text) { $('#ritual-status').textContent = text; }
  function setTier(tier, noteOverride) {
    if (tier === 'ssr' && !state.ssr) return;
    state.tier = tier;
    hero.className = `hero-card tier-${tier}${hero.classList.contains('is-flipped') ? ' is-flipped' : ''}`;
    $('#card-tier').textContent = tier.toUpperCase();
    $('#active-tier-label').textContent = tierInfo[tier][0];
    $('#card-material').textContent = tierInfo[tier][1];
    $('#tier-note').textContent = noteOverride || tierInfo[tier][2];
    $$('.tier-card').forEach((card) => { const active = card.dataset.tier === tier; card.classList.toggle('active', active); card.setAttribute('aria-pressed', String(active)); });
  }
  function renderDeck() {
    const items = $('#deck-items');
    const count = state.demoCards + (state.inDeck ? 1 : 0);
    $('#collection-count').textContent = `演示卡 ${count} 张`;
    if (!count) { items.innerHTML = '<span class="empty-deck">选择方法后加入；组合会在这里判断是否可用。</span>'; $('#deck-judgement').textContent = '当前还没有可执行的方法组合。'; return; }
    items.innerHTML = '';
    if (state.inDeck) { const item = document.createElement('span'); item.className = 'deck-item'; item.innerHTML = '<span>依赖镜头 · 方法</span><button type="button" aria-label="移出依赖镜头">×</button>'; item.querySelector('button').addEventListener('click', () => { state.inDeck = false; $('#deck-toggle').textContent = '加入演示卡组'; $('#deck-feedback').textContent = '已从本次卡组移出。'; renderDeck(); }); items.append(item); }
    for (let i = 0; i < state.demoCards; i += 1) { const item = document.createElement('span'); item.className = 'deck-item demo-entry'; item.innerHTML = `<span>新入库方法 · C${i + 1}</span><button type="button" aria-label="移出新入库方法 ${i + 1}">×</button>`; item.querySelector('button').addEventListener('click', () => { state.demoCards -= 1; $('#deck-feedback').textContent = '演示新卡已移出。'; renderDeck(); }); items.append(item); }
    $('#deck-judgement').textContent = state.inDeck ? '组合判断：依赖镜头已就位，可带着来源与条件执行下一次判断。' : '组合判断：已有材料，但还没有方法卡来组织它。';
  }
  function finishEvent(token) { if (token !== state.eventToken) return; state.activeEvent = null; $('#rank-button').disabled = false; $('#breakthrough-button').disabled = false; }
  function doRank() {
    if (state.activeEvent) return;
    cancelEvent(); state.activeEvent = 'rank'; const token = state.eventToken;
    $('#rank-button').disabled = true; $('#breakthrough-button').disabled = true;
    if (document.body.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTier('sr'); setStatus('动效已关闭：直接展示 SR 的压边、镭射与景深。'); finishEvent(token); return;
    }
    setTier('c'); setStatus('收光：只保留来源与结论。');
    hero.style.animation = 'rank-settle .45s ease both';
    queue(() => { if (token !== state.eventToken) return; setTier('r'); setStatus('形成 R：局部镭射只标出关键依赖关系。'); hero.style.animation = 'rank-settle .5s ease both'; }, 520);
    queue(() => { if (token !== state.eventToken) return; setTier('sr'); setStatus('级别落定 SR：压边与景深形成，方法结构更完整。'); hero.style.animation = 'rank-settle .6s ease both'; }, 1150);
    queue(() => { hero.style.animation = ''; finishEvent(token); }, 1680);
  }
  function showSSR() {
    state.ssr = true; sessionStorage.setItem('scm-ssr', 'true'); $('#ssr-card').hidden = false; $('#version-state').textContent = '本场景待验证 · SSR成就保留'; $('.dot').style.background = 'var(--rarity-gold-hi)'; setTier('ssr');
  }
  function finishBreakthrough(token, immediate = false) {
    if (token !== state.eventToken || state.activeEvent !== 'breakthrough') return;
    state.timers.forEach(clearTimeout); state.timers = [];
    if (immediate) dialogStage.classList.remove('is-revealing');
    $('#breakthrough-step').textContent = '新连接已成形';
    showSSR(); $('#breakthrough-copy').textContent = '共同信念进 Prompt，高代价不变量进机械门禁。';
    if (dialog.open) $('#close-breakthrough').focus();
    finishEvent(token);
  }
  function doBreakthrough(trigger) {
    if (state.activeEvent || dialog.open) return;
    cancelEvent(); state.activeEvent = 'breakthrough'; const token = state.eventToken; state.lastFocus = trigger;
    $('#rank-button').disabled = true; $('#breakthrough-button').disabled = true; $('#breakthrough-step').textContent = '旧刻线正在断开'; $('#breakthrough-copy').textContent = '旧方法把所有原则强制字段化，无法约束下一次高代价判断。'; dialogStage.classList.remove('is-revealing'); dialog.showModal();
    // The recorded achievement precedes its celebration; dismissal cannot revoke it.
    showSSR();
    if (document.body.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finishBreakthrough(token, true); return; }
    requestAnimationFrame(() => dialogStage.classList.add('is-revealing'));
    queue(() => { if (token === state.eventToken) $('#breakthrough-step').textContent = '新连接正在重组'; }, 1420);
    queue(() => finishBreakthrough(token), 2480);
  }
  function closeDialog() { if (dialog.open) dialog.close(); cancelEvent(); dialogStage.classList.remove('is-revealing'); if (state.lastFocus) state.lastFocus.focus(); }
  function updateTheme(theme) {
    state.theme = theme; document.body.dataset.theme = theme; $('#card-art').src = artByTheme[theme]; $$('.mini-art img').forEach((img) => { img.src = artByTheme[theme]; });
    const editions = { archive: 'ARCHIVE EDITION', prism: 'SPECTRUM EDITION', journal: 'FIELD EDITION' }; $('#card-edition').textContent = editions[theme];
    $$('.theme-choice').forEach((button) => { const selected = button.dataset.themeChoice === theme; button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  }
  function updateScene(scene) {
    state.scene = scene; const current = scenes[scene]; $('#scene-index').textContent = current.index; $('#scene-title').textContent = current.title; $('#scene-objective').textContent = current.objective; $('#method-heading').textContent = current.method; $('#method-description').textContent = current.description; $('#method-actions').innerHTML = current.actions.map((item) => `<li>${item}</li>`).join('');
    $$('.scene-choice').forEach((button) => { const selected = button.dataset.scene === scene; button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  }
  $$('.theme-choice').forEach((button) => button.addEventListener('click', () => updateTheme(button.dataset.themeChoice)));
  $$('.scene-choice').forEach((button) => button.addEventListener('click', () => updateScene(button.dataset.scene)));
  $$('.path-node').forEach((button) => button.addEventListener('click', () => { $$('.path-node').forEach((node) => { const active = node === button; node.classList.toggle('is-active', active); node.setAttribute('aria-pressed', String(active)); }); $('#path-copy').textContent = pathCopy[button.dataset.path]; }));
  $$('.tier-card').forEach((card) => card.addEventListener('click', () => { const tier = card.dataset.tier; if (tier === 'ssr' && !state.ssr) return; cancelEvent(); setTier(tier, tier === 'ssr' ? undefined : `${tierInfo[tier][2]} 这只是材质预览，不会撤回已记录的 SSR 突破。`); setStatus(`正在预览 ${tier.toUpperCase()} 材质。`); }));
  $('#deck-toggle').addEventListener('click', () => { state.inDeck = !state.inDeck; $('#deck-toggle').textContent = state.inDeck ? '移出本次卡组' : '加入演示卡组'; $('#deck-feedback').textContent = state.inDeck ? '已加入本次卡组。' : '已从本次卡组移出。'; renderDeck(); });
  $('#new-card-button').addEventListener('click', () => { if (state.activeEvent) return; state.demoCards += 1; renderDeck(); const entry = $('.demo-entry:last-child'); entry.style.animation = 'card-enter .72s cubic-bezier(.2,.8,.2,1) both'; $('#deck-feedback').textContent = `新卡入库完成：新增 1 张 C 级演示卡。`; setStatus('新卡只以 C 级入库；没有被自动晋级。'); });
  $('#rank-button').addEventListener('click', doRank); $('#breakthrough-button').addEventListener('click', (event) => doBreakthrough(event.currentTarget));
  $('#skip-breakthrough').addEventListener('click', () => finishBreakthrough(state.eventToken, true)); $('#dialog-close').addEventListener('click', closeDialog); $('#close-breakthrough').addEventListener('click', () => { finishBreakthrough(state.eventToken, true); closeDialog(); }); dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  $('#motion-toggle').addEventListener('click', (event) => { const turningOff = document.body.dataset.motion !== 'off'; if (turningOff && state.activeEvent === 'rank') { cancelEvent(); setTier('sr'); setStatus('动效已关闭：正在进行的晋级直接落定为 SR。'); } else if (turningOff && state.activeEvent === 'breakthrough') { finishBreakthrough(state.eventToken, true); } document.body.dataset.motion = turningOff ? 'off' : 'on'; if (turningOff) clearTilt(); event.currentTarget.textContent = turningOff ? '动效：关' : '动效：开'; event.currentTarget.setAttribute('aria-pressed', String(!turningOff)); });
  $('#narrow-toggle').addEventListener('click', (event) => { const shell = $('.prototype-shell'); const narrow = shell.classList.toggle('is-narrow'); event.currentTarget.textContent = narrow ? '退出 390 窄屏' : '390 窄屏预览'; event.currentTarget.setAttribute('aria-pressed', String(narrow)); });
  function flipCard() { const flipped = hero.classList.toggle('is-flipped'); clearTilt(); hero.setAttribute('aria-pressed', String(flipped)); $('#card-front').setAttribute('aria-hidden', String(flipped)); $('#card-back').setAttribute('aria-hidden', String(!flipped)); }
  hero.addEventListener('click', flipCard); hero.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flipCard(); } });
  hero.addEventListener('pointermove', (event) => { if (hero.classList.contains('is-flipped') || document.body.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; const rect = hero.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width; const y = (event.clientY - rect.top) / rect.height; hero.style.setProperty('--ry', `${(x - .5) * 10}deg`); hero.style.setProperty('--rx', `${(y - .5) * -8}deg`); hero.style.setProperty('--px', `${x * 100}%`); hero.style.setProperty('--py', `${y * 100}%`); });
  hero.addEventListener('pointerleave', clearTilt);
  if (state.ssr) { $('#ssr-card').hidden = false; $('#version-state').textContent = '本场景待验证 · SSR成就保留'; }
  updateTheme(state.theme); updateScene(state.scene); renderDeck(); setTier(state.ssr ? 'ssr' : 'c');
})();
