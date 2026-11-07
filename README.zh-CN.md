# 方形剖分实验室 · 无限画布

[English version](README.md) · **在线演示：** <https://xiaoxu4452.github.io/Square-division/>

一个零依赖、纯前端的**正方形剖分矩形**交互实验室：把任意长宽比的矩形，剖分成有限个互不重叠、大小悬殊且恰好铺满的正方形。整页是一块可接近无限放大的全屏画布。

---

## 1. 项目特点

- **全屏无限画布。** 整个页面即 Canvas 2D 表面，配合高精度相机；滚轮以鼠标位置为锚点缩放，缩放上限约 `10^12` 倍且不会漂移。
- **多密集中心。** 尺度不变的尺寸场可生成 2 个或更多密集中心；越靠近中心方块越细，**远离中心严格只有大方块**，外围不会出现零碎小格。
- **精确铺满。** 采用 dyadic 四叉树：一个宏块要么不切，要么切成四个全等正方形。四分互斥且完备，因此覆盖率恒为 100%，无缝隙、无重叠。
- **接近无限放大。** 尺寸场没有世界坐标下的绝对下限；细节层级（LOD）由屏幕像素尺寸决定，持续放大就会持续展开新的细分层级，而不会「放大到底没东西」。
- **80 位十进制相机。** 内置 `BigDec` 定点高精度库（BigInt，80 位小数）维护相机坐标；光栅化采用「double 主值 + 精确残差补偿」，兼顾速度与精度。
- **严格配色。** 32 色低饱和调色板（不含黑、白、灰）配合平滑的低频色彩流动；基于邻接图的贪心着色带硬约束，保证任意共边相邻的两块颜色不同。
- **玻璃拟态界面。** 半透明顶栏、可折叠到顶栏的参数控制台、统计 HUD、缩放条，以及收纳全部讲解内容的「知识讲解」弹窗；控件仅有几乎看不出的微渐变，克制素雅、深浅主题、中英双语。
- **经典算法对照。** 欧几里得连分数与 Smith / Moroń 电网络剖分都**精确铺满整个矩形**；L 形阶梯替换让方块数可经「细分阶数」滑块从数百增长到数万。
- **小型论文式讲解。** 知识弹窗内嵌双语技术论文（`essay.zh.html` / `essay.en.html`）：11 个编号章节、27 个编号公式、12 张内联 SVG 图解，含摘要、参考文献与参数附录。
- **手机长屏适配。** 覆盖 19.5:9 / 20:9 竖屏、`dvh` 动态视口、安全区、`40px` 触控目标、双指缩放；竖屏默认使用纵向世界，让画布铺满长屏。
- **三种模式共用自定义密集中心。** 双击添加、拖动标记移动、右键移除最近；首屏即呈现亚像素精细密核，切换算法与重画矩形时中心位置保留。
- **最少方块远场。** 精确的欧几里得 / 连分数骨架在外围只保留 `Σ qᵢ` 个大块（理论边界见 §3.8）。
- **C++ WASM 多核 + 可安装 PWA。** 约 9 KB 的 freestanding C++17 内核在 Web Worker 池中并行执行，结果与 JS 引擎逐块一致；Service Worker 提供离线缓存与桌面安装。

---

## 2. 快速开始

无需构建、无需安装依赖、无需联网。

```bash
git clone https://github.com/xiaoxu4452/Square-division.git
cd Square-division
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

直接用浏览器打开 `index.html`（`file://`）同样可以运行。

仓库已提交编译产物，无需编译器。如需重建内核（仅需 Zig）或重新生成图标：

```bash
node tools/build-wasm.js      # native/tiling_core.cpp -> wasm/ + js/wasm-module.js
node tools/make-icons.js      # icons/*.png
```

运行算法验证（需要 Node.js 18+）：

```bash
node tests/verify.js
```

---

## 3. 数学原理

### 3.1 平方矩形与连分数

