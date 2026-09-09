后续已补齐 [真实 3D 镭射样卡](http://localhost:4183/)：鼠标轻微随动、点击卡面翻转。[制作源文件](../skill-holo-3d/README.md)。

# Skill Card Master · 视觉概念图集与旧原型

当前主交付是 [精灵冒险图鉴概念图集](concepts.html)。它用三张原画说明：Skill 是可升级装备；Agent 是装备这些 Skill 的游戏角色；人类 Profile 不等于 Agent 的能力或等级。精灵冒险图鉴是第一套推荐方向，长期主题仍可替换。

旧 [三主题交互原型](index.html) 保留为「秘藏馆 / 光谱实验室 / 探索手册」的材质和仪式对照；它不代表精灵方向已经做成可运行 UI。该原型根目录 `/` 的静态服务入口也仍指向旧页面。

## 图集内容与来源

| 原画 | 尺寸 | 含义 |
|---|---:|---|
| [adventure-tiers.png](assets/adventure-tiers.png) | 1774×887 | 同一 `依赖镜头` Skill 装备的 C/R/SR/SSR 材质对照 |
| [adventure-agent-room.png](assets/adventure-agent-room.png) | 1536×1024 | Agent 角色与已装备 Skill；底部 C/R/SR 卡是**等级材质对照**，不是同一 Skill 的三件重复装备 |
| [adventure-ssr-storyboard.png](assets/adventure-ssr-storyboard.png) | 1774×887 | 同一 Skill 装备的 SSR 突破分镜，供评审对照 |

原画由本轮内置 `image_gen` 按 holo-card 的主体/背景/线描/文字图层语言生成合成概念画。完整提示词见 [adventure-prompts.json](assets/adventure-prompts.json)，文件来源、尺寸和 SHA-256 见 [adventure-provenance.json](assets/adventure-provenance.json)。holo-card-studio 没有预设主题、rarity 预设或授奖动画。

这些都是概念原画：未拆分主体 alpha、背景、注册线描、文字、foil mask 或纹章图层；未生成 `.blend`、glTF 或 Three.js shader；未训练或接入 Agent 模型。正式生产要按图层合同重新制作资产，并用确定性排版绘制文字。

## 视觉规则

完整规则在 [视觉合同](../../docs/skill-visual-system-v1.md)，实际评级条件在 [评级基础](../../docs/skill-rating-foundation-v1.md)。这里不改变评级条件。

- 同一 Skill 在 C/R/SR/SSR 中保持同一装备身份。C 是完整藏品；R 仅图像局部 foil；SR 有金属压边和受控 holo；SSR 新增能解释突破的永久纹章与重组结构。
- 文字不做镭射或发光，也不被 foil 覆盖。稀有度由等级文字、边框和纹章共同表达。
- SSR 在生产中永久隐藏，直到合法成就解锁；图集里的 SSR 仅为评审对照，不能推出概率、进度或预留槽。
- 新资料、安装 Skill、改文本和调用次数不自动升级。只有评级或成就结果变化才可触发事件。
- 首次 SSR 可以跳过动画或使用 reduced motion，但取消/跳过不能撤销已经成立的成就；重放不能重复授奖。
- 更换为秘藏馆、机甲、像素 RPG、东方灵兽等主题时，复用图层接口、等级门控和事件；器物/角色插画、线描和 mask 需重做，不能只套滤镜。

## 旧交互原型

在本目录运行：

```bash
node server.mjs
```

打开 [旧交互原型](http://localhost:4177)。服务器只监听 `127.0.0.1`，没有 npm 依赖或构建步骤；端口被占用时可用 `PORT=4178 node server.mjs`。该原型的等级、入库、卡组与 SSR 都是演示数据：不调用 Tauri、不写真实 Skill 库、不发真实奖章，也不修改 Profile。

旧原型使用 CSS/DOM 卡体透视和材质近似。其 PNG 没有真实内部多层视差，不能据此声称已运行 3D。后续若选定某套主题，先把一张卡制成真实分层样本，再推广至详情页；列表保持轻量表达。

## 检查

```bash
node --check app.js
node --check server.mjs
```

语法检查不能替代真实浏览器检查。旧原型的历史验收记录见 [verification.md](verification.md)；精灵方向以 `concepts.html` 和上述三张原画为本轮交付边界。
