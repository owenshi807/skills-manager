# Portal 接入调研：保留默认 SaaS，按需进入全窗口旷野

调研日期：2026-09-09。范围：当前 checkout 的路由、状态、原型、构建与 Tauri 边界。只读检查后编写本文；没有实施 UI、修改权限、安装依赖或启动任务。

## 决策

**可做 `Layout` 的 sibling `GameShell`，保留现有 `ThemeProvider`、`AppProvider` 与单一 `BrowserRouter`。采用“保存后台 location、保留原页面实例、前台只显示游戏”的路由结构。** 用户在使用场景中的 Portal 明确点击后，才懒加载游戏。退出后恢复原 URL、组件状态、实际滚动容器与焦点。

不能只添加 `<Route path="/play/toy-wilds" element={<GameShell/>}/>` 然后依赖 providers 恢复页面：路由切换会卸载 `Scenes`，它的搜索词、分页、筛选和展开状态并不在 `AppProvider` 中。直接 sibling route 能隐藏侧栏，却不满足“回来还是刚才的页面”。

首版不需要新的数据库、MCP server、后台常驻进程、WebView 窗口或权限。主 App 内应直接复用现有 Tauri 只读命令。原型的 localhost server 与 MCP 子进程桥接保留为独立浏览器原型工具，不进入桌面生产链路。

## 已核实的接点

| 文件 | 当前事实 | 接入动作 |
| --- | --- | --- |
| [App.tsx](/Users/owen/Projects/Skill_card_master/app/src/App.tsx) | 所有业务路由都位于无 path 的 `Layout` route 内；两个 providers 在 `BrowserRouter` 外；`SceneAutoClassifier` 也位于路由外。 | 在 Router 内增加轻量 `PortalRoutes` 协调层，保留原业务 route 定义，另设懒加载游戏路由。providers 不搬动、不重复创建。 |
| [Layout.tsx](/Users/owen/Projects/Skill_card_master/app/src/components/Layout.tsx) | `Sidebar`、28px 顶部拖动条、`CommandPalette` 在同一 Layout 内；内容区 `min-w-[600px]`，页面最大宽 1200px；真正滚动的是内层 `overflow-y-auto` div。 | 游戏不能放进其 `Outlet`。为滚动容器提供稳定 ref/标识；游戏期间整棵 SaaS shell 隐藏、inert，Layout 的全局快捷键停用。 |
| [Scenes.tsx](/Users/owen/Projects/Skill_card_master/app/src/views/Scenes.tsx) | `scene` 和 `capability` 在 URL query；`search`、`sceneSearch`、`statusFilter`、`page`、表单与 `showSkillTools` 是组件本地 state；15 秒刷新场景数据。 | Portal 放在选中场景的内容中，建议 `activeScene` 标题/能力区附近。原场景卡仍按原方式进入场景，不替换默认导航。保留 Scenes 实例来保存本地 state。 |
| [AppContext.tsx](/Users/owen/Projects/Skill_card_master/app/src/context/AppContext.tsx) | 共用 `tools`、`managedSkills`、错误、加载、详情选择等；监听 `app-files-changed`；启动包含本地发现、更新检查和用户已开启的自动更新。 | GameShell 使用同一个 provider，不能在 Portal 进入时重新挂载它，否则重复初始化和后台工作。不能把 `managedSkills.targets.status` 当作实时部署验证。 |
| [skillPublishing.ts](/Users/owen/Projects/Skill_card_master/app/src/lib/skillPublishing.ts) | 已有 `getSkillLibrary()`，调用 `get_skill_library`，返回 `[LibrarySkillView[], CanonicalGroup[]]`。`deployments` 带 `actual_status`。 | 新增很薄的 Tauri inventory adapter 映射此返回值；无需新增 Rust API。TS 的 `LibrarySkill` 当前是字段子集，若展示源版本，补齐后端已有的 `source_revision` 等字段声明。 |
| [skill_publish.rs](/Users/owen/Projects/Skill_card_master/app/src-tauri/src/commands/skill_publish.rs) | `get_skill_library` 用同一 `SkillStore`，在 blocking task 中执行共享 `list_library`；命令已在 [lib.rs](/Users/owen/Projects/Skill_card_master/app/src-tauri/src/lib.rs) 注册。 | 原生 App 内直接调用；不用启用助手 MCP 权限才能展示自己的库。 |
| [AssistantConnections.tsx](/Users/owen/Projects/Skill_card_master/app/src/views/AssistantConnections.tsx) | 页面管理 MCP 的 enabled、allow_file_writes 与 Codex/Claude 配置连接。没有 Multica workspace 或角色绑定契约。 | 保留 SaaS 页面。游戏可只读展示连接说明；不能把 MCP 连接状态当作 Multica Agent 身份/执行权限，也不能因打开 Portal 自动连接助手。 |
| [main.tsx](/Users/owen/Projects/Skill_card_master/app/src/main.tsx) | App 在 `StrictMode` 下；当前只有整个 App 的 error boundary。 | GameShell 需要自身 error boundary，失败提供“返回原页面”；引擎 setup/dispose 必须能承受开发模式重复挂载。 |