`a × b` 的矩形能被有限个正方形恰好铺满，当且仅当 `a/b` 为有理数。欧几里得算法给出构造：反复切下边长为 `min(a, b)` 的最大正方形。每次的商构成 `a/b` 的连分数：`3:2` 对应 `[1, 2]`；黄金比 `φ = [1;1,1,…]` 的连分数无限，剖分过程也永不终止。若进一步要求所有小正方形边长互不相同，则称为**完美矩形**；最小的经典解是 Zbigniew Moroń 于 1925 年给出的 `33 × 32` 矩形，边长为 `{18, 15, 14, 10, 9, 8, 7, 4, 1}`。

### 3.2 Smith 图 / 电网络类比

Brooks、Smith、Stone 与 Tutte（1936–40）把该问题转成平面电路：

| 几何对象 | 电路对应 |
| --- | --- |
| 剖分中的每条水平线 | 一个节点 |
| 每个正方形 | 连接其上下水平线的 `1 Ω` 电阻 |
| 正方形边长 | 该支路电流 |
| 纵向坐标（高度） | 电势 |
| 同一水平线上方块宽度之和 | 基尔霍夫电流定律 |
| 沿竖直路径的高度之和 | 欧姆定律 |

若外框本身是正方形，则整个网络的等效电阻恰为 `1`。这也是本项目尺寸场常被形容为「类似电路分配」的原因：密集中心相当于电流密度极高的区域。

### 3.3 多焦点 dyadic 尺寸场

世界由 `m × n` 个边长为 `L = 2^D` 的宏块组成（二进制精确）。设 `d(p)` 为点到最近焦点的距离，`R` 为衰减半径，目标边长为

```
target(p) = L · (clamp(d(p) / R, 0, 1))^power
```

该目标**尺度不变**：在视口局部坐标中求值，没有世界坐标下的绝对下限。边长为 `s` 的块仅在满足下列条件时四分为 `s/2` 的四个正方形：

```
depth < maxDepth  且  s > 1.35 · target(中心)  且  s · scale > 2.1 · minPx
```

由此得到：

- 远离焦点时 `target = L`，宏块永不细分 —— 外围没有小方块；
- 靠近焦点时 `target → 0`，只要继续放大就继续细分；
- 每次四分都是对父块的划分，因此并集恰好等于原矩形。

### 3.4 细节层级与正确性校验

只生成与当前视口相交的方块。若块数触顶，`generate()` 会自动调粗 `minPx` 重新生成，保证整幅画面处于同一细分级别，不会出现「一半极细、一半被强制大色块」的割裂。`validate()` 用扫描线区间并查验证 `gaps = 0`、`overlaps = 0` 与面积严格守恒。

### 3.5 高精度方案

`js/bigdec.js` 实现 BigInt 定点十进制，`PREC = 80`，提供 `add / sub / mul / div / cmp / toNumber / toString`，并支持小数与科学计数法解析。相机中心 `cx, cy` 及锚点缩放方程全部在 `BigDec` 中计算；绘制时拆成 double 主值与残差：

```
screenX = (worldX - cxHi) · scale + W/2 - offX
screenY = (worldY - cyHi) · scale + H/2 - offY
```

其中 `offX / offY` 是 `BigDec` 精确差值一次性转成的 double。这样既保留 Canvas 2D 的快速路径，又消除了十亿倍放大后纯 double 累积的漂移。

### 3.6 着色

通过 `O(n log n)` 的扫描线区间归并构建共边邻接图；再按边长从大到小，从 32 色低饱和调色板（饱和度 28–35%、明度带宽较窄、不含无彩色）贪心着色，若已着色的邻居用了同一色则直接排除该候选。链式 `mix32` 整数网格哈希（两次雪崩打包进一个精确的 53 位 double）提供稳定的逐块微扰与视口相对的低频色相流动，使密集区呈现色彩场而非棋盘格。颜色按整数网格坐标缓存，平移与 LOD 切换时保持稳定。

### 3.7 经典模式：替换式构造的全幅覆盖

两种经典模式都以对 world 的精确欧几里得剖分为骨架（外框比例恰为整数比 `m:n`），因此骨架本身已**严格铺满整个矩形**，不再只在中央放一块 33×32 图案。`network` 模式随后按 Smith 图「一个电阻可由子网络替换」的思想，把每个骨架方块变为 `33×33` 元胞格：上部 `33×32` 个元胞由 Moroń 的 9 个互异正方形覆盖，最后一行由 33 个单位方块收尾，共 42 个正方形，仍精确铺满父块。

