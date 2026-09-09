"use strict";

(() => {
  // Art identity and style names follow recipes.json; only the requested sheet loads.
  const styles = {
    pokemon: {
      number: "01",
      name: "精灵冒险 · 赛璐珞",
      materialTitle: "清晰色面，把复杂圣物画得轻盈",
      material: "利落墨线收住三重开环，象牙白与古金用分层赛璐珞明暗塑形。青绿晶核保持通透，珊瑚扣件成为一眼可认的暖色记号。",
      mapTitle: "沿着草地小径，发现池畔的光",
      map: "明亮的冒险路线连接池塘与低台座。缩小后的镜体强化环形剪影和青色核心；原创长身守护者留在水边，建立装备与地域的联系。",
      reference: "Pokémon TCG",
      referenceUrl: "https://www.pokemon.com/uk/news/get-ready-for-a-pikachu-parade-in-pokemon-tcg-30th-celebration",
      referenceCopy: "借用明快描线与收藏插画的视觉语法，器物与守护者均为原创设计。"
    },
    bruno: {
      number: "02",
      name: "玩具旷野 · 低多边形",
      materialTitle: "把圣物，做成想拿在手里的玩具",
      material: "厚实开环与切面青色树脂构成主体，象牙白、赭金和深蓝像上色木件与哑光塑料。层次靠倒角和体块成立，不依赖细碎金属纹饰。",
      mapTitle: "一条能继续走下去的暖色小径",
      map: "陶土色小径串起台座与池塘，镜体的开环结构呼应池畔的半环水路。小型拾取物与水边守护者共享几何玩具语言；道路向画外延伸，连接更大的地图。",
      reference: "Bruno Simon · folio 2025",
      referenceUrl: "https://bruno-simon.com/",
      referenceCopy: "参照可探索微缩世界的体块、温暖地景与材质关系。本图仍是静态美术试作。"
    },
    hd2d: {
      number: "03",
      name: "像素秘境 · 立体景深",
      materialTitle: "让像素簇，承担材质与结构",
      material: "用明确的像素台阶组织三重开环，以有限色阶区分象牙、古金与深蓝握柄。青色高光集中在晶核；近景保留清晰像素，不以模糊制造细节。",
      mapTitle: "在有纵深的旧世界里，留一束亮光",
      map: "石径、灌木与池塘形成俯视 RPG 场景，柔光和远景景深拉开空间。拾取物压缩细节、保留开环和晶核，让小尺寸装备在环境中仍有识别点。",
      reference: "HD-2D · OCTOPATH",
      referenceUrl: "https://eu.store.square-enix-games.com/octopath-traveler-0---digital",
      referenceCopy: "参照像素图形与立体光照的结合，重新绘制原创镜体、场景及守护者。"
    },
    mythic: {
      number: "04",
      name: "神话绘卷 · 手绘强轮廓",
      materialTitle: "用利落剪影，画出圣物的重量",
      material: "角度鲜明的手绘轮廓包住雕塑般的色面。午夜蓝阴影压住古金与象牙高光，青绿晶核和珊瑚扣件在克制的暗色中形成有力的视觉落点。",
      mapTitle: "穿过深色石径，抵达静谧圣池",
      map: "等距视角下，磨损石道、雕刻石块与深青池水围合成神话圣所。镜体以亮色晶核区别于环境，优雅的池塘守护者栖于水边，维持独立角色。",
      reference: "Hades · Supergiant",
      referenceUrl: "https://www.supergiantgames.com/games/hades-ii/",
      referenceCopy: "参照强轮廓、画笔色面与戏剧性明暗；器物、守护者与构图均为原创。"
    }
  };

  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panel = document.getElementById("study");
  const art = document.getElementById("style-image");
  const error = document.getElementById("image-error");
  const status = document.getElementById("load-status");
  let currentId = "pokemon";
  let requestedId = currentId;
  let requestNumber = 0;

  function showError(message) {
    error.hidden = false;
    status.textContent = message;
    panel.removeAttribute("aria-busy");
  }

  art.addEventListener("error", () => {
    showError("当前概念图尚未就绪，可以重试或浏览其他风格。");
  });
  art.addEventListener("load", () => { error.hidden = true; });
  if (art.complete && art.naturalWidth === 0) {
    showError("当前概念图尚未就绪，可以重试或浏览其他风格。");
  }

  function updateCopy(id) {
    const style = styles[id];
    document.getElementById("study-index").textContent = `STYLE STUDY / ${style.number}`;
    document.getElementById("study-title").textContent = style.name;
    document.getElementById("material-heading").textContent = style.materialTitle;
    document.getElementById("material-copy").textContent = style.material;
    document.getElementById("map-heading").textContent = style.mapTitle;
    document.getElementById("map-copy").textContent = style.map;
    const reference = document.getElementById("reference-link");
    reference.replaceChildren(document.createTextNode(`${style.reference} `));
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    reference.append(arrow);
    reference.href = style.referenceUrl;
    document.getElementById("reference-copy").textContent = style.referenceCopy;
    document.getElementById("original-link").href = `./assets/${id}.png`;
    art.alt = `${style.name}风格概念图：左侧为万象重构镜的卡面装备特写，右侧为同一件装备在池塘小径旁的地图拾取态。`;
    panel.setAttribute("aria-labelledby", `tab-${id}`);
    tabs.forEach((tab) => {
      const selected = tab.dataset.style === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  }

  async function selectStyle(id, force = false) {
    if (!styles[id]) return;
    if (id === currentId && error.hidden && !force) {
      // Selecting the displayed sheet also cancels a pending different selection.
      requestedId = id;
      requestNumber += 1;
      panel.removeAttribute("aria-busy");
      status.textContent = "";
      return;
    }
    requestedId = id;
    const thisRequest = ++requestNumber;
    panel.setAttribute("aria-busy", "true");
    status.textContent = `正在载入「${styles[id].name}」…`;
    const incoming = new Image();
    incoming.decoding = "async";
    const source = `./assets/${id}.png`;
    try {
      await new Promise((resolve, reject) => {
        incoming.onload = resolve;
        incoming.onerror = reject;
        incoming.src = force ? `${source}?retry=${Date.now()}` : source;
      });
      if (typeof incoming.decode === "function") await incoming.decode();
      if (thisRequest !== requestNumber) return;
      // Keep the last artwork visible until the requested full sheet is decoded.
      art.src = incoming.src;
      error.hidden = true;
      currentId = id;
      updateCopy(id);
      status.textContent = `当前浏览：${styles[id].name}`;
    } catch {
      if (thisRequest !== requestNumber) return;
      if (art.naturalWidth > 0) {
        status.textContent = `「${styles[id].name}」暂未载入，继续显示当前概念图。`;
      } else {
        showError(`「${styles[id].name}」暂未载入，请稍后重试。`);
      }
    } finally {
      if (thisRequest === requestNumber) panel.removeAttribute("aria-busy");
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectStyle(tab.dataset.style));
    tab.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      // Manual activation: arrows move focus, Enter/Space loads the focused sheet.
      tabs.forEach((item, itemIndex) => { item.tabIndex = itemIndex === nextIndex ? 0 : -1; });
      tabs[nextIndex].focus();
    });
  });

  document.getElementById("retry-image").addEventListener("click", () => selectStyle(requestedId, true));
})();