## 路由与返回语义

推荐结构示意，属于设计说明，不是已实施代码：

```text
ThemeProvider
└─ AppProvider                         保持原实例
   ├─ SceneAutoClassifier              保持原实例与已有用户设置
   ├─ BrowserRouter
   │  ├─ PortalRoutes
   │  │  ├─ SaaS host                  游戏中 hidden + inert；不卸载
   │  │  │  └─ Routes(location = backgroundLocation ?? location)
   │  │  │     └─ Layout → 原有 pages
   │  │  └─ Game host                  仅明确进入时挂载
   │  │     └─ game error boundary → Suspense → GameShell
   │  ├─ HelpDialog / CloseActionGuard / FirstRunRestoreDialog
   │  └─ 原有全局交互协调
   └─ ThemedToaster
```

本地已安装 React Router 的 `RoutesProps.location` 接受 `Partial<Location> | string`；其实现会为被覆盖的 route 树提供相应 LocationContext，因此后台 Scenes 的 `useSearchParams()` 可继续看到原页面 query。证据：[已安装 Router 声明](/Users/owen/Projects/Skill_card_master/app/node_modules/react-router/dist/development/instrumentation--6Pioq_G.d.ts:2379)。不需要切换 Router 框架或增加 keep-alive 依赖。

具体约束：

1. Portal 进入前保存完整内部 `location`（pathname、search、hash、key）、实际内容滚动 div 的 `scrollTop/scrollLeft`、触发按钮 ref。`sceneId` 是世界上下文，不是自动创建新场景或角色的授权。
2. 原业务 route 树的组件位置和 key 保持不变；仅以背景 location 匹配原页面。不能在 `isGame ? <Game/> : <SaaS/>` 中条件卸载 SaaS，也不能以当前 location.key 给整棵 route 树加 key。
3. 游戏当前 route 建议 `/play/toy-wilds?scene=<stable-scene-id>`。这是新的显示状态，不改变默认 `/`、`/scenes` 或左侧导航入口。
4. GameShell 用独立外层，填满当前 WebView；原 Sidebar、顶部拖动条与 SaaS 内容都不显示、不参与 hit-test/Tab。`aria-hidden` 不能单独实现这点，还需要 `inert` 和隐藏样式。
5. 游戏内部的详情、装备袋、样卡返回遵循自己的状态机；最外层“返回场景”才关闭 Portal。浏览器/系统 Back 也必须走同样的清理与恢复路径，不能留下 WebGL 帧循环。
6. 返回只在存在本次 Portal entry 时回退该记录；否则跳转到安全的 `/scenes`。冷启动/刷新落到游戏 URL 时，不凭旧 URL 自动开启世界；没有活动 Portal session 就恢复 SaaS，并提示从场景入口进入。不要无条件 `history.back()`，以免离开 App。
7. SaaS 重新显示后，用 layout effect 与下一帧恢复实际滚动容器，随后 `focus({preventScroll:true})` 返回原按钮。数据在游戏期间更新、内容高度变短时，滚动位置钳制到当前可用范围；原搜索与筛选不应被清空。
8. 不要重写或手动替换 React Router 的 `history.state` 内部字段。触发 Portal 用 Router navigation state；后台 Location 与 DOM refs 存在轻量会话状态中，不写入业务数据库。

“隐藏”不等于“停用”：Layout 的 `Cmd+,` / `Cmd+R`，以及 [CommandPalette.tsx](/Users/owen/Projects/Skill_card_master/app/src/components/CommandPalette.tsx) 的 `Cmd+K` 监听 `window`，即便节点 inert 仍会响应。需要明确 `surfaceActive` 门控或在游戏期间卸载仅这些快捷键处理器；不能靠 z-index 遮住它们。App 关闭/托盘行为继续由 [CloseActionGuard.tsx](/Users/owen/Projects/Skill_card_master/app/src/components/CloseActionGuard.tsx) 管理。