密度由 **L 形阶梯细分**控制。令 `t = s/k`（取 `k = 3`），一个方块被划分为一个 `(k−1)t` 大方块与 `2k−1` 个边长为 `t` 的小方块，共 `2k` 块，面积满足

```
((k-1)t)^2 + (2k-1)t^2 = k^2 t^2 = s^2 .
```

每次替换都是父块的划分，因此任意层数下覆盖率恒为 100%。是否继续细分只由屏幕尺寸 `s·scale` 与「细分阶数」滑块决定：放大时自动展开新层，视口外方块直接剪枝，方块数可从数百增长到数万。

---

### 3.8 成熟算法、最少方块问题与多核 WASM

论文第 10 章（`essay.zh.html`）梳理了成熟算法谱系：Brooks–Smith–Stone–Tutte 把剖分化为 3-连通平面图（c-net）枚举，Tutte 轮定理与 [plantri](https://users.cecs.anu.edu.au/~bdm/plantri/) 无重复生成，Kirchhoff 方程配合[矩阵树定理](https://en.wikipedia.org/wiki/Kirchhoff%27s_theorem)给出整数电流（即边长），结果以 Bouwkampcode / tablecode 归档于 [Squaring.Net](https://www.squaring.net/sq/ss/tws.html)；Cannon–Floyd–Parry 的有限细分规则（`subdivide.c` / `squarect.c`）正是本项目阶梯替换与 Moroń 子网络嵌入的学术对应物。

**远场**现在从欧几里得连分数骨架出发，即「每次切下最大正方形」的贪心剖分，块数恰为 `Σ qᵢ`。我们称其为「最少方块骨架」而非已证明的全局最优：[Kenyon（1996）](https://arxiv.org/abs/math/9411215)给出 `log₂ p` 下界，并指出贪心在 `p×(p+1)` 矩形上需要 `p+1` 块而最优只需 `O(log p)`；精确解依赖 MTRS 的整数规划（[Monaci & dos Santos, 2014](http://www.din.uem.br/sbpo/sbpo2014/pdf/arq0373.pdf)）。本项目的取舍是：整数比下二进制精确、构造简单、与后续细分复合后仍 100% 覆盖。**自定义密集中心在三种模式下通用**（双击添加、拖动标记移动、右键移除最近），且首屏即呈现亚像素级的精细密核。

剖分热点由 C++17 内核（`native/tiling_core.cpp`）承担，用 Zig 附带的 clang 编译为 `wasm32-freestanding`（无需 Emscripten / libc，约 9 KB，仅导入一块线性内存）；重建命令 `node tools/build-wasm.js`。最多 8 个 Web Worker 各持一个 WASM 实例并行计算互不重叠的根区域，结果以 transferable buffer 回传，**不依赖 SharedArrayBuffer / COOP / COEP**（GitHub Pages 无法设置响应头）。首帧由主线程 WASM 同步出图；WASM 或 Worker 不可用时自动降级到 `js/squaring.js`，且逐块结果完全一致。真正的 wasm pthread 共享内存可通过可选参数 `?coi=1` 启用：`sw.js` 注入 COOP/COEP（[技术思路](https://github.com/gzuidhof/coi-serviceworker)），代价是首次访问刷新一次。同一 Service Worker 还提供离线缓存与[桌面安装](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。

---

## 4. 目录结构

```
Square-division/
├── index.html            # 玻璃顶栏、控制台、HUD、缩放条、论文弹窗
├── essay.zh.html         # 中文技术论文（自包含、内联 SVG、参考链接）
├── essay.en.html         # 英文技术论文（自包含、内联 SVG、参考链接）
├── manifest.webmanifest  # 可安装 PWA 清单（standalone、192/512 图标）
├── sw.js                 # 离线缓存 + 可选 COOP/COEP 头注入
├── css/style.css         # 主题、玻璃拟态、微渐变、响应式布局
├── js/
│   ├── i18n.js           # 中英词典与 DOM 文本绑定
│   ├── bigdec.js         # BigInt 定点高精度十进制（80 位小数）
│   ├── squaring.js       # 剖分引擎、邻接图、着色、正确性校验
│   ├── wasm-module.js    # 生成物：base64 内联 C++/WASM 二进制（Worker 离线可用）
│   ├── wasm-engine.js    # 任务分片、Worker 池、同步首帧与降级路径
│   ├── tiling-worker.js  # 每个 Worker 线程一个 C++/WASM 实例
│   └── app.js            # 相机、渲染、手势、状态、导出、界面绑定
├── native/
│   └── tiling_core.cpp   # C++17 freestanding 四叉树内核（无 libc）
├── wasm/
│   └── tiling_core.wasm  # 编译产物（约 9 KB，仅导入一块线性内存）
├── tools/
│   ├── build-wasm.js     # 重建内核与 js/wasm-module.js（需要 Zig）
│   └── make-icons.js     # 生成 PWA PNG 图标（纯 Node，无图像库）
├── icons/                # icon-192.png、icon-512.png、icon-maskable-512.png
├── tests/verify.js       # Node 验证脚本（34 项断言，零依赖）
├── README.md             # 英文说明
└── README.zh-CN.md       # 本文件
```

全部源码注释为英文；面向用户的中文文案只存在于 `js/i18n.js` 中。

---

## 5. 操作说明

### 手势与快捷键

| 操作 | 桌面端 | 触屏 |
| --- | --- | --- |
| 拉矩形 / 平移 | 初始拖拽为拉框，运算后拖拽为平移 | 单指拖拽 |
| 重新画矩形 | `Shift` + 拖拽，或按 `R` | 折叠控制台后点「重画」 |
| 缩放 | 滚轮（以光标为锚点）、`+` / `-` | 双指捏合 |
| 适配视图 | `F` 或「适配」按钮 | 「适配」按钮 |
| 增加密集中心 | 双击（最多 6 个） | — |
| 移除最近的中心 | 右键 | — |
| 运算 | `Enter` 或「运算」按钮 | 「运算」按钮 |
| 关闭浮层 | `Escape` | 关闭按钮 |

### 控制台参数

| 参数 | 含义 |
| --- | --- |
| 剖分算法 | 四叉树尺寸场 / 欧几里得 / Moroń 电网络 |
| 密集中心数量 | 焦点数，1–6 |
| 密集中心半径 | 影响半径占 `min(W,H)` 的比例（0.20–1.20） |
| 聚焦强度 | 尺寸场指数 `power` |
| 宏块精度 | `L = 2^D` 中的 `D` |
| 配色方案 | 素雅光谱 / 青灰 / 赭石 / 蓝色阶 |
| 随机种子 | 决定配色与焦点分布，可复现 |
| 细分阶数 | 密核范围 / 细分层级预算，三种模式通用，0–6 |
| 比例预设 | `1:1`、`3:2`、`16:9`、黄金比、`2:3` 等 |
| 显示选项 | 网格、动画、边长标注、焦点标记 |

主题与语言会写入 `localStorage` 持久化。

### URL 参数

便于分享状态或自动化截图：

| 键 | 示例 | 作用 |
| --- | --- | --- |
| `demo` | `demo=1` | 打开即生成完成态剖分 |
| `mode` | `mode=quad\|euclid\|network` | 剖分算法 |
| `centers` | `centers=3` | 密集中心数量 |
| `ratio` | `ratio=1.5` | 矩形长宽比 |
| `zoom` | `zoom=2000000` | 以第一个焦点为中心的倍数缩放 |
| `theme` | `theme=light` | `dark` / `light` |
| `lang` | `lang=en` | `zh` / `en` |
| `palette` | `palette=warm` | 配色方案 |
| `order` | `order=4` | 经典模式的阶梯细分阶数 |
| `console` | `console=0` | 初始折叠控制台 |
| `modal` | `modal=1` | 打开时显示知识讲解 |
| `radius` | `radius=0.8` | 密集中心影响半径 |
| `coi` | `coi=1` | 可选 COOP/COEP 注入，用于共享内存 WASM |
| `pwa` | `pwa=1` | 安装后应用的启动 URL |

示例：

```
https://xiaoxu4452.github.io/Square-division/?demo=1&mode=quad&centers=3&theme=dark&lang=zh&zoom=2000000
```

---

## 6. 验证

`node tests/verify.js` 共断言 34 项不变量，包括：

- 面积严格守恒、零空隙、零重叠；
- `10^9` 倍放大下约 93 000 条邻接边中同色边为 0；
- 无黑 / 白 / 灰填充，全视图 25 个不同色相、深放大 16 个色相桶；
- `10^9` 倍放大下无大块纯色（所有方块约 5.59 px）；
- 4096 个连续整数网格坐标产生 4096 个互异哈希值；
- 远端 `target(far) = min(W,H)` 严格成立，最少方块骨架在外围不被细分；
- `BigDec` 中 `0.1 + 0.2 = 0.3`，40 次连续锚点缩放保持有限；
- `euclid` 与 `network` 在 7 种长宽比下均精确铺满整个外框；
- Moroń 九块边长平方和为 `1056 = 33×32`，方块数随细分阶数单调增长，77,751 块的密集经典剖分仍零空隙；三种模式的自定义中心移动后细块质心都随之移动。

此外使用 Chrome DevTools Protocol 真实设备模拟，在 `390 × 844`、`360 × 800`、`844 × 390`、`1600 × 900` 下复核布局，溢出元素为 0。

---

## 7. 部署（GitHub Pages）

本仓库是静态站点，从 `main` 分支根目录直接发布。

1. 推送至 `github.com/xiaoxu4452/Square-division`；
2. 打开仓库 **Settings → Pages**；
3. **Build and deployment → Source** 选择 *Deploy from a branch*，**Branch** 设为 `main` / `root`；
4. 保存后访问 `https://xiaoxu4452.github.io/Square-division/`。

无需 Jekyll 构建、无需打包工具，也不需要 `.nojekyll` 标记。
### 安装为桌面应用

在 HTTPS（或 localhost）下本站是可安装 PWA：满足安装条件后顶栏出现「安装应用」按钮，Chrome / Edge 也可从浏览器菜单选择「安装此站点」。Service Worker 会缓存全部静态资源以支持离线使用。附加参数 `?coi=1` 可启用跨源隔离，用于共享内存 WASM 的实验路径。



---

## 8. 参考资料

- Brooks, R. L.; Smith, C. A. B.; Stone, A. H.; Tutte, W. T. — *The Dissection of Rectangles into Squares*, Duke Mathematical Journal, 1940.
- Moroń, Z. — *O rozkładach prostokątów na kwadraty*, 1925（`33 × 32` 完美矩形）。
- Sprague, R. — *Beispiel einer Zerlegung des Quadrats in lauter verschiedene Quadrate*, 1939.
- Duijvestijn, A. J. W. — *Simple perfect squared square of lowest order*, 1978（21 阶）。
- Conway, J. H. — *Mrs. Perkins's Quilt*。
- 维基百科 — [Squaring the square](https://en.wikipedia.org/wiki/Squaring_the_square)、[Continued fraction](https://en.wikipedia.org/wiki/Continued_fraction)、[Smith diagram](https://en.wikipedia.org/wiki/Smith_diagram)、[Dehn invariant](https://en.wikipedia.org/wiki/Dehn_invariant)。
- R. Kenyon — [Tiling a rectangle with the fewest squares](https://arxiv.org/abs/math/9411215), 1996（log₂p 下界；贪心非最优）。
- M. Monaci, A. G. dos Santos — [Minimum Tiling of a Rectangle by Squares](http://www.din.uem.br/sbpo/sbpo2014/pdf/arq0373.pdf), SBPO 2014。
- [Squaring.Net: Tiling by Squares](https://www.squaring.net/sq/ss/tws.html) · [21 阶 SPSS](https://www.squaring.net/sq/ss/spss/o21/spsso21.html) · [CPSS 目录](https://www.squaring.net/sq/ss/cpss/cpss.html) · [plantri](https://users.cecs.anu.edu.au/~bdm/plantri/)。
- S. E. Anderson — [Compound Perfect Squared Squares of the Order Twenties](https://arxiv.org/abs/1303.0599), 2013。
- [Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html) · [web.dev: COOP/COEP](https://web.dev/articles/coop-coep) · [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) · [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。
