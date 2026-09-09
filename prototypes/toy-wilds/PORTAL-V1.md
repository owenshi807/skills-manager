# Portal v1 · 主程序里的玩具旷野

2026-09-09。用户已授权从归档研究进入第一版开发。此交付接在 [调研结论](research/README.md) 之后；研究中“尚未实施 Portal”是此前阶段状态。

## 已落实的产品形态

Skill Card Manager 默认保持现有工作台。在「使用场景」总览或具体场景中点击「进入玩具旷野 · PORTAL」，才加载游戏模块。主程序的侧栏、顶栏、页面会隐藏且停止接受交互。游戏占满窗口内容，保留原生窗口拖动区域。

第一站是既有玩具低多边形方向的「镜之圣所」：沿路走近镜体、拾取、在装备袋中看角色持有装备、打开同身份卡片。卡片只有鼠标轻转与点击翻面，没有自动旋转或自动闪卡。样卡、地图器物、人物手持器物共用造型。顶部始终可返回工作台。

返回后保留进入前的场景 URL、搜索、筛选、分页、展开状态、滚动和入口焦点。直接打开或刷新游戏 URL 会回到使用场景；浏览器 Back 退出，Forward 不会自动重新进入。加载失败或 WebGL 故障也可退出。

## 库和人物的边界

装备袋直接调用主程序已有的 `get_skill_library` 和 `get_tool_status`。它展示同一份受管 Skill 的稳定 ID、已记录源版本与实际部署状态，不要求原型桥接服务器，也不新增库副本。

人物目前为本地旷野探险者。携带清单是按运行环境隔离的本地体验草稿，使用新存储键，不把旧原型草稿冒认为真实 Agent 装备。它不改变实际部署。圣品「万象重构镜」是美术与交互样卡，不颁发 SSR 或个人能力；真实 Skill 没有评审证据时显示“未评级”。Multica 未绑定、执行按钮禁用。

场景名称随入口传入；v1 地形和样卡共用首个试验场。仓库显示全库，尚未按入口场景自动筛选或生成专属地图。

## 实现位置与运行

- `src/features/portal/`：显式入场会话、背景路由、工作台恢复、lazy 加载回退。
- `src/features/toy-wilds/`：GameShell、可释放 Three 引擎、模型、局部样式、原生只读库存适配器。
- `scripts/test-portal.mjs` / `scripts/portal-fixture.mjs`：浏览器验收及明确的测试数据。
- `verification/portal-v1/`：最终验收证据；原生结果和浏览器 fixture 结果分别记录。

本地运行 `npm run tauri:dev`；原生构建 `npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`。普通浏览器没有 Tauri IPC，完整真实库体验以原生 App 为准；浏览器验收使用明确 fixture，不伪造业务接通。

Three 0.180.0 已成为主程序正式锁定依赖。默认工作台不请求游戏 JS/CSS、不创建 WebGL；退出销毁 renderer、纹理、几何、材质、监听器和 observer，移除游戏时钟及测试 hooks。没有新增大型纹理、模型包或下载浏览器。游戏 chunk 约 154 KB gzip，仅入场时加载。

## 按顺序继续

1. 已完成：Portal 入口、地图、装备袋、样卡、返回以及同库只读接入。
2. 下一阶段：在主程序绑定用户自己的 Multica profile/workspace/Agent，显示真实角色身份、owner 和装备。先落正式只读 adapter，再准备隔离的增量装配及一次执行验收。
3. 之后：把 Skill 评审、凡灵天圣与生成资产接进真实 Skill 卡面；卡面升级依据持久化证据，圣品继续演变。
4. 最后：根据真实任务状态扩地图和协作广场。外部 Agent 只作为可委托服务，不管理其装备。

全量研究及 Skill 联动来源见 [归档索引](../../docs/archive/2026-09-09-skill-card-foundation/INDEX.md)。