AppProvider 的托盘更新入口和 toast action 会直接导航到 `/my-skills` 或 `/install`。这种真实导航发生时，应结束当前 Portal session、dispose 游戏并显示目标 SaaS 页面，不能让“固定后台 location”把导航吞掉。

## 共享数据：替换传输，不创建第二份权威库

主 App 的 GameShell 读取同一业务服务：

```ts
// 示意契约；实现时保留统一的 DTO 映射和失败保留逻辑。
interface GameInventoryPort {
  readSnapshot(): Promise<GameInventorySnapshot>;
}

// 原生版本：getSkillLibrary() + 现有 ToolInfo。
// 浏览器原型版本：GET /api/inventory。
// UI / renderer 不知道 SQLite、CLI 路径、MCP tool 名称或部署写方法。
```

- `useApp().tools` 可用于目标名称和检测状态；明确刷新时同步 `refreshTools()` 与 `getSkillLibrary()`。实际部署必须取本次 `LibrarySkillView.deployments.actual_status`，不能由目录检测、`enabled` 或旧记录推算。
- `actual_status === current` 才表示已部署且与库一致；存在目标但非 current 显示“部署需检查”；没有目标记录显示“未登记部署”。现有 API 不提供 absent/diverged 的确定细分，不添加虚构状态。
- ID 是技能身份；名称、`canonical_name` 和目录后缀不是版本。源版本取 `source_revision`，为空展示未记录；`content_hash` 只是 Manager 记录的指纹。
- [skillPublishing.ts](/Users/owen/Projects/Skill_card_master/app/src/lib/skillPublishing.ts) 的 `LibrarySkill` 目前未声明 `source_revision`，但 Rust [SkillRecord](/Users/owen/Projects/Skill_card_master/app/src-tauri/src/core/skill_store.rs) 已返回此字段。应补齐类型后直接使用同一次返回；不要为省类型调整而拼接一份更旧的 `managedSkills` 版本信息。
- App 原生调用一次返回整库，不需要原型 MCP 的 cursor 分页。前端仍可显示分页/搜索。完整返回成功才替换旧快照；失败保留旧快照并标记 stale，不用空数组冒充真实空库。
- 场景成员来自 `getSceneOverview()` 与 `sceneId`，只是游戏中可选的范围/入口上下文；同一 Skill 的部署情况仍来自共享库，不把“属于场景”换算为“已装备/已执行”。
- 角色保持 `local:explorer`；携带清单按 runtime target 存浏览器本地状态，保持本地准备语义。现有原型 origin 与 Tauri origin 的 localStorage 独立，首版不自动搬运原型草稿；这不影响主 App 页面的返回恢复。
- 开 Portal、查看装备、拾取样卡和调整草稿，不调用 deploy/undeploy、publish、canonical 选择、MCP connect 或任务 launch。
- `AssistantConnections` 的 MCP 可用、允许发布，与 Multica 是否已绑定不是同一层。首版保留未连接/未绑定的事实；检测 `/Applications/Multica.app` 的 Node/plutil 逻辑不移入浏览器组件，也不因此新增 shell 权限。

保留 providers 也保留已有后台行为：[SceneAutoClassifier.tsx](/Users/owen/Projects/Skill_card_master/app/src/components/SceneAutoClassifier.tsx) 在用户先前开启自动归类时会运行，AppProvider 在用户开启自动更新时会更新。因此应验收“Portal 交互未新增任何写操作”，而不是错误承诺“整个 App 进游戏后绝不发生任何后台写入”。此次显示模式切换不应擅自修改已有用户设置，也不应重复挂载这些后台组件。

## 原型迁移与懒加载

当前 [原型 app.js](/Users/owen/Projects/Skill_card_master/app/prototypes/toy-wilds/app.js) 是页面级自执行程序：全局 ID 查询、直接修改 `document.body.dataset.mode`、document/window 事件、永久 rAF、`innerWidth/innerHeight` 尺寸、全局测试函数；[inventory.js](/Users/owen/Projects/Skill_card_master/app/prototypes/toy-wilds/inventory.js) fetch HTML 后 append 到 body。直接 import 它不会形成安全的 React 子应用。

迁移边界应是一个可销毁的引擎实例：

```ts
mountToyWilds({ canvas, root, inventoryPort, onExit, sceneContext })
  → { dispose(), resize(), pause(), resume() }
```

