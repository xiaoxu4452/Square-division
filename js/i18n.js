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
      installApp: '安装应用',
      installDone: '已安装为桌面应用',
      installHint: '也可从浏览器菜单选择「安装此站点」',
      themeToggle: '切换深浅主题',
      collapse: '折叠到顶栏',
      consoleTag: '01 / CONTROL',
      consoleTitle: '参数控制台',

      algoLabel: '剖分算法',
      algoQuad: '四叉树尺寸场 · 多中心',
      algoEuclid: '欧几里得 · 连分数',
      algoNetwork: '电网络 · Moroń 完美矩形',
      algoHintQuad: '外框用欧几里得最少方块骨架铺满；自定义密集中心首屏即极细，远处只保留最少的大方块。',
      algoHintEuclid: '连分数骨架精确铺满全矩形，阶梯细分只发生在自定义密集中心附近；阶数扩大密核范围。',
      algoHintNetwork: 'Moroń 33×32 子网络铺满全矩形，自定义密集中心内再层层细分；三种模式共用同一组中心。',
      centersLabel: '密集中心数量',
      powerLabel: '聚焦强度',
      radiusLabel: '密集中心半径',
      detailLabel: '宏块精度 2ⁿ',
      orderLabel: '细分阶数 / 密核范围',
      paletteLabel: '配色方案',
      palSpectrum: '素雅光谱',
      palSky: '青灰 / 靛蓝',
      palWarm: '赭石暖调',
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
      hintInteract: '滚轮以指针为中心缩放 · 拖拽平移 · Shift+拖拽 重画矩形 · 双击添加密集中心 · 拖动中心标记可移动 · 右键移除最近中心（三种模式通用）。',
      keyHelp: '滚轮 缩放　|　拖拽 平移　|　拖拽中心 移动　|　双击 加中心　|　右键 删中心　|　F 适配　|　Enter 运算',

      statRatio: '世界比例', statBlocks: '当前视图方块', statMin: '最小边长',
      statMax: '最大边长', statCenters: '密集中心', statCoverage: '覆盖率',
      statTime: '渲染耗时', statPrecision: '数值精度', precisionValue: '80 位十进制',
      statEmpty: '—',
      metaQuad: '世界 {gw}×{gh} u · 宏块 2^{d} · LOD {lmin}–{lmax} 层 · {count} 块{capped}',
      metaEuclid: '连分数 [{cf}] · 辗转相除 {steps} 步 · 阶梯细分 {order} 阶 · {count} 块 · 全幅覆盖 100%',
      metaNetwork: 'Moroń {ratio} 子网络 ×{cells} · 回溯 {steps} 步 · 边长 {sides} · {order} 阶 · {count} 块 · 全幅覆盖 100%',
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

      scienceNo: '02 / MATHEMATICAL NOTES',
      scienceTitle: '方形剖分矩形：数学原理',
      scienceLead: '连分数 · Smith 电网络 · 尺度不变尺寸场 · 高精度渲染（完整论文见下方，支持中英切换）',
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
      installApp: 'Install app',
      installDone: 'Installed as a desktop app',
      installHint: 'You can also use the browser menu → Install this site',
      themeToggle: 'Toggle dark / light theme',
      collapse: 'Collapse to top bar',
      consoleTag: '01 / CONTROL',
      consoleTitle: 'Control panel',

      algoLabel: 'Dissection algorithm',
      algoQuad: 'Quadtree field · multi-focus',
      algoEuclid: 'Euclid · continued fraction',
      algoNetwork: 'Network · Moron perfect rectangle',
      algoHintQuad: 'A Euclidean minimum-tile skeleton fills the frame; custom dense centres are ultra-fine from the first frame, while the far field keeps the fewest large squares.',
      algoHintEuclid: 'A continued-fraction skeleton covers the whole rectangle; ladder refinement is confined to custom dense centres, and order widens the core.',
      algoHintNetwork: 'The Moron 33:32 sub-network fills the whole rectangle, with extra refinement around custom dense centres; all three modes share the same centres.',
      centersLabel: 'Dense centres',
      powerLabel: 'Focus strength',
      radiusLabel: 'Dense-centre radius',
      detailLabel: 'Macro precision 2ⁿ',
      orderLabel: 'Subdivision order / core',
      paletteLabel: 'Color palette',
      palSpectrum: 'Muted spectrum',
      palSky: 'Slate / indigo',
      palWarm: 'Warm earth',
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
      hintInteract: 'Wheel to zoom at pointer · drag to pan · Shift+drag to redraw · double-click to add a dense centre · drag a marker to move it · right-click removes the nearest one (all three modes).',
      keyHelp: 'Wheel zoom　|　Drag pan　|　Drag marker move　|　Double-click add　|　Right-click remove　|　F fit　|　Enter compute',

      statRatio: 'World ratio', statBlocks: 'Visible tiles', statMin: 'Smallest side',
      statMax: 'Largest side', statCenters: 'Centres', statCoverage: 'Coverage',
      statTime: 'Render time', statPrecision: 'Numeric precision', precisionValue: '80 decimals',
      statEmpty: '—',
      metaQuad: 'World {gw}×{gh} u · macro 2^{d} · LOD level {lmin}–{lmax} · {count} tiles{capped}',
      metaEuclid: 'Continued fraction [{cf}] · {steps} division steps · ladder order {order} · {count} squares · 100% coverage',
      metaNetwork: 'Moron {ratio} sub-network x{cells} · {steps} backtracking steps · sides {sides} · order {order} · {count} squares · 100% coverage',
      capped: ' · cap reached',

      hintTitle: 'Draw a rectangle first',
      hintText: 'Press and drag anywhere on the canvas, then hit Compute.<br>Or use a ratio preset on the left — then zoom in almost without limit.',
      emptyWarn: 'Draw a rectangle on the canvas first',
      minWarn: 'That rectangle is too small — drag a bigger one',
      noResult: 'No result yet: draw a rectangle and press Compute',
      saved: 'PNG exported',
      focusAdded: 'Dense centre added',
      focusMax: 'At most 6 dense centres',
      focusRemoved: 'Nearest dense centre removed',
      ttIndex: 'No.', ttEdge: 'Side', ttArea: 'Area', ttLevel: 'Subdivision level',
      clickHint: 'Double-click to add a dense centre here',

      scienceNo: '02 / MATHEMATICAL NOTES',
      scienceTitle: 'Squaring the Rectangle',
      scienceLead: 'Continued fractions · Smith networks · scale-free size fields · high-precision rendering (full paper below; switch language in the top bar)',
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
