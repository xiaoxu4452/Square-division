/* ==========================================================================
 * i18n.js — Bilingual zh/en dictionary (v2: full-screen canvas / explainer modal / console)
 * data-i18n / -html / -title / -aria / -placeholder
 * ========================================================================== */
(function () {
  'use strict';

  var DICT = {
    zh: {
      metaTitle: '方形剖分实验室 · 无限画布',
      siteTitle: '方形剖分实验室',
      siteSubtitle: 'SQUARING THE RECTANGLE · 无限画布 / 四叉树尺寸场',
      brandTag: '交互数学 / INFINITE CANVAS',
      btnKnowledge: '知识讲解',
      btnConsole: '控制台',
      themeToggle: '切换深浅主题',
      collapse: '折叠到顶栏',
      consoleTag: '01 / CONTROL',
      consoleTitle: '参数控制台',

      algoLabel: '剖分算法',
      algoQuad: '四叉树尺寸场 · 多中心',
      algoEuclid: '欧几里得 · 连分数',
      algoNetwork: '电网络 · 完美矩形（9 阶）',
      algoHintQuad: '尺寸场随到最近焦点的距离单调增大：远处只出大块，中心可无限细分。',
      algoHintEuclid: '每次切下最大正方形，商序列即长宽比的连分数（静态对照）。',
      algoHintNetwork: '回溯求解 Moroń 的 33×32 经典解，9 块边长互不相同（静态对照）。',
      centersLabel: '密集中心数量',
      powerLabel: '聚焦强度',
      detailLabel: '宏块精度 2ⁿ',
      paletteLabel: '配色方案',
      palSpectrum: '多彩光谱',
      palSky: '天蓝 / 靛紫',
      palWarm: '暖色',
      palMono: '蓝色阶',
      seedLabel: '随机种子',
      reseed: '换一个',
      ratioLabel: '比例预设（点击直接生成）',
      ratioSquare: '正方形 1:1', ratio32: '3:2', ratio169: '16:9',
      ratioGolden: '黄金比 φ', ratioPortrait: '竖幅 2:3',
      optionsLabel: '显示选项',
      optGrid: '自适应网格', optAnimate: '展开动画',
      optLabels: '标注边长', optFoci: '显示中心',
      btnCompute: '▶  运　算', btnRedraw: '重画矩形', btnFit: '适配屏幕',
      btnRandom: '随机矩形', btnExport: '导出 PNG', btnClear: '清空画布',
      btnFitShort: '适配',
      hintInteract: '滚轮以指针为中心缩放 · 拖拽平移 · Shift+拖拽 重画矩形 · 双击添加密集中心 · 右键移除最近中心。',
      keyHelp: '滚轮 缩放　|　拖拽 平移　|　Shift+拖拽 重画　|　双击 加密集中心　|　F 适配　|　Enter 运算',

      statRatio: '世界比例', statBlocks: '当前视图方块', statMin: '最小边长',
      statMax: '最大边长', statCenters: '密集中心', statCoverage: '覆盖率',
      statTime: '渲染耗时', statPrecision: '数值精度', precisionValue: '80 位十进制',
      statEmpty: '—',
      metaQuad: '世界 {gw}×{gh} u · 宏块 2^{d} · LOD {lmin}–{lmax} 层 · {count} 块{capped}',
      metaEuclid: '连分数 [{cf}] · 辗转相除 {steps} 步 · 静态剖分',
      metaNetwork: '内切 {ratio} · 回溯 {steps} 步 · 边长 {sides}',
      capped: ' · 已达上限',

      hintTitle: '先拉一个矩形',
      hintText: '在画布任意处按下并拖动，松开得到矩形，再点「运算」。<br>也可以点左侧比例预设直接开始，之后滚轮可接近无限放大。',
      emptyWarn: '请先在画布上拖出一个矩形',
      minWarn: '矩形太小了，请拉大一点',
      noResult: '还没有结果，先拖一个矩形再点「运算」',
      saved: '已导出 PNG',
      focusAdded: '已添加密集中心',
      focusMax: '最多 6 个密集中心',
      focusRemoved: '已移除最近的密集中心',
      ttIndex: '编号', ttEdge: '边长', ttArea: '面积', ttLevel: '细分层级',
      clickHint: '双击可在此添加密集中心',

      scienceNo: '02 / THE MATHEMATICS',
      scienceTitle: '知识讲解',
      scienceLead: '一个看起来像装饰画的问题，背后连着连分数、四叉树、图论与基尔霍夫定律。',
      card1No: '01',
      card1Title: '任意矩形都能被正方形铺满吗？',
      card1Body: '把 <code>a × b</code> 的矩形切成有限个互不重叠、恰好铺满的正方形，称为<strong>方形剖分矩形（squared rectangle）</strong>。当 <code>a/b</code> 为有理数时，欧几里得算法必然在有限步内结束：每次沿长边切下边长为短边的最大正方形，余下矩形的边长正是辗转相除的余数，商序列 <code>[q₀; q₁, q₂, …]</code> 就是长宽比的连分数展开。若 <code>a/b</code> 是无理数（例如黄金比 φ），除法永不终止，需要无穷多个正方形——这正是 φ 的连分数 <code>[1;1,1,…]</code> 的几何图像。',
      card2No: '02',
      card2Title: '把剖分变成一张电路图',
      card2Body: '1936–1938 年，剑桥的 Brooks、Smith、Stone、Tutte 建立了这一对应（后称 <strong>Smith 图</strong>）：把剖分中每一条水平边当作电路节点，每个正方形当作连接其上下两边的 <strong>1Ω 电阻</strong>；规定支路<strong>电流 = 正方形边长</strong>，节点<strong>电势 = 水平边的纵坐标</strong>。于是「同一水平线上方方块宽度之和 = 下方方块宽度之和」正是<strong>基尔霍夫电流定律</strong>；竖直方向的高度累加就是 <strong>R = 1 时的欧姆定律</strong>。给定总电势差，这组线性方程有唯一解，这正是 Kirchhoff 定理。若外框本身是正方形（完美平方正方形），则等价于整个网络的等效电阻恰好为 1。',
      card3No: '03',
      card3Title: '四个里程碑',
      card3Body: '<ul><li><b>1907</b> · Dudeney 的「Lady Isabel\'s Casket」是最早发表的方形剖分谜题。</li><li><b>1925</b> · Zbigniew Moroń 给出 32×33 矩形被 9 个互不相同边长的正方形 {18,15,14,10,9,8,7,4,1} 铺满，这是阶数最小的<strong>完美矩形</strong>。</li><li><b>1939</b> · Roland Sprague 发表第一个完美平方正方形：边长 4205、55 块。</li><li><b>1978</b> · Duijvestijn 用计算机找到唯一的 21 块最小阶解（边长 112），成为剑桥三一数学会会徽；若放宽「互不相同」、只要求所有边长最大公约数为 1，就是 <strong>Mrs. Perkins\'s Quilt</strong> 问题。</li></ul>',
      card4No: '04',
      card4Title: '本站如何计算与渲染',
      card4Body: '<ul><li><strong>严格剖分</strong>：把矩形吸附成 <code>m × n</code> 个边长 <code>L = 2ⁿ</code> 的宏块（比例误差 &lt; 2%）。四叉树只在「当前块边长 &gt; 1.35 × 局部目标尺寸」时一分为四，而目标尺寸随到最近焦点的距离单调增大。因此<strong>远离中心恒为大块、绝不出现小方块</strong>，中心可细分到 2⁻³⁰ 量级；四分是互斥完备划分，覆盖率严格 100%、零重叠。</li><li><strong>多个密集中心</strong>：尺寸场取到所有焦点距离的最小值，滑块可选 1–5 个（黄金角分布），双击画布可追加、右键移除。</li><li><strong>接近无限放大</strong>：剖分按当前视口与缩放做 LOD 动态展开——放大时继续生成更深的层级，坐标以 double 存储、绘制时换算为相对视口坐标，避免大数精度丢失；只生成看得见的方块，并用分帧渐进绘制保持流畅。相机坐标由内置 <code>BigDec</code> 高精度库（BigInt 定点、80 位小数）维护，绘制时用 double 主值 + 高精度残差补偿，10⁹ 倍放大后像素位置仍不漂移。</li><li><strong>邻接异色</strong>：用扫描线区间归并构建共享边的邻接图，再按块尺寸降序贪心着色，使相邻方块取色相/明度距离最大的颜色；调色板明度限定在 36–72%、饱和 ≥ 52%，<strong>不含黑、白、灰填充</strong>。另有欧几里得连分数与 Moroń 完美矩形两个静态对照。</li></ul>',
      diagramTitle: 'Smith 图 · 电网络类比',
      diagramCaption: '水平线 → 节点　·　正方形 → 1Ω 电阻　·　边长 → 电流　·　纵向距离 → 电势差',
      refsTitle: '延伸阅读',
      refsList: '<a href="https://en.wikipedia.org/wiki/Squaring_the_square" target="_blank" rel="noopener">Wikipedia · Squaring the square</a><a href="https://arxiv.org/abs/math/0501170" target="_blank" rel="noopener">Ardila & Stanley · Tilings (arXiv:math/0501170)</a><a href="http://www.claymath.org/library/senior_scholars/stanley_ardila_tilings.pdf" target="_blank" rel="noopener">Clay Mathematics Institute · Tilings (PDF)</a><a href="https://m-a.org.uk/resources/SquaredRectangle.pdf" target="_blank" rel="noopener">A Patchwork of Squares · Moroń 解的代数推导</a>',
      footerNote: '纯前端计算 · 不上传任何数据 · 全部图形由 Canvas 实时生成',
      exportName: '方形剖分',
      dragSize: '{w} × {h} px'
    },

    en: {
      metaTitle: 'Squaring the Rectangle Lab · Infinite Canvas',
      siteTitle: 'Squaring the Rectangle',
      siteSubtitle: 'SQUARING THE RECTANGLE · INFINITE CANVAS / QUADTREE FIELD',
      brandTag: 'INTERACTIVE MATH / INFINITE CANVAS',
      btnKnowledge: 'Learn',
      btnConsole: 'Controls',
      themeToggle: 'Toggle dark / light theme',
      collapse: 'Collapse to top bar',
      consoleTag: '01 / CONTROL',
      consoleTitle: 'Control panel',

      algoLabel: 'Dissection algorithm',
      algoQuad: 'Quadtree field · multi-focus',
      algoEuclid: 'Euclid · continued fraction',
      algoNetwork: 'Network · perfect rectangle (order 9)',
      algoHintQuad: 'The size field grows with distance to the nearest focus: only large tiles far away, unbounded detail at the centres.',
      algoHintEuclid: 'Repeatedly cut off the largest square; quotients are the continued fraction (static reference).',
      algoHintNetwork: 'Backtracking solver for Moron\'s classic 33×32 dissection; nine distinct sizes (static reference).',
      centersLabel: 'Dense centres',
      powerLabel: 'Focus strength',
      detailLabel: 'Macro precision 2ⁿ',
      paletteLabel: 'Color palette',
      palSpectrum: 'Full spectrum',
      palSky: 'Sky / indigo',
      palWarm: 'Warm',
      palMono: 'Blue shades',
      seedLabel: 'Random seed',
      reseed: 'Shuffle',
      ratioLabel: 'Ratio presets (click to generate)',
      ratioSquare: 'Square 1:1', ratio32: '3:2', ratio169: '16:9',
      ratioGolden: 'Golden φ', ratioPortrait: 'Portrait 2:3',
      optionsLabel: 'Display options',
      optGrid: 'Adaptive grid', optAnimate: 'Unfold animation',
      optLabels: 'Show side length', optFoci: 'Show centres',
      btnCompute: '▶  COMPUTE', btnRedraw: 'Redraw rect', btnFit: 'Fit screen',
      btnRandom: 'Random rect', btnExport: 'Export PNG', btnClear: 'Clear canvas',
      btnFitShort: 'Fit',
      hintInteract: 'Wheel to zoom at pointer · drag to pan · Shift+drag to redraw · double-click to add a dense centre · right-click removes the last one.',
      keyHelp: 'Wheel zoom　|　Drag pan　|　Shift+drag redraw　|　Double-click add centre　|　F fit　|　Enter compute',

      statRatio: 'World ratio', statBlocks: 'Visible tiles', statMin: 'Smallest side',
      statMax: 'Largest side', statCenters: 'Centres', statCoverage: 'Coverage',
      statTime: 'Render time', statPrecision: 'Numeric precision', precisionValue: '80 decimals',
      statEmpty: '—',
      metaQuad: 'World {gw}×{gh} u · macro 2^{d} · LOD level {lmin}–{lmax} · {count} tiles{capped}',
      metaEuclid: 'Continued fraction [{cf}] · {steps} division steps · static tiling',
      metaNetwork: 'Inscribed {ratio} · {steps} backtracking steps · sides {sides}',
      capped: ' · cap reached',

      hintTitle: 'Draw a rectangle first',
      hintText: 'Press and drag anywhere on the canvas, then hit Compute.<br>Or use a ratio preset on the left — then zoom in almost without limit.',
      emptyWarn: 'Draw a rectangle on the canvas first',
      minWarn: 'That rectangle is too small — drag a bigger one',
      noResult: 'No result yet: draw a rectangle and press Compute',
      saved: 'PNG exported',
      focusAdded: 'Dense centre added',
      focusMax: 'At most 6 dense centres',
      focusRemoved: 'Last dense centre removed',
      ttIndex: 'No.', ttEdge: 'Side', ttArea: 'Area', ttLevel: 'Subdivision level',
      clickHint: 'Double-click to add a dense centre here',

      scienceNo: '02 / THE MATHEMATICS',
      scienceTitle: 'The Mathematics',
      scienceLead: 'A problem that looks like decorative art is tied to continued fractions, quadtrees, graph theory and Kirchhoff\'s laws.',
      card1No: '01',
      card1Title: 'Can every rectangle be tiled by squares?',
      card1Body: 'Cutting an <code>a × b</code> rectangle into finitely many non-overlapping squares that fill it exactly is called a <strong>squared rectangle</strong>. When <code>a/b</code> is rational, Euclid\'s algorithm always terminates: repeatedly cut off squares whose side equals the shorter side; the leftovers are the remainders of the division, and the quotients <code>[q₀; q₁, q₂, …]</code> form the continued fraction of the aspect ratio. If <code>a/b</code> is irrational (say the golden ratio φ), the division never ends and infinitely many squares are needed — the geometric picture of φ = <code>[1;1,1,…]</code>.',
      card2No: '02',
      card2Title: 'Turn the dissection into a circuit',
      card2Body: 'In 1936–1938, Brooks, Smith, Stone and Tutte at Cambridge discovered a striking correspondence, later called the <strong>Smith diagram</strong>: each horizontal line of the dissection becomes a node, each square becomes a <strong>1Ω resistor</strong> joining the lines above and below it. Set <strong>branch current = side length of the square</strong> and <strong>node potential = vertical coordinate</strong>. Then "sum of widths above a horizontal line = sum of widths below" is exactly <strong>Kirchhoff\'s current law</strong>, while adding heights vertically is <strong>Ohm\'s law with R = 1</strong>. Fixing the total potential difference gives a unique solution — Kirchhoff\'s theorem. A perfect squared <em>square</em> corresponds to a network whose total resistance is exactly 1.',
      card3No: '03',
      card3Title: 'Four milestones',
      card3Body: '<ul><li><b>1907</b> · Dudeney\'s "Lady Isabel\'s Casket" is the earliest published squared-dissection puzzle.</li><li><b>1925</b> · Zbigniew Moroń tiled a 32×33 rectangle with nine squares of pairwise different sides {18,15,14,10,9,8,7,4,1} — the <strong>perfect rectangle</strong> of lowest order.</li><li><b>1939</b> · Roland Sprague published the first perfect squared square: side 4205, 55 pieces.</li><li><b>1978</b> · Duijvestijn\'s computer found the unique 21-piece minimal solution (side 112), now the logo of the Trinity Mathematical Society. Dropping "all different" and only requiring gcd(sides) = 1 gives the <strong>Mrs. Perkins\'s Quilt</strong> problem.</li></ul>',
      card4No: '04',
      card4Title: 'How this page computes & renders',
      card4Body: '<ul><li><strong>Exact tiling</strong>: the rectangle snaps to <code>m × n</code> macro blocks of side <code>L = 2ⁿ</code> (aspect error &lt; 2%). A quadtree splits a block only when <code>side &gt; 1.35 × local target size</code>, and the target grows monotonically with distance to the nearest focus. Hence <strong>far regions stay large and never contain small tiles</strong>, while centres refine down to ~2⁻³⁰; every split is a disjoint complete partition, so coverage is exactly 100% with zero overlaps.</li><li><strong>Multiple dense centres</strong>: the field uses the minimum distance to any focus; choose 1–5 (golden-angle layout), double-click to add, right-click to remove.</li><li><strong>Near-infinite zoom</strong>: tiling is generated by LOD for the current viewport and scale — zooming in keeps unfolding deeper levels. Coordinates are doubles and are converted to viewport-relative positions when drawing, avoiding precision loss; only visible tiles are generated, painted progressively across frames. Camera coordinates live in the built-in <code>BigDec</code> high-precision library (BigInt fixed-point, 80 decimals); a double main value plus a high-precision residual offset is used when drawing, so pixel positions do not drift even at 10⁹× zoom.</li><li><strong>Different colours for neighbours</strong>: shared-edge adjacency is built by sweep-line interval merging, then a greedy pass sizes tiles descending and picks the colour farthest from already-coloured neighbours. Palette lightness is bounded to 36–72% with saturation ≥ 52%, so <strong>no black, white or grey fills</strong>. Two static references (Euclid / Moroń) are included for comparison.</li></ul>',
      diagramTitle: 'Smith diagram · the network analogy',
      diagramCaption: 'Horizontal line → node　·　square → 1Ω resistor　·　side length → current　·　vertical distance → potential difference',
      refsTitle: 'Further reading',
      refsList: '<a href="https://en.wikipedia.org/wiki/Squaring_the_square" target="_blank" rel="noopener">Wikipedia · Squaring the square</a><a href="https://arxiv.org/abs/math/0501170" target="_blank" rel="noopener">Ardila & Stanley · Tilings (arXiv:math/0501170)</a><a href="http://www.claymath.org/library/senior_scholars/stanley_ardila_tilings.pdf" target="_blank" rel="noopener">Clay Mathematics Institute · Tilings (PDF)</a><a href="https://m-a.org.uk/resources/SquaredRectangle.pdf" target="_blank" rel="noopener">A Patchwork of Squares · deriving Moroń\'s solution</a>',
      footerNote: 'Runs entirely in your browser · no data uploaded · every figure is drawn live on Canvas',
      exportName: 'squared-rectangle',
      dragSize: '{w} × {h} px'
    }
  };

  var current = 'zh';

  function t(key, vars) {
    var table = DICT[current] || DICT.zh;
    var s = table[key] != null ? table[key] : (DICT.zh[key] != null ? DICT.zh[key] : key);
    if (vars) Object.keys(vars).forEach(function (k) {
      s = String(s).split('{' + k + '}').join(String(vars[k]));
    });
    return s;
  }

  function apply() {
    var d = document;
    d.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
    d.title = t('metaTitle');
    d.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    d.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    d.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = t(el.getAttribute('data-i18n-title')); });
    d.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    d.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
    d.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: current } }));
  }

  window.I18N = {
    t: t, apply: apply,
    getLang: function () { return current; },
    setLang: function (lang) { current = lang === 'en' ? 'en' : 'zh'; apply(); return current; }
  };
})();
