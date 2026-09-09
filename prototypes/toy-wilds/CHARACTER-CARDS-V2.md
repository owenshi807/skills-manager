# Portal · 角色与独立卡库

2026-09-09，针对用户提供的泉水截图及角色/仓库分离要求。

## 交付行为

- 池底顶面低于水面0.03，台座三个顶面分别0.65 / 0.67 / 0.692。连续低对比水色与独立水波取代共面扇形；没有用强制渲染排序遮盖穿面问题。
- 地图“角色”打开人物档案，“卡库”打开公共武器库。档案只呈现该角色分配的卡片。每张卡来自真实 Skill ID，鼠标轻转、点击翻面，装卸是独立动作。
- 可以创建、命名、切换本机角色，选择旷野族、铸造族、星语族或林风族。帽饰、披肩、颜色会同步到角色预览与地图人物。角色只按自己的携带数量显示卡片。
- 每个角色有稳定 UUID，配装保存于 `skills-manager.toy-wilds.agent-loadouts.v3`，不会把旧 runtime 草稿迁成角色装备。重新进入和重启后独立恢复。
- 未评审 Skill 明确显示“未评级”。器物徽记是由 ID 决定的基础装饰，不是 AI 审核、专属生成图或评级结果；圣品镜仍是独立的公共探索样卡，不自动装备给每个角色。
- 长卡库装卸后保持阅读位置。真实库读取失败/重复 ID 时保留上次完整快照和全部角色配装。

## 数据与权限边界

本版使用现有 Tauri `get_skill_library` 与 `get_tool_status` 读取受管库，没有增加新的业务写接口。创建的是本机角色及配装计划，尚未创建或改装真实 Multica Agent，也不启动任务或发放个人能力评级。角色族系是可扩展的外观/角色设定，不是假造的模型能力分数。

[当前 Multica 所有权核验](research/multica-owned-agent-probe.md) 确认可见10个Agent、自有0个。后续绑定必须核实真实认证身份和owner；不能把“可见”当成“自有”。连接后台是后续单独的适配工作。

## 实现与验收

`src/features/toy-wilds` 是正式产品实现，4183/4184/4185历史原型不作为本版验收页面。

- `node --test tests/world-geometry.test.mjs tests/actor-identity.test.mjs`：共面消除、520帧水波净空、角色材质与携带隔离。
- `node --experimental-strip-types --test src/features/toy-wilds/tests/inventory-port.test.mjs`：真实库存投影、完整性、失败与只读调用。
- `node scripts/test-portal.mjs`：默认SaaS、Portal状态恢复、20次释放、90–120%缩放、真实加载失败、样卡和只读边界。
- `node scripts/test-characters.mjs`：逐卡翻面、角色A/B配装及重启隔离、滚动位置、390px/短窗、双水波周期、实际人物外观。

浏览器验收使用明确标记的隔离fixture，与原生真实数据验收分别记录。复用已安装Playwright/Chrome、Three几何，不下载浏览器或大型纹理包；只保留最终代表截图与精简报告。

最终结果：10项单测、Portal生产9/9、角色生产8/8、官方动作客户端通过；原生实际434 Skills，已创建“观星者”，仅本机分配knowledge-audit，另一个角色仍为空。重开恢复成功，原生动态卡库AX及键盘翻面已实测。详见[最终分层验收](verification/character-cards-v2/native-validation.json)。
