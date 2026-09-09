# 依赖镜头 · 装备进化与 3D 镭射样卡

本项目补齐概念图之后的 Blender → glTF → Three.js 制作流程。卡体有真实厚度、卡边与正反面几何；内部器物/背景使用分层贴图和视角相关 UV 视差，不宣称器物本身是完整体积模型。

打开 [3D 样卡](http://localhost:4183/)。最新交互合同：鼠标在卡片上移动时轻微倾斜，移出回正；点击卡面翻转，再点击翻回。无自动赏卡、无拖拽模式、无独立翻面按钮。Enter/Space 为等价键盘操作。卡体不自动旋转、整卡不自动闪烁。SSR 根据最新用户要求增加晶核与神域局部流动，可独立暂停。

## 装备本体分级

每级独立原画。先用轮廓与机构表达能力，再添加高级材质；关闭全部卡片特效、缩成小图后仍须分得清。

| 等级 | 装备 | 本体变化 | 卡片特效 |
| --- | --- | --- | --- |
| C | 素木放大镜 | 单片玻璃、木柄、铜箍，朴素可用 | 无镭射、无金边 |
| R | 双轴勘察镜 | 折叠副镜、双轴机构、校准刻度 | 无镭射；普通金属反光属于原画 |
| SR | 三相解析镜 | 三枚棱镜、交叉机构、解析框架与护柄 | 装备局部镭射、细金边；背景无箔 |
| SSR | 万象重构镜 | 开放轨道、神魂晶核、重连结构与分叉握柄 | 宇宙神域、晶核元素流与神魂、星轨流光、全卡镭射与独立纹章 |

SSR 是隐藏的 Skill 突破形态，仍独立、永久解锁，不设置 SR 前置条件。以上是既有评级的视觉映射，不新增评审标准或 Profile 能力证明。页面默认 C，已解锁 SSR 仍可选。

`equipment-evolution-comparison.png` 是不含卡片光效的四档原画对照。`assets/tiers/` 保存四套 source、subject、lineart、text；`assets/evolution-prompts.json` 保存内置 image_gen 的四个完整提示词、风格参考和原图路径。

## 文件与运行

- `equipment-evolution.blend`：四档独立 Scene 的可编辑进化版，打包各等级原画与文字。
- `card.blend`：可编辑的 Blender 材质母版，包含打包图片、视差节点、灯光与相机。
- `web/assets/card.glb`：从该场景导出的真实几何，3 meshes、5 primitives、520 个 position vertices，角色材质为 web_front/web_edge/web_back/web_gold。
- `assets/`：真实透明主体、背景、精确注册线描、确定性中文文字；保留主体 RGB 原图与生成提示词。
- `viewer-src/`：为本卡修改后的 Three.js 页面源文件。
- `web/`：可直接运行的页面与资产，Three.js 固定 0.180.0。
- `renders/`：Blender 正面、左右倾斜渲染与 GPU 渲染记录。

```bash
cd web
npm ci --ignore-scripts --no-audit --no-fund
node server.mjs
```

服务只监听本机，默认 4183，可通过 PORT 指定端口。

重建模型与网页：

```bash
python3 scripts/rebuild.py
```

需要 Python 的 Pillow、numpy、OpenCV（技术抠图脚本使用 numpy/cv2；既有四层资产重建只需要 Pillow）、Node/npm。`scripts/install_blender.py` 使用官方发行包与官方 SHA-256，首次下载 Blender 到本项目 tools，不写入系统 Applications；Blender 配置保存在项目 runtime-config。tools/node_modules/runtime-config 不提交。复用已有安装时不重新下载。

## 材质与交互边界

C/R 不启用镭射且禁用镭射滑杆；SR 的镭射只作用于装备 alpha 范围；SSR 开启全卡光效与重连纹章。四档纹理预载，切级同步换主体、线稿、文字，不使用同一原画回退。网页按钮与参数滑杆用于设计评审，不是生产评级 UI。

SSR 记录仅存浏览器 localStorage，用来验证视觉保留行为，不是实际发奖。卡片当前可用性、真实评级及 Agent 装备系统尚未绑定。

网页材料由 GLSL 重建，glTF 不携带 Blender 的自定义节点图。Blender 文件是完整镭射母版，网页额外实现等级门控与 SSR 纹章；二者不承诺逐像素一致。

## 制作记录

使用用户指定的 holo-card-studio（已安装版本 1.0.1）作为源流程；build_card.py/export_web.py/validate_assets.py 保留其实现，网页从其模板改造。安装的 Blender 为官方 4.5.13 LTS macOS arm64，包 SHA-256 为 `663ce944257c61ff1d6aa09e15c8f57bbd8d59023adb2fa7edde33a9ed960b53`。

内置图像工具两次返回 RGB 假透明棋盘格。用户于本轮明确授权本地脚本进行技术抠图、透明通道与精确线描处理；原图未改写。方法和资产哈希见 layer-processing.json，验证四层同尺寸/真实 alpha 见 asset-validation.json。背景与主体均为本次生成，文字使用本机中文字体确定性排版。

原 skill 的服务器文件缺失已在本项目补齐；安装器 urllib 403 改为 curl 官方下载；Blender 便携配置写入应用包受限改为项目独立配置路径。实际运行中发现的 DOM 控件空引用、卡背镜像、金材质无灯及颜色空间问题按浏览器结果修复。

实测结果见 verification.md。

### 装备进化修订

本次四张独立装备原画均由内置 image_gen 生成，保持精灵冒险器具画风。工具输出白底 RGB，沿用用户已授权的技术处理制作真实 alpha、保留结构孔洞、归一化画布、导出同像素线描与确定性中文。原图逐字节保留；方法、轮廓边界和 SHA-256 见 evolution-asset-validation.json。`scripts/prepare_evolution.py` 可从保留的原图复现，`scripts/build_evolution.py` 更新四场景 Blender 文件。

### SSR 神域修订

用户要求 SSR 成为连接宇宙的神器，允许晶核内部元素波动、神魂游动与专属神域。`assets/tiers/SSR/background.png` 是内置 image_gen 生成的独立宇宙神域；完整提示词与原图来源见 `assets/ssr-divinity-prompt.json`。`subject-divine.png` 只修剪旧版透明边缘的白色毛边，原画保留。`crystal-mask.png` 为同像素手工注册晶核遮罩，随主体相同 UV/深度/缩放移动，能流不会越过晶体边界。

`viewer-src/ssr-divinity.js` 包含可编辑 GLSL：三条带尾迹的神魂约 9–12 秒循环、青紫能流、两条约 22–29 秒周转的宇宙轨迹。晶核保持绘画晶面，星轨流动不改变卡体姿态或整卡光强。C/R/SR 不使用此时间动画，原来的镭射仍只随观察角度变化。

卡体静止时，仅 SSR 正面在可见时以最多 30 FPS 更新内部世界；鼠标倾斜独立响应。暂停、背面、离屏、后台和系统减少动态时冻结内部时钟；不靠定时器累计后台时间。暂停按钮只在 SSR 出现。

四场景 Blender 文件已打包 SSR 独立背景、器物与晶核遮罩；节点参考明确注明神魂实时动画由网页 shader 实现。离线源保留静态神域和可编辑输入，不宣称 Blender 已复刻网页内部动画。
