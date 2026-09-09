# 四境试作 · 万象重构镜

同一件圣品设计预览，四种风格，每张同时包含装备近景和开放地图拾取态。使用已安装的 `skill-card-forge`，联动系统 `imagegen` 出图，并读取原 `holo-card-studio` 美术与分层约定。这里没有实际授奖，不改变 Skill 评级与 Profile。

在本目录运行 `python3 -m http.server 4184 --bind 127.0.0.1`，打开 <http://127.0.0.1:4184/>。零新增前端依赖，四张原画按需载入；方向键移动焦点，Enter / Space 选择。无自动轮播、闪卡或翻转。

## 风格与选择

| 风格 | 器物表达 | 地图用途与代价 |
| --- | --- | --- |
| 精灵冒险 / Pokémon TCG | 明快描线、赛璐珞、鲜明青绿与珊瑚色 | 容易建立收藏欲；完整三维地图需要另做造型与材质规则 |
| 玩具旷野 / Bruno Simon | 粗厚开环、哑光塑料/木件、少面晶体 | 下一步推荐方向；大轮廓适合地图，细节靠结构和局部领域而非金属雕花 |
| 像素秘境 / HD-2D | 像素簇、有限色阶与景深 | 适合 2.5D 地图；正式资产需要统一像素网格与相机尺度 |
| 神话绘卷 / Hades | 强轮廓、暗底亮核、手绘明暗 | 圣所与神器氛围突出；手绘高密度场景的批量一致性成本更高 |

四者为代表性方向，不是热度排行榜。保留原创镜体与生灵，没有复刻角色、标志或卡牌版式。

视觉参照来自 [Bruno Simon 实站](https://bruno-simon.com/) 与 [作者的 folio-2025 源码](https://github.com/brunosimon/folio-2025)、[Pokémon TCG 官方卡图介绍](https://www.pokemon.com/uk/news/get-ready-for-a-pikachu-parade-in-pokemon-tcg-30th-celebration)、[OCTOPATH TRAVELER 0 官方 HD-2D 说明](https://eu.store.square-enix-games.com/octopath-traveler-0---digital)、[Hades II 官方画面](https://www.supergiantgames.com/games/hades-ii/)。已实际浏览 Bruno 的暖陶土地图、池塘与可行走路径；未克隆仓库或下载其模型。

## 这次生成检验了什么

- 固定青绿晶核、开环重连结构、珊瑚扣件、深蓝双柄；品阶不随风格改变。四张图的主装备身份可以对应。
- 四种媒介已可辨认：明快线描、几何玩具、像素质感、深色手绘。它们是生成的概念图，HD-2D 尚不等于像素网格经过工程检验的 sprite。
- Bruno 第一版保留了过多珠宝细节，守护者过大，器物与水域只有并置。二版指定哑光粗体块、减少雕花、相对人物比例、镜环形水路，实际图中已出现对应变化。`recipes.json` 保存原 prompt、修订原因和修订 prompt。
- 二版已形成可读的半环水路与桥接关系，但还不是精确三环、尺度稳定的生产结构图；不能把文字目标当作几何测量结果。
- 其他三版的守护者仍比“小型生灵”目标更大，属于通过风格辨认、尚待地图构图收紧的概念稿。没有将这项偏差伪报为全量通过。
- 画风比较通过；四套生产资产验收未执行。一次生成能对照美术方向，不能证明量产稳定性。

这些经验已经回写 `skill-card-forge`：锁定少量身份锚点，明确媒介材质与体块，用参照角色约束地图比例，把领域关系画成可见结构，视觉检查后再决定是否修订。

## Skill 联动与行为验证

| Skill / 能力 | 状态与职责 |
| --- | --- |
| `skill-grade-review` | 已通过 Skill Manager 安装并部署至 Codex；审核 Skill 方法与独立永久 SSR 成就 |
| `skill-card-forge` | 已安装部署；读取审核交接，生成、换风格、同品演化及 3D 交接 |
| `holo-card-studio` | 原有安装可用；RedSkill 商店包 `holo-card` 1.0.1，对应原始制卡能力 |
| 系统 `imagegen` / `image_gen` | 本轮真实出图路径；未启用旧同名付费 CLI |

两个新 Skill 均通过 `quick_validate.py`。独立行为测试确认：已有 SSR 不随当前未验证状态撤销；画得漂亮不能授奖或写 Profile；静态图不声称体积 3D；供应商 pipeline 不能覆盖已有定制 viewer。

测试还发现 `scope` 容易被误填为“重绘任务”。现已明确 scope 必须是被审核方法的应用范围，纯美术请求透传原评级。复验「R + recorded SSR，仅要求简化画面」保留 R 与 recorded。源包与 Manager 中实际部署版本一致。

## 与真实 3D 的下一步

先用玩具旷野做一件可拾取镜体和一个小池塘场景，测行走距离下的识别与领域联动；点击后打开同身份的精细卡面。地图装备需要独立真实体积模型；holo-card 原流水线生成的厚卡体为 3D，图绘装备分层仍是 2.5D，两者不能混称。

选定的卡面随后拆成对齐的 subject / background / lineart / text 和 foil/core masks，走保留 `viewer-src` 的本地 rebuild 适配层。保留鼠标位置轻转、点击翻面；C/R 无镭射，SR 局部、SSR 可全卡但排除文字。四张对照图还不是这套分层资产，不要直接覆盖现有 4183 原型。

## 文件与空间

- `assets/`：四张最终对照原画，PNG 原质量；`asset-manifest.json` 记录生成来源与 SHA-256。
- `recipes.json`：可替换的四套 `style_recipe`；复用一个 Skill，避免复制四个同职能 Skill。
- `cleanup-report.json`：删除的确切文件和字节数。
- 已清理 325,645,233 bytes（310.56 MiB）：已解包并验证可执行的 Blender DMG、两份被较新工程替代的 `.blend1`。保留 Blender 运行时、两个 `.blend`、最终画面、prompt 和用途不明的备份。系统可用空间变化还受其他进程影响，不把整体差额归功于本次清理。