1. 将 `world.js`、`actors.js`、`navigation.js`、`card.js` 的程序化几何/玩法模块搬到独立 game feature。保留现有 Three 模型，不引入 React Three Fiber 或第二套渲染栈。
2. React `GameShell` 管生命周期、UI 根节点、Portal 返回和错误边界；渲染器继续使用 imperative Three。装备袋由 React 组件或 scoped DOM controller 管理都可，但 controller 必须接收 root/transport，并能撤销所有节点/事件，不能 append 任意 UI 到 body。
3. `React.lazy(() => import(...GameShell))` 与局部 `Suspense` 仅在显式进入时发生。重型 Three 模块、几何创建、卡片 CanvasTexture 和 CSS 只能由 lazy feature 导入；入口场景中的 Portal 本身是轻量 UI，不导入模型。
4. 游戏 CSS 全部位于 `.toy-wilds-root` 或 CSS Modules 下。原型的 `:root`、`body`、`button`、`footer`、`[hidden]` 与 `#game { position:fixed }` 不能原样带入全局，避免退出后更改 SaaS 布局/按钮/字体。
5. 事件绑定用有清晰清理路径的 named handlers/AbortController；返回时 cancelAnimationFrame、移除 ResizeObserver/media listeners、清除测试 hooks 和临时 dataset。开发 StrictMode 的 setup→cleanup→setup 必须只有一个有效引擎和一套键盘事件。
6. `dispose()` 释放 renderer、纹理、材质、几何与场景引用。`actors.js` 有模块级复用几何/材质缓存：应明确由一个 engine resource owner 管理或重置缓存；不能逐 mesh 重复释放共享对象，也不能把 dispose 后的缓存当作仍有效资源。优先把资源生命周期限制在当前游戏会话，退出停止 GPU 工作。
7. `preserveDrawingBuffer:true` 当前用于原型截图；生产交互没有这一硬性需求，不应无条件沿用。继续保留 DPR 上限、减弱动画、页面后台暂停；context lost 时给出重试/返回入口，不拖垮 SaaS。

依赖事实：主 [app/package.json](/Users/owen/Projects/Skill_card_master/app/package.json) 没有 `three`；仅 [旧原型独立安装](/Users/owen/Projects/Skill_card_master/app/prototypes/skill-holo-3d/web/node_modules/three/package.json) 提供 `0.180.0`。这不是主 App 可发布依赖。后续获准实施时应在 app manifest/lock 中明确加入当前已验证版本，并为 TypeScript facade 提供匹配类型。当前 [tsconfig.app.json](/Users/owen/Projects/Skill_card_master/app/tsconfig.app.json) 是 strict 且 include 仅 src；不要为了直接导入原型而全局关闭类型检查或开启宽松隐式 any。此次调研没有安装依赖。

当前 [vite.config.ts](/Users/owen/Projects/Skill_card_master/app/vite.config.ts) 没有将 prototypes 当作生产入口；`frontendDist` 指向 dist。因此不能把“开发时能读到原型目录/另一个 node_modules”视为 DMG 已打包成功。所有代码/本地素材走 Vite 静态 import 或 `new URL(..., import.meta.url)`；不保留 `/vendor/three.module.js`、inline import map、`fetch('./inventory.html')` 或固定端口 4185 依赖。

## Tauri、窗口与缩放

| 边界 | 当前配置与结论 |
| --- | --- |
| CSP | [tauri.conf.json](/Users/owen/Projects/Skill_card_master/app/src-tauri/tauri.conf.json) 的 script-src 为 self，connect-src 为 IPC 与 HTTPS；没有允许 `http://127.0.0.1:4185`。Vite 内置 chunk + Tauri invoke 符合现有路线，不应为嵌入 localhost 原型扩 CSP。WebGL shader 字符串不是 JS eval，不需要新增 unsafe-eval。 |
| capabilities | [default.json](/Users/owen/Projects/Skill_card_master/app/src-tauri/capabilities/default.json) 作用于 main window，已允许 start-dragging。没有给前端通用 shell 执行权限；本方案用已注册的 App 命令，不需要新增 permission。 |
| 全窗口含义 | 主窗口保留现有大小、装饰与 OS 关闭行为。全窗口指覆盖 WebView 内容，不是调用 `requestFullscreen()` 或改系统 fullscreen/window decorations。Portal 点击不调用这些 API。 |
| macOS 标题区 | 当前 titleBarStyle=Overlay、hiddenTitle=true。移除旧 Layout 顶条后，为系统 traffic lights 预留点击安全区；必要的透明拖动 hit area 可复用 [useDragWindow.ts](/Users/owen/Projects/Skill_card_master/app/src/hooks/useDragWindow.ts)，不能盖住游戏按钮/画布交互区。 |
| 最小窗口 | 原生配置 minWidth=1100、minHeight=640。390px 是浏览器原型/响应式补充验收，不能为此擅改原生最小宽度。生产重点至少覆盖 1100×640 和默认 1440×860。 |
| App 文本缩放 | [textScale.ts](/Users/owen/Projects/Skill_card_master/app/src/lib/textScale.ts) 对 documentElement 设置 zoom=0.9/1/1.1/1.2；[index.css](/Users/owen/Projects/Skill_card_master/app/src/index.css) 用 app-scale 调整 html/body/root 尺寸。不能直接沿用原型 innerWidth/innerHeight 与固定 body CSS。以实际 canvas/host rect 建立尺寸、指针和 scissor 的统一换算，显式测试所有缩放值；不重置用户 text_size。 |

