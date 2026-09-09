# 玩具旷野 · 镜之圣所

用户认可 Bruno 方向后的第一个可玩小区域。沿石路行走，接近万象重构镜，拾取入袋，打开同身份的实体卡片，再返回地图。场景、角色和装备都由真实三维网格构成，不使用二维概念图冒充三维模型。

正式产品归属：装备袋、卡片与地图应进入 Skill Manager 内的场景视图，共用其受管 Skill 库。Multica 是可选的 Agent 执行连接。本目录仍是独立验证原型，尚未合入主程序；后续优先合入产品，再接真实 Agent 执行。

运行：在本目录执行 `node server.mjs`，打开 <http://127.0.0.1:4185/>。默认端口 4185；支持 `PORT`。复用 `../skill-holo-3d/web/node_modules/three` 的 r180，无新增依赖和纹理包。干净环境需先在旧原型 web 目录按其 lockfile 执行 `npm ci`。

## 操作

- 点击小径前往，或 WASD / 方向键按相机方向行走；角色会避开水池、树干、灯座和围栏。
- 点击镜体标记可前往；靠近后按 E 或再次点击拾取。
- 随时打开「角色与装备」；拾取后也会进入装备袋。点「万象重构镜 · 探索样卡」查看三维卡片，鼠标移入轻转，离开回正，点击 / Enter / Space 翻面。
- 卡片中的 Esc / 返回按钮回到装备袋；装备袋中的 Esc 返回原地。
- F 切换全屏；Esc / P / 暂停按钮休息。重新体验只重置本次探索。
- 触屏使用地面点击与拾取标记。系统减少动态效果时关闭角色摆动/领域闲置动画/卡片悬停倾斜，翻面仍可立即完成。

## 风格与实现

延续 [Bruno Simon](https://bruno-simon.com/) 的可探索玩具场景方向，采用本项目原创装备、生灵和地景；参照 [作者的 folio-2025](https://github.com/brunosimon/folio-2025)。这里不是其地图或模型的复制品。

`world.js` 定义地景与碰撞，`actors.js` 定义装备和探险者，`navigation.js` 负责小型网格寻路，`app.js` 连接探索状态，`card.js` 复用装备模型并显示可翻转厚卡。地形、水渠和守护者通过开环结构关联。`art-direction.json` 保存用户选定的画风与身份锚点。

使用 `develop-web-game` 的状态/时间步进/截图验证流程，并遵循 `skill-card-forge`、原 `holo-card-studio` 的视角镭射与独立文字约定。卡片是项目自己用 Three 创建的体积模型适配；没有重新运行或覆盖供应商 Blender pipeline，也没有新增 `.blend` / `.glb` 交付。

当前只有万象重构镜带有圣品**设计预览**。真实 Skill 从本机 Manager 只读获取，未评审的条目显示「未评级」，不会套用样卡等级。拾取样卡不颁发真实 SSR、不写 Skill 库、不修改 Profile；刷新会重置探索，但角色携带清单保存在浏览器本地。正式的品阶和永久 SSR 评审沿用既有 foundation，未在此处重建。

## 验证与保留边界

Skill 自带动作客户端已实际运行并检查截图和状态；因为系统包期待的新 Chromium 版本未缓存，在临时副本里只指定已有 Chromium executablePath，保留原动作与截图逻辑，避免下载大型浏览器。

`tests/verify.mjs` 覆盖完整拾取—卡片—返回、碰撞、暂停、重复拾取、键鼠翻面、减少动态与窄屏。可用 `PLAYWRIGHT_MODULE_FILE` 指定已安装 Playwright 的 ESM 入口，`PLAYWRIGHT_EXECUTABLE_PATH` 指定已有浏览器，`TOY_WILDS_URL` 指定站点，`TOY_WILDS_TEST_OUTPUT` 指定临时输出。测试不安装依赖。

`verification/` 仅保留检查结果与少量最终验收截图；其他临时测试截图在收尾时删除。没有下载额外浏览器、Blender 或模型库。

这次交付验证了一块小区域的美术与交互。它还不包括世界分区加载、多区域传送、Agent 训练、装备属性或 Multica 真实 Agent 绑定/执行。碰撞使用可核验的简化形状，不是刚体物理模拟；地图里尚未提供相机自由旋转。

## 角色装备袋与真实库

`inventory.html/css/js` 展示本地旷野角色、运行环境中的已部署 Skills、完整仓库与按环境保存的角色携带草稿。清单通过稳定 Skill ID 记录，保留同名不同条目，源版本未记录时不推测版本。刷新和搜索不改变 Skill 正文、部署或 Agent 配置。

`server.mjs` 的固定 `GET /api/inventory` 经 `manager-bridge.mjs` 读取安装版 Manager MCP。启动前校验二进制版本与 `.mcp-version`；仅允许 `skills_manager_status`、`skills_agents`、`skills_list`。固定分页参数，同一 library revision 的完整快照才替换旧数据。暂时失败保留旧快照并标注过期；首次失败显示不可用，不伪造空库。接口仅供本机来源读取，不向浏览器透传任意 MCP 方法、文件路径或 runtime 配置。Manager 进程可进行自身索引/缓存初始化，这里的「只读」指不变更 Skill 内容、部署和业务配置。

「已部署」表示 Manager 核验的受管文件状态，不能证明某个具体 Agent 已加载或调用。Manager 的 Agent 列表实际是工具/运行环境；左侧人物目前为 `local:explorer`。携带清单以 `toy-wilds.role-loadouts.v1` 保存在当前浏览器 origin 的 localStorage，尚未同步给 Multica。`localhost` 和 `127.0.0.1` 属于不同 origin，应固定使用本 README 的地址。

本机已核实安装 Multica 0.4.39；未取得可用工作区和真实 Agent 清单，因此执行入口明确禁用。稳定身份、技能版本映射、运行结果回流与未来广场的边界见 [MULTICA-INTEGRATION.md](./MULTICA-INTEGRATION.md)。

`tests/inventory.mjs` 用真实 API 核对总量、部署与来源，验证本地携带持久化、错误保留、键盘焦点、窄屏和 API 只读边界。它只在独立浏览器上下文保存体验清单，不修改受管库。