## 最小实施顺序

1. **先打通 Portal 空壳往返**：Scenes 增加一个轻量入口；App 内保留背景 route；GameShell 占满窗口并可退出；完成原 query/搜索/分页/滚动/焦点恢复。这一步不接 Three，先证明路由与状态方案。
2. **接入可销毁引擎与 lazy chunk**：把 renderer factory、scoped styles、原有几何和交互搬入 game feature；加入正式 Three 依赖及类型；做 StrictMode 和反复开关清理。
3. **注入 Tauri 只读 inventory adapter**：getSkillLibrary + tools，保持 UI 现有真实 ID/部署/stale 语义；本地草稿独立存储；不迁入 Node server/MCP spawn。
4. **补齐入口上下文和失败返回**：将当前 sceneId 传给游戏；缺失场景、WebGL 不可用、chunk 加载失败均有可见返回入口；助手权限页保持现状。
5. **构建与原生验收**：检查生产 manifest/chunks 和 dist，运行现有基本检查、Portal 往返测试、装备袋回归，以及原生 WebView 下的 CSP/字体缩放/交通灯拖动测试。浏览器测试通过不能替代 WKWebView 发布构建检查。

不纳入首版：独立 Agent/persona 系统、Multica 任务派发、跨进程控制、全库状态重构、背景任务策略改造、权限扩张、原生窗口重建、自动迁移原型草稿。这些都不是满足 Portal 显示模式与安全返回的必要条件。

## 必要验收

- 冷启动仍是当前 SaaS；没有 Portal 点击时，没有 Three/world 资源请求、WebGL context 或游戏 rAF。已有导航、安装与助手页面行为不变。
- 在 `/scenes?scene=...&capability=...` 输入搜索、切筛选、翻页、展开区域并滚动，进入 Portal 后原侧栏/顶条不可见且不可聚焦；退出后 URL/state/展开/滚动/焦点还原。
- 正常返回、系统 Back、退出前发生外部 SaaS 导航、游戏 chunk 拒绝加载、WebGL 创建失败，都不会把原页面替换成 App 级崩溃页。
- 游戏中 Cmd+K、Cmd+, 不会激活不可见 SaaS UI；退出后这些快捷键恢复。关闭窗口/隐藏托盘仍按现有用户设置执行。
- 反复开关至少 20 次，只有一个活跃引擎；退出没有游戏 rAF、keydown/media/resize 残留；资源计数不随进入次数单调增长。StrictMode 下同样成立。
- 真实技能数和 ID 与 `get_skill_library` 同批返回一致；部署仅依据 actual_status；本地携带变化不发任何 deploy/publish/connect/launch 操作；失败保留旧快照并显示 stale。
- AppProvider、SceneAutoClassifier 不因 Portal 反复重新初始化；已有自动归类/更新设置保持原值；应用级数据变化能在返回页与下一次装备袋核验中被观察到。
- 1100×640、1440×860，text scale 0.9/1/1.1/1.2、高 DPR、reduced motion 下，画布、拾取点击与角色 scissor 对齐；原生 traffic lights 和拖动仍可用。390px 保留浏览器响应式验收。
- 发布构建能离线打开游戏，不依赖 prototypes 路径、另一目录 node_modules、CDN、localhost server、Node/plutil 或 MCP enabled 状态；现有 CSP/capabilities 零变更。

## 已完成的验证与未验证项

已逐项检查上述源文件、已安装 Router 的 location override 类型/实现、现有 Three 安装版本、Tauri CSP/capabilities、App 缩放与引擎全局副作用。写入后通过脚本核验全部 26 个本地链接均存在；本次仅写入本报告。

未做浏览器/原生实跑、构建、依赖安装或 UI 实施；因此没有声称该 Portal 已存在或性能验收已通过。当前结论是以代码证据支持的最小迁移设计。
