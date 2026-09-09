/**
 * 物理实验室前置大屏 — 简约大气极简设计
 * 
 * 设计规范：
 * 1. 纯粹四大物理板块：力学、电磁学、光学、热力学（移除化学与所有杂乱图标/emoji）
 * 2. 国际化极简科技排版：大号编号、强劲主标题、双语标注、物理导语、核心公式印记卡片与实验清单
 * 3. 交互机制：点击卡片可“激活”该板块（高亮光晕、状态胶囊、主题色彩渐变），点击已激活卡片或按钮直接进入实验台
 * 4. 层次架构：
 *    - Level 1: 四大物理板块大屏主页 (Home / Activate Hub View)
 *    - Level 2: 板块实验精选目录 (Station Subpage View)
 *    - Level 3: 单实验深度解析看板 (Experiment Detail View)
 */

import {
  FONT_STACKS,
  buildUiFont,
  buildMathVarFont,
  drawMathFormula,
  drawFormulaCardGroup,
} from './physicsFormula.js';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return `rgba(14, 165, 233, ${alpha})`;
  const cleanHex = hex.slice(1);
  const num = parseInt(cleanHex.length === 3 ? cleanHex.split('').map((c) => c + c).join('') : cleanHex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wrapText(ctx, text, maxWidth) {
  const s = String(text || '');
  if (!s) return [''];
  const lines = [];
  let line = '';
  for (const ch of s) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 物理 4 大核心板块与 22 项实装物理实验知识库 */
export const FORMULA_CATALOG = {
  stations: [
    {
      id: 'mechanics',
      num: '01',
      name: '力学',
      en: 'MECHANICS',
      color: '#0284c7',
      badge: '6 项实验',
      lead: '研究物体的机械运动、受力机制与时空能量动量守恒规律。',
      formulaText: 'F = m·a  ·  p = m·v  ·  E_k = ½mv²',
      expList: [
        '自由落体实验',
        '斜面动力学',
        '单摆简谐运动',
        '碰撞与动能',
        '抛体分运动',
        '落球法测粘度',
      ],
    },
    {
      id: 'electro',
      num: '02',
      name: '电磁学',
      en: 'ELECTROMAGNETISM',
      color: '#ec4899',
      badge: '6 项实验',
      lead: '探究电荷相互作用、磁通演化、电磁感应及微观载流子偏转机理。',
      formulaText: 'ℰ = -dΦ/dt  ·  ∇·E = ρ/ε₀  ·  U_H = K·I·B',
      expList: [
        '静电场探索',
        '涡旋感生电场',
        '法拉第感应',
        '高斯通量定理',
        '霍尔微观机理',
        '螺线管测磁',
      ],
    },
    {
      id: 'optics',
      num: '03',
      name: '光学',
      en: 'OPTICS',
      color: '#d97706',
      badge: '5 项实验',
      lead: '研究光的传播路径、折射色散规律、波动干涉衍射与光谱特征。',
      formulaText: 'n₁sin i = n₂sin r  ·  Δx = λL/d  ·  1/u+1/v=1/f',
      expList: [
        '光的反射定律',
        '光的折射全反射',
        '三棱镜分光色散',
        '透镜光路成像',
        '单缝多缝干涉衍射',
      ],
    },
    {
      id: 'thermo',
      num: '04',
      name: '热力学',
      en: 'THERMODYNAMICS',
      color: '#ea580c',
      badge: '5 项实验',
      lead: '阐明热功转化机制、宏观状态方程演化及热量传递与分子统计规律。',
      formulaText: 'p·V = n·R·T  ·  dQ = dU + dW  ·  Q = c·m·ΔT',
      expList: [
        '混合量热平衡',
        '固体热膨胀',
        '稳态热传导',
        '理想气体定律',
        '自然对流换热',
      ],
    },
  ],
  get categories() {
    return [
      { id: 'all', name: '全部实验', en: 'ALL LABS', color: '#0284c7', count: 22 },
      ...this.stations.map((s) => ({
        id: s.id,
        name: s.name,
        en: s.en,
        color: s.color,
        count: this.items.filter((it) => it.cat === s.id).length,
      })),
    ];
  },
  items: [
    // ════════════ 1. 力学板块 ════════════
    {
      id: 'free_fall',
      cat: 'mechanics',
      expId: 'free-fall',
      expName: '自由落体实验',
      code: 'MECH-01',
      goal: '探究真空中重力加速度与物体质量无关规律及匀加速运动方程',
      tags: ['自由下落', '重力加速度 g', '光电测速'],
      title: '自由落体运动与重力加速度',
      formula: 'h=\\frac{1}{2}gt^{2}；v=\\sqrt{2gh}；t=\\sqrt{\\frac{2h}{g}}',
      concept: '物体只在重力作用下由静止开始下落的匀加速直线运动。真空中所有物体下落加速度相同，均等于当地重力加速度 g，与物体质量无关。',
      symbols: 'h — 下落高度 (m)　g — 重力加速度 (m/s²)　t — 下落时间 (s)　v — 落地瞬时速率 (m/s)',
      labLink: '力学实验台 · 自由落体：调节释放高度 h 与红蓝球质量 m₁/m₂，通过光电门测量时间并验证 g。',
    },
    {
      id: 'inclined_plane',
      cat: 'mechanics',
      expId: 'inclined-plane',
      expName: '斜面运动实验',
      code: 'MECH-02',
      goal: '测量斜面下滑加速度、摩擦因数及木块临界下滑倾角',
      tags: ['斜面动力学', '动摩擦因数 μ', '临界下滑角'],
      title: '斜面动力学与临界下滑角',
      formula: 'a=g(\\sin\\theta-\\mu\\cos\\theta)；\\tan\\theta_{c}=\\mu',
      concept: '物体在斜面上运动受重力分力与动摩擦力。当倾角增大至 tanθ_c = μ 时木块由静止转为加速下滑。',
      symbols: 'a — 下滑加速度 (m/s²)　θ — 斜面倾角 (°)　μ — 动摩擦因数　θ_c — 临界下滑角',
      labLink: '力学实验台 · 斜面运动：调节倾角 θ 与摩擦因数 μ，观察运动加速度并寻找临界角。',
    },
    {
      id: 'pendulum',
      cat: 'mechanics',
      expId: 'pendulum',
      expName: '单摆实验',
      code: 'MECH-03',
      goal: '研究单摆振动周期的等时性，验证摆长与重力加速度关系',
      tags: ['单摆周期', '摆长与 g', '小角简谐振动'],
      title: '单摆周期与小角简谐振动',
      formula: 'T=2\\pi\\sqrt{\\frac{l}{g}}；\\alpha=-\\frac{g}{l}\\sin\\theta',
      concept: '小摆角（θ ≤ 5°）下单摆做简谐运动，振动周期具有等时性，仅与摆长 l 和重力加速度 g 有关，与摆球质量无关。',
      symbols: 'T — 振动周期 (s)　l — 摆长 (m)　g — 重力加速度 (m/s²)　α — 角加速度',
      labLink: '力学实验台 · 单摆实验：改变摆长 L 与初始摆角 θ₀，对比小角简谐理论与阻尼大角度运动。',
    },
    {
      id: 'collision',
      cat: 'mechanics',
      expId: 'collision',
      expName: '碰撞与动能实验',
      code: 'MECH-04',
      goal: '在气垫导轨上检验一维碰撞中的动量守恒、能量转化与恢复系数',
      tags: ['动量守恒', '恢复系数 e', '速度交换'],
      title: '动量守恒定律与碰撞恢复系数',
      formula: 'm_{1}v_{1}+m_{2}v_{2}=m_{1}v_{1}\'+m_{2}v_{2}\'；e=\\frac{v_{2}\'-v_{1}\'}{v_{1}-v_{2}}',
      concept: '系统合外力为零时总动量守恒。完全弹性碰撞动能守恒（e = 1）；等质量完全弹性碰撞发生速度完全交换。',
      symbols: 'm — 质量 (kg)　v — 碰前速度 (m/s)　v\' — 碰后速度 (m/s)　e — 恢复系数',
      labLink: '力学实验台 · 碰撞实验：在气垫导轨切换弹性/非弹性模式，检验动量与动能变化。',
    },
    {
      id: 'projectile',
      cat: 'mechanics',
      expId: 'projectile',
      expName: '抛体运动实验',
      code: 'MECH-05',
      goal: '研究平抛与斜抛的正交分运动、飞行轨迹、射高与射程规律',
      tags: ['正交分运动', '初速度与仰角', '射高与射程'],
      title: '斜抛与平抛分运动轨迹',
      formula: 'x=v_{0}\\cos\\theta\\cdot t；y=v_{0}\\sin\\theta\\cdot t-\\frac{1}{2}gt^{2}',
      concept: '抛体运动可分解为水平匀速运动与竖直匀变速运动。发射仰角 45° 时射程最大；互补角射程相等。',
      symbols: 'v₀ — 初速度 (m/s)　θ — 发射仰角 (°)　x — 水平射程 (m)　y — 飞行高度 (m)',
      labLink: '力学实验台 · 抛体运动：开启频闪采样与分运动辅助线，对比射高、射程和飞行时间。',
    },
    {
      id: 'viscosity',
      cat: 'mechanics',
      expId: 'viscosity',
      expName: '落球法测粘滞系数',
      code: 'MECH-06',
      goal: '利用斯托克斯公式测定液体收尾速度与液体动力粘度',
      tags: ['液体粘滞阻力', '收尾速度', '管壁边界修正'],
      title: '斯托克斯公式与液体粘度测定',
      formula: '\\eta=\\frac{2r^{2}(\\rho-\\rho_{0})g}{9v(1+2.4r/R)}；v=\\frac{S}{\\Delta t}',
      concept: '小球在粘滞液体中达到收尾速度时重力、浮力与粘滞阻力平衡。采用 Stokes 定律结合管壁修正计算粘度。',
      symbols: 'η — 粘滞系数 (Pa·s)　r — 钢球半径 (m)　ρ — 钢球密度　ρ₀ — 液体密度　v — 终端速度',
      labLink: '力学实验台 · 粘滞系数：选择甘油/机油并释放钢球，通过双光电门测定终端速度。',
    },

    // ════════════ 2. 电磁学板块 ════════════
    {
      id: 'electric_field',
      cat: 'electro',
      expId: 'electric_field',
      expName: '静电场探索实验',
      code: 'EM-01',
      goal: '放置点电荷与试探电荷，观察空间电场线、等势线与库仑力',
      tags: ['库仑定律', '电场矢量叠加', '等势线分布'],
      title: '点电荷电场叠加与空间电势',
      formula: '\\vec{E}=\\frac{\\vec{F}}{q_{0}}；E=\\frac{1}{4\\pi\\varepsilon_{0}}\\frac{q}{r^{2}}；\\varphi=\\frac{1}{4\\pi\\varepsilon_{0}}\\frac{q}{r}',
      concept: '点电荷场强与距离平方成反比。空间多电荷满足电场矢量叠加原理；电场线与等势线处处正交。',
      symbols: 'E — 电场强度 (V/m)　q — 场源电荷 (C)　φ — 电势 (V)　ε₀ — 真空介电常量',
      labLink: '电磁学实验台 · 静电场：放置点电荷与试探电荷，观察电力线、等势线与电势阱。',
    },
    {
      id: 'faraday_induction',
      cat: 'electro',
      expId: 'faraday_induction',
      expName: '法拉第电磁感应实验',
      code: 'EM-02',
      goal: '研究动生与感生电动势，验证磁通量变化率与楞次定律方向',
      tags: ['磁通量变化', '感生/动生电动势', '楞次定律'],
      title: '法拉第电磁感应与楞次定律',
      formula: '\\mathcal{E}_{i}=-n\\frac{\\Delta\\Phi_{B}}{\\Delta t}；\\mathcal{E}=BLv',
      concept: '穿过闭合回路磁通量变化产生感应电动势。导体切割磁感线产生动生电动势；感应电流阻碍原磁通变化。',
      symbols: 'ℰ_i — 感应电动势 (V)　n — 线圈匝数　Φ_B — 磁通量 (Wb)　B — 磁感应强度 (T)',
      labLink: '电磁学实验台 · 电磁感应：拖动铜棒滑行或改变磁场强度，观察感生/动生电动势读数。',
    },
    {
      id: 'induced_electric_field',
      cat: 'electro',
      expId: 'induced_electric_field',
      expName: '感生电场实验',
      code: 'EM-03',
      goal: '观测随时间变化的磁场激发的闭合涡旋感生电场空间分布',
      tags: ['麦克斯韦方程', '涡旋电场', '柱内外场强'],
      title: '麦克斯韦涡旋感生电场',
      formula: '\\oint \\vec{E}_{k}\\cdot \\mathrm{d}\\vec{l}=-\\frac{\\mathrm{d}\\Phi_{B}}{\\mathrm{d}t}；E=\\frac{r}{2}\\left|\\frac{\\mathrm{d}B}{\\mathrm{d}t}\\right|',
      concept: '变化磁场激发闭合涡旋感生电场。圆柱磁场区内部场强与半径 r 成正比，外部与 1/r 成反比。',
      symbols: 'E_k — 感生电场强度 (V/m)　Φ_B — 磁通量 (Wb)　r — 离轴距离 (m)　dB/dt — 磁场变化率 (T/s)',
      labLink: '电磁学实验台 · 感生电场：拖动试探电荷在磁场柱内外移动，观察涡旋电场线与受力。',
    },
    {
      id: 'gauss_theorem',
      cat: 'electro',
      expId: 'electric_field',
      expName: '静电场高斯定理实验',
      code: 'EM-04',
      goal: '构建闭合高斯曲面，检验总电通量与内部包围净电荷的守恒关系',
      tags: ['高斯曲面', '电通量积分', '净电荷守恒'],
      title: '静电场高斯定理与通量守恒',
      formula: '\\Phi_{E}=\\oint \\vec{E}\\cdot \\mathrm{d}\\vec{S}=\\frac{Q_{内}}{\\varepsilon_{0}}',
      concept: '穿过任意闭合曲面的总电通量等于曲面所包围的净电荷代数和除以 ε₀，与面外电荷无关。',
      symbols: 'Φ_E — 电通量 (V·m)　E — 电场强度 (V/m)　Q内 — 闭合面内净电荷 (C)　S — 闭合高斯面',
      labLink: '电磁学实验台 · 静电场：构建闭合高斯面，检验电通量与内部净电荷量守恒关系。',
    },
    {
      id: 'hall_carrier_demo',
      cat: 'electro',
      expId: 'hall_carrier_demo',
      expName: '霍尔效应原理实验',
      code: 'EM-05',
      goal: '观察载流子受洛伦兹力偏转机理，判定 n 型电子与 p 型空穴导电极性',
      tags: ['洛伦兹力偏转', '横向霍尔电场', 'n/p 极性判定'],
      title: '霍尔效应微观机理与载流子',
      formula: 'U_{H}=K_{IB}\\cdot I\\cdot B；\\vec{F}=q(\\vec{E}+\\vec{v}\\times\\vec{B})',
      concept: '通电载流片置于磁场中，载流子受洛伦兹力偏转积累建立横向霍尔电场。正负判定 n/p 型。',
      symbols: 'U_H — 霍尔电势差 (V)　I — 工作电流 (A)　B — 磁感应强度 (T)　K_IB — 灵敏度 (V/(A·T))',
      labLink: '电磁学实验台 · 霍尔原理：调节 I 与 B，切换 n/p 型半导体观察载流子偏转方向。',
    },
    {
      id: 'hall_effect',
      cat: 'electro',
      expId: 'hall_effect',
      expName: '霍尔效应测磁实验',
      code: 'EM-06',
      goal: '沿轴线移动标定霍尔探头，扫描亥姆霍兹线圈与长螺线管的磁场分布',
      tags: ['霍尔测磁仪', '亥姆霍兹匀强磁场', '轴线磁场扫描'],
      title: '亥姆霍兹线圈与螺线管磁场',
      formula: 'U_{H}=K_{H}I_{s}B；K=\\frac{U_{H}}{I_{s}B}；B_{H}=\\mu_{0}\\left(\\frac{4}{5}\\right)^{3/2}\\frac{NI}{R}',
      concept: '利用标定霍尔探头测量空间磁场。螺线管中心测得 VH=7.39mV，标定探头灵敏度 K=301 V/(A·T)。',
      symbols: 'K_H — 探头灵敏度 (V/(A·T))　I_s — 霍尔电流 (A)　B — 磁感应强度 (T)',
      labLink: '电磁学实验台 · 霍尔测磁：沿轴线移动探头，扫描线圈与螺线管的 B–X 空间曲线。',
    },

    // ════════════ 3. 光学板块 ════════════
    {
      id: 'optics_reflection',
      cat: 'optics',
      expId: 'reflection',
      expName: '光的反射实验',
      code: 'OPT-01',
      goal: '验证光的反射定律，探究反射镜面旋转时出射光线的偏转倍率',
      tags: ['反射定律', '平面镜成像', '镜面旋转偏转'],
      title: '光的反射定律与镜面旋转偏转',
      formula: 'i=i\'；\\Delta\\theta_{r}=2\\alpha',
      concept: '反射角等于入射角。当平面镜绕法线垂直轴旋转 α 角时，反射光线偏转 2α 角。',
      symbols: 'i — 入射角 (°)　i\' — 反射角 (°)　α — 镜面旋转角 (°)　Δθ_r — 反射偏转角',
      labLink: '光学实验台 · 光的反射：旋转反射镜台并切换多光束/凸面镜，记录入射角与反射角。',
    },
    {
      id: 'optics_refraction',
      cat: 'optics',
      expId: 'refraction',
      expName: '光的折射实验',
      code: 'OPT-02',
      goal: '测量不同透明介质折射率，观察全反射临界角及平板玻璃侧移',
      tags: ['斯涅尔折射', '全反射临界角', '平板平行侧移'],
      title: '斯涅尔折射定律与全反射',
      formula: 'n_{1}\\sin i = n_{2}\\sin r；\\sin C=\\frac{n_{2}}{n_{1}}',
      concept: '光由光疏介质进入光密介质向法线偏折。入射角大于临界角 C 时折射光消失，发生全反射。',
      symbols: 'n₁、n₂ — 介质折射率　i — 入射角 (°)　r — 折射角 (°)　C — 全反射临界角',
      labLink: '光学实验台 · 光的折射：切换介质预设，观察光束偏折、全反射临界角及平板玻璃侧移。',
    },
    {
      id: 'optics_dispersion',
      cat: 'optics',
      expId: 'dispersion',
      expName: '光的色散实验',
      code: 'OPT-03',
      goal: '观察白光通过等边三棱镜的光谱展宽，测量三棱镜最小偏向角',
      tags: ['三棱镜分光', '折射率色散 n(λ)', '最小偏向角'],
      title: '三棱镜色散与最小偏向角',
      formula: 'n=n(\\lambda)；n=\\frac{\\sin[(A+\\delta_{m})/2]}{\\sin(A/2)}',
      concept: '透明介质对短波长紫光折射率大于长波长红光。白光经三棱镜色散成彩虹光谱。',
      symbols: 'n(λ) — 色散关系　A — 棱镜顶角 (°)　δ_m — 最小偏向角 (°)　λ — 光波长 (nm)',
      labLink: '光学实验台 · 光的色散：点亮白光入射等边三棱镜，在接收屏观察红到紫光谱展宽。',
    },
    {
      id: 'optics_lens',
      cat: 'optics',
      expId: 'lens',
      expName: '透镜光路实验',
      code: 'OPT-04',
      goal: '观察球透镜与柱面透镜光束会聚，采用共轭两次成像法精确测定焦距',
      tags: ['薄透镜成像', '共轭法测焦距', '柱面平行光会聚'],
      title: '薄透镜成像与共轭法测焦距',
      formula: '\\frac{1}{u}+\\frac{1}{v}=\\frac{1}{f}；f=\\frac{L^{2}-d^{2}}{4L}',
      concept: '凸透镜使平行光会聚。当物屏与像屏距离 L > 4f 时，存在两处清晰成像位置，间距为 d。',
      symbols: 'u — 物距 (m)　v — 像距 (m)　f — 透镜焦距 (m)　L — 物像屏距 (m)　d — 共轭位移',
      labLink: '光学实验台 · 透镜光路：选用球透镜与柱面透镜，观察光束会聚焦点并测量焦距。',
    },
    {
      id: 'optics_diffraction',
      cat: 'optics',
      expId: 'multi_slit_diffraction',
      expName: '单缝衍射 · 多缝干涉',
      code: 'OPT-05',
      goal: '研究光的波动性：调节缝宽、缝间距与波长，观察衍射与干涉图样',
      tags: ['夫琅禾费衍射', '双缝/多缝干涉', '明暗条纹光强'],
      title: '夫琅禾费衍射与多缝干涉条纹',
      formula: '\\sin\\theta=\\frac{\\lambda}{a}；\\Delta x=\\frac{\\lambda L}{d}；I(\\theta)=I_{0}\\left(\\frac{\\sin\\alpha}{\\alpha}\\right)^{2}\\left(\\frac{\\sin N\\beta}{\\sin\\beta}\\right)^{2}',
      concept: '单缝衍射中央亮纹由缝宽 a 决定；多缝干涉条纹间距由 d 决定。多缝受单缝衍射包络调制。',
      symbols: 'λ — 光波长 (nm)　a — 单缝宽度 (μm)　d — 双缝间距 (μm)　L — 屏距 (m)　Δx — 条纹间距',
      labLink: '光学实验台 · 衍射干涉：调节波长、缝宽与缝间距，在观察屏与强度曲线对照规律。',
    },

    // ════════════ 4. 热力学板块 ════════════
    {
      id: 'thermo_calorimetry',
      cat: 'thermo',
      expId: 'calorimetry',
      expName: '混合量热实验',
      code: 'THERM-01',
      goal: '冷热水绝热混合，监测热平衡演化曲线并测定待测液体比热容',
      tags: ['热量传递', '热平衡温度', '比热容测定'],
      title: '热平衡方程与混合平衡温度',
      formula: 'Q=cm\\Delta t；Q_{放}=Q_{吸}；T_{eq}=\\frac{c_{1}m_{1}T_{1}+c_{2}m_{2}T_{2}}{c_{1}m_{1}+c_{2}m_{2}}',
      concept: '绝热系统内不同温度物质混合时发生热交换，高温放热等于低温吸热，达到平衡终温 T_eq。',
      symbols: 'Q — 热量 (J)　c — 比热容 (J/(kg·K))　m — 质量 (kg)　T_eq — 平衡终温 (°C)',
      labLink: '热力学实验台 · 混合量热：倒入冷热水，实时监测温度曲线并计算混合热平衡。',
    },
    {
      id: 'thermo_expansion',
      cat: 'thermo',
      expId: 'thermal-expansion',
      expName: '固体热膨胀实验',
      code: 'THERM-02',
      goal: '加热金属试样棒，测量微米级受热伸长量并测定线膨胀系数',
      tags: ['晶格热膨胀', '固体线膨胀定律', '金属材料对比'],
      title: '固体线膨胀定律与膨胀系数',
      formula: '\\Delta l=\\alpha l_{0}\\Delta t；l=l_{0}(1+\\alpha\\Delta t)',
      concept: '固体受热后原子点阵振动加剧使晶格膨胀。铝、铜、钢、殷钢等材料膨胀系数差异显著。',
      symbols: 'α — 线膨胀系数 (1/K)　l₀ — 试样初始长度 (m)　Δl — 伸长量 (mm)　Δt — 温升 (°C)',
      labLink: '热力学实验台 · 热膨胀：选择铝/铜/钢/殷钢试样棒加热，观察微米级伸长与读数。',
    },
    {
      id: 'thermo_conduction',
      cat: 'thermo',
      expId: 'heat-conduction',
      expName: '稳态热传导实验',
      code: 'THERM-03',
      goal: '设定热端与冷端恒温源，观测一维稳态线性温度分布与热通量',
      tags: ['傅里叶导热定律', '导热系数 k', '稳态温度分布'],
      title: '傅里叶导热定律与一维温度梯度',
      formula: '\\frac{\\mathrm{d}Q}{\\mathrm{d}t}=-kA\\frac{\\mathrm{d}T}{\\mathrm{d}x}；q=k\\frac{\\Delta T}{\\Delta x}',
      concept: '物体内部存在温度梯度时发生热传导。稳态下一维金属导热棒温度呈理想线性分布。',
      symbols: 'k — 导热系数 (W/(m·K))　A — 截面积 (m²)　dT/dx — 温度梯度 (K/m)　q — 热流密度',
      labLink: '热力学实验台 · 热传导：设定热冷端恒温源，观察试样管内稳态线性温度分布。',
    },
    {
      id: 'thermo_ideal_gas',
      cat: 'thermo',
      expId: 'ideal-gas',
      expName: '理想气体定律实验',
      code: 'THERM-04',
      goal: '推拉活塞改变气体体积与温度，验证 p-V-T 理想气体状态方程',
      tags: ['状态方程 pV=nRT', '分子平均动能', '等温/等容过程'],
      title: '理想气体状态方程与分子动能',
      formula: 'pV=nRT；p=\\frac{2}{3}n_{0}\\bar{\\varepsilon}_{k}；\\bar{\\varepsilon}_{k}=\\frac{3}{2}k_{B}T',
      concept: '一定质量理想气体满足 pV = nRT。温度是分子平均平动动能的标志，压强源于分子碰撞。',
      symbols: 'p — 气体压强 (Pa)　V — 气体体积 (m³)　T — 热力学温度 (K)　R — 摩尔气体常量',
      labLink: '热力学实验台 · 理想气体：推拉活塞改变体积，调节温度，验证 p-V-T 等温等压规律。',
    },
    {
      id: 'thermo_convection',
      cat: 'thermo',
      expId: 'convection',
      expName: '自然对流实验',
      code: 'THERM-05',
      goal: '调节热底板温度，观察封闭腔体内热浮力驱动的循环对流流动',
      tags: ['热浮力驱动', '牛顿冷却换热', '热羽流与 Ra 数'],
      title: '牛顿冷却定律与自然对流',
      formula: 'Q=hA\\Delta T；Ra=Gr\\cdot Pr',
      concept: '流体受热膨胀上升、遇冷收缩下沉，形成热浮力驱动对流。瑞利数 Ra 决定流动形态。',
      symbols: 'h — 换热系数 (W/(m²·K))　A — 换热面积 (m²)　ΔT — 壁面温差 (°C)　Ra — 瑞利数',
      labLink: '热力学实验台 · 自然对流：调节热底板温度，观察封闭腔体内热羽流演化与回流。',
    },
  ],
};

// ═════════════════════════════════════════════════════════
// 页面 1：四大物理板块大屏主页 (Home / Hub View) — 2×2 宽屏工作台布局、巨型靶区、极速直达
// ═════════════════════════════════════════════════════════
function drawHomeView(ctx, W, H, stateOrHits, maybeHits) {
  const hits = Array.isArray(stateOrHits) ? stateOrHits : (maybeHits || []);
  const state = Array.isArray(stateOrHits) ? {} : (stateOrHits || {});
  const activeStationId = state.activeStationId || 'mechanics';

  const stations = FORMULA_CATALOG.stations;
  const padX = 44;
  const padY = 36;
  const gapX = 32;
  const gapY = 28;
  const cols = 2;
  const rows = 2;
  const cardW = (W - padX * 2 - gapX * (cols - 1)) / cols;
  const cardH = (H - padY * 2 - gapY * (rows - 1)) / rows;

  // 领域核心标签映射（大字展示，无多余小字）
  const domainTags = {
    mechanics: '运动与力 · 动量能量 · 守恒定律',
    electro: '电磁感应 · 静电高斯 · 洛伦兹力',
    optics: '几何成像 · 色散折射 · 波动干涉',
    thermo: '状态方程 · 混合量热 · 热量传递',
  };

  // ════════════ 2 × 2 宽屏大卡片渲染 ════════════
  stations.forEach((st, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cardW + gapX);
    const y = padY + row * (cardH + gapY);
    const isActive = st.id === activeStationId;

    // 激活状态外发光光晕
    if (isActive) {
      ctx.fillStyle = hexToRgba(st.color, 0.16);
      roundRect(ctx, x - 8, y - 8, cardW + 16, cardH + 16, 28);
      ctx.fill();
    }

    // 卡片主背景与顶部装饰条（通过 clip 完美贴合卡片顶部圆角）
    const cardGrad = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
    cardGrad.addColorStop(0, '#ffffff');
    cardGrad.addColorStop(0.65, '#ffffff');
    cardGrad.addColorStop(1, hexToRgba(st.color, 0.1));

    ctx.save();
    roundRect(ctx, x, y, cardW, cardH, 24);
    ctx.clip?.();

    ctx.fillStyle = cardGrad;
    ctx.fillRect(x, y, cardW, cardH);

    // 顶部主题色高亮条（与圆角无缝贴合）
    ctx.fillStyle = st.color;
    ctx.fillRect(x, y, cardW, 10);

    ctx.restore();

    // 绘制外边框
    ctx.strokeStyle = isActive ? st.color : hexToRgba(st.color, 0.42);
    ctx.lineWidth = isActive ? 3.5 : 2.5;
    roundRect(ctx, x, y, cardW, cardH, 24);
    ctx.stroke();

    // ════════ 左半部分：编号、主标题、英文副标题与核心方向 ════════
    const leftPad = x + 36;

    // 1. 顶部编号胶囊 + 实验数量徽标
    const topRowY = y + 28;

    // 编号胶囊
    const numBadgeW = 58;
    const numBadgeH = 36;
    ctx.fillStyle = hexToRgba(st.color, 0.12);
    ctx.strokeStyle = hexToRgba(st.color, 0.4);
    ctx.lineWidth = 1.4;
    roundRect(ctx, leftPad, topRowY, numBadgeW, numBadgeH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = st.color;
    ctx.font = buildUiFont(20, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.num, leftPad + numBadgeW / 2, topRowY + numBadgeH / 2);

    // 实验数量徽标
    const badgeText = `● ${st.badge}`;
    ctx.font = buildUiFont(18, 'bold');
    const badgeW = ctx.measureText(badgeText).width + 32;
    const badgeH = 36;
    const badgeX = leftPad + numBadgeW + 16;
    ctx.fillStyle = 'rgba(241, 245, 249, 0.95)';
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.9)';
    ctx.lineWidth = 1.4;
    roundRect(ctx, badgeX, topRowY, badgeW, badgeH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = st.color;
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, badgeX + badgeW / 2, topRowY + badgeH / 2);

    // 2. 核心大标题
    const titleY = y + 92;
    ctx.fillStyle = '#0f172a';
    ctx.font = buildUiFont(56, 'bold');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(st.name, leftPad, titleY);

    // 英文副标题
    const enY = titleY + 68;
    ctx.fillStyle = st.color;
    ctx.font = buildUiFont(20, 'bold');
    ctx.fillText(st.en, leftPad, enY);

    // 3. 领域核心大标签 (清晰醒目)
    const tagY = enY + 42;
    const dTag = domainTags[st.id] || '基础物理仿真实验';
    ctx.fillStyle = '#475569';
    ctx.font = buildUiFont(20, '600');
    ctx.fillText(dTag, leftPad, tagY);

    // ════════ 右半部分：巨型进入按钮与交互区 ════════
    const btnW = 310;
    const btnH = 92;
    const btnX = x + cardW - btnW - 40;
    const btnY = y + (cardH - btnH) / 2 + 10;

    // 按钮背景发光渐变
    const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
    btnGrad.addColorStop(0, st.color);
    btnGrad.addColorStop(1, hexToRgba(st.color, 0.88));

    ctx.fillStyle = btnGrad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    // 按钮文字与箭头
    ctx.fillStyle = '#ffffff';
    ctx.font = buildUiFont(28, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('进入实验台 ➔', btnX + btnW / 2, btnY + btnH / 2);

    // 交互热区：整张大卡片和按钮均为一键直达点击区
    hits.push({
      id: `station-${st.id}`,
      x,
      y,
      w: cardW,
      h: cardH,
      action: 'station',
      stationId: st.id,
    });

    hits.push({
      id: `btn-${st.id}`,
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      action: 'station',
      stationId: st.id,
    });
  });
}

// ═════════════════════════════════════════════════════════
// 页面 2：实验台子页面 (Station Sub-page View) — 右上角大号返回按钮、大序号 01/02、极速直达
// ═════════════════════════════════════════════════════════
function drawStationSubpageView(ctx, W, H, stationId, hits) {
  const st = FORMULA_CATALOG.stations.find((s) => s.id === stationId) || FORMULA_CATALOG.stations[0];
  const items = FORMULA_CATALOG.items.filter((it) => it.cat === st.id);
  const headerH = 88;
  const padX = 44;

  // 顶部导航栏背景
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillRect(0, 0, W, headerH);
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(W, headerH);
  ctx.stroke();

  // 左侧当前领域名称标识（醒目大字）
  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(32, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${st.name} · 实验列表`, padX + 8, headerH / 2);

  // 右上角独立大号返回按钮
  const backW = 260;
  const backH = 60;
  const backX = W - padX - backW;
  const backY = (headerH - backH) / 2;

  const backGrad = ctx.createLinearGradient(backX, backY, backX, backY + backH);
  backGrad.addColorStop(0, '#ffffff');
  backGrad.addColorStop(1, '#f1f5f9');
  ctx.fillStyle = backGrad;
  ctx.strokeStyle = st.color;
  ctx.lineWidth = 2.4;
  roundRect(ctx, backX, backY, backW, backH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(26, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('← 返回', backX + backW / 2, backY + backH / 2);

  hits.push({
    id: 'back-home',
    x: backX,
    y: backY,
    w: backW,
    h: backH,
    action: 'home',
  });

  // 实验卡片网格（3 列 × 2 行，纯净大字排版，大号 01/02 序号，全卡片一键直达）
  const gridTop = headerH + 20;
  const bottomPad = 26;
  const cols = 3;
  const rows = 2;
  const gapX = 24;
  const gapY = 24;
  const cardW = (W - padX * 2 - gapX * (cols - 1)) / cols;
  const cardH = (H - gridTop - bottomPad - gapY * (rows - 1)) / rows;

  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cardW + gapX);
    const y = gridTop + row * (cardH + gapY);

    // 卡片主背景与顶部装饰条（通过 clip 完美贴合圆角）
    const cardGrad = ctx.createLinearGradient(x, y, x, y + cardH);
    cardGrad.addColorStop(0, '#ffffff');
    cardGrad.addColorStop(0.65, '#ffffff');
    cardGrad.addColorStop(1, hexToRgba(st.color, 0.09));

    ctx.save();
    roundRect(ctx, x, y, cardW, cardH, 22);
    ctx.clip?.();

    ctx.fillStyle = cardGrad;
    ctx.fillRect(x, y, cardW, cardH);

    // 顶部主题色带
    ctx.fillStyle = st.color;
    ctx.fillRect(x, y, cardW, 8);
    ctx.restore();

    ctx.strokeStyle = hexToRgba(st.color, 0.42);
    ctx.lineWidth = 2.4;
    roundRect(ctx, x, y, cardW, cardH, 22);
    ctx.stroke();

    // 1. 左上角大号醒目序号 (01, 02, 03...)
    const numStr = String(i + 1).padStart(2, '0');
    ctx.fillStyle = st.color;
    ctx.font = buildUiFont(44, 'bold');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(numStr, x + 26, y + 24);

    // 2. 实验主标题 (居中大字号)
    ctx.fillStyle = '#0f172a';
    ctx.font = buildUiFont(36, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.expName, x + cardW / 2, y + 122);

    // 3. 核心物理方向标签 (大字标签，无小字)
    const tagText = it.tags ? it.tags.slice(0, 2).join(' · ') : '';
    if (tagText) {
      ctx.fillStyle = '#64748b';
      ctx.font = buildUiFont(18, '600');
      ctx.fillText(tagText, x + cardW / 2, y + 178);
    }

    // 4. 底部全宽进入按钮
    const btnW = cardW - 56;
    const btnH = 74;
    const btnX = x + 28;
    const btnY = y + cardH - btnH - 22;

    const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX, btnY + btnH);
    btnGrad.addColorStop(0, st.color);
    btnGrad.addColorStop(1, hexToRgba(st.color, 0.88));

    ctx.fillStyle = btnGrad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 18);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = buildUiFont(24, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('进入实验 ➔', btnX + btnW / 2, btnY + btnH / 2);

    // 交互热区：整张卡片（含内部按钮）为一键进入实验
    hits.push({
      id: `item-${it.id}`,
      x,
      y,
      w: cardW,
      h: cardH,
      action: 'select',
      itemId: it.id,
    });
  });
}

// ═════════════════════════════════════════════════════════
// 页面 3：单实验深度解析页 (Experiment Detail View) — 顶栏仅保留右上角大号返回按钮、大字号公式与清晰物理量
// ═════════════════════════════════════════════════════════
function drawExperimentDetailView(ctx, W, H, state, hits) {
  const selected = FORMULA_CATALOG.items.find((it) => it.id === state.selectedId) || FORMULA_CATALOG.items[0];
  const st = FORMULA_CATALOG.stations.find((s) => s.id === selected.cat) || FORMULA_CATALOG.stations[0];

  const headerH = 88;
  const padX = 44;

  // 顶部 Header 背景
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillRect(0, 0, W, headerH);
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(W, headerH); ctx.stroke();

  // 左侧当前实验标题与所属领域
  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(28, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`【${selected.code}】${selected.expName} · ${selected.title}`, padX + 8, headerH / 2);

  // 右上角独立大号返回按钮
  const backW = 260;
  const backH = 60;
  const backX = W - padX - backW;
  const backY = (headerH - backH) / 2;

  const backGrad = ctx.createLinearGradient(backX, backY, backX, backY + backH);
  backGrad.addColorStop(0, '#ffffff');
  backGrad.addColorStop(1, '#f1f5f9');
  ctx.fillStyle = backGrad;
  ctx.strokeStyle = st.color;
  ctx.lineWidth = 2.4;
  roundRect(ctx, backX, backY, backW, backH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(26, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('← 返回', backX + backW / 2, backY + backH / 2);

  hits.push({
    id: 'back-station',
    x: backX,
    y: backY,
    w: backW,
    h: backH,
    action: 'back',
  });

  // 左右双主卡片分栏布局
  const contentTop = headerH + 20;
  const contentH = H - contentTop - 24;
  const gap = 28;
  const cardW = (W - padX * 2 - gap) / 2;
  const leftX = padX;
  const rightX = leftX + cardW + gap;

  // ════════════ 左侧主卡片 (公式 + 物理量) ════════════
  ctx.save();
  roundRect(ctx, leftX, contentTop, cardW, contentH, 22);
  ctx.clip?.();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.fillRect(leftX, contentTop, cardW, contentH);

  ctx.fillStyle = st.color;
  ctx.fillRect(leftX, contentTop, cardW, 8);
  ctx.restore();

  ctx.strokeStyle = hexToRgba(st.color, 0.45);
  ctx.lineWidth = 2.4;
  roundRect(ctx, leftX, contentTop, cardW, contentH, 22);
  ctx.stroke();

  // 1. 核心公式展示区
  const fBoxX = leftX + 24;
  const fBoxY = contentTop + 24;
  const fBoxW = cardW - 48;
  const fBoxH = 260;

  ctx.fillStyle = hexToRgba(st.color, 0.05);
  ctx.strokeStyle = hexToRgba(st.color, 0.35);
  ctx.lineWidth = 2;
  roundRect(ctx, fBoxX, fBoxY, fBoxW, fBoxH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(24, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('01 · 核心物理公式与数学模型', fBoxX + 22, fBoxY + 18);

  drawFormulaCardGroup(
    ctx,
    selected.formulaCards || selected.formula,
    fBoxX + 16,
    fBoxY + 54,
    fBoxW - 32,
    fBoxH - 68,
    { themeColor: st.color },
  );

  // 2. 物理量与符号说明 (SI 标准)
  const symBoxY = fBoxY + fBoxH + 20;
  const symBoxH = contentH - (symBoxY - contentTop) - 24;

  ctx.fillStyle = hexToRgba(st.color, 0.04);
  ctx.strokeStyle = hexToRgba(st.color, 0.3);
  ctx.lineWidth = 2;
  roundRect(ctx, fBoxX, symBoxY, fBoxW, symBoxH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(24, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('02 · 物理量与符号标准 (SI Units)', fBoxX + 22, symBoxY + 18);

  const rawTokens = (selected.symbols || '').split('　').map((t) => t.trim()).filter(Boolean);
  const parsedSymbols = rawTokens.map((tok) => {
    const parts = tok.split('—').map((p) => p.trim());
    return {
      sym: parts[0] || '',
      desc: parts.slice(1).join(' — ') || '',
    };
  });

  const symCount = parsedSymbols.length;
  const cols = symCount > 2 ? 2 : 1;
  const itemGapX = 18;
  const itemGapY = 14;
  const itemW = (fBoxW - 44 - itemGapX * (cols - 1)) / cols;
  const startItemY = symBoxY + 62;
  const rows = Math.ceil(symCount / cols);
  const availableH = symBoxH - 78;
  const itemH = Math.min(68, Math.max(52, (availableH - itemGapY * (rows - 1)) / rows));

  parsedSymbols.forEach((item, sIdx) => {
    const col = sIdx % cols;
    const row = Math.floor(sIdx / cols);
    const ix = fBoxX + 22 + col * (itemW + itemGapX);
    const iy = startItemY + row * (itemH + itemGapY);

    if (iy + itemH <= symBoxY + symBoxH - 8) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
      ctx.strokeStyle = hexToRgba(st.color, 0.35);
      ctx.lineWidth = 1.6;
      roundRect(ctx, ix, iy, itemW, itemH, 12);
      ctx.fill();
      ctx.stroke();

      const badgeW = 76;
      const badgeH = itemH - 12;
      const badgeX = ix + 6;
      const badgeY = iy + 6;

      ctx.fillStyle = hexToRgba(st.color, 0.15);
      ctx.strokeStyle = hexToRgba(st.color, 0.45);
      ctx.lineWidth = 1.4;
      roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 8);
      ctx.fill();
      ctx.stroke();

      drawMathFormula(ctx, item.sym, badgeX + badgeW / 2, badgeY + badgeH / 2, {
        fontSize: 24,
        color: st.color,
        align: 'center',
        textBaseline: 'middle',
        maxWidth: badgeW - 6,
      });

      ctx.fillStyle = '#0f172a';
      ctx.font = buildUiFont(20, '600');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.desc, ix + badgeW + 16, iy + itemH / 2);
    }
  });

  // ════════════ 右侧主卡片 (实验机理 + 3D实测) ════════════
  ctx.save();
  roundRect(ctx, rightX, contentTop, cardW, contentH, 22);
  ctx.clip?.();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.fillRect(rightX, contentTop, cardW, contentH);

  ctx.fillStyle = st.color;
  ctx.fillRect(rightX, contentTop, cardW, 8);
  ctx.restore();

  ctx.strokeStyle = hexToRgba(st.color, 0.45);
  ctx.lineWidth = 2.4;
  roundRect(ctx, rightX, contentTop, cardW, contentH, 22);
  ctx.stroke();

  // 右上模块：实验理论与物理机理
  const mechBoxY = contentTop + 24;
  const mechBoxH = 340;
  const mechBoxW = cardW - 48;
  const mechBoxX = rightX + 24;

  ctx.fillStyle = hexToRgba(st.color, 0.04);
  ctx.strokeStyle = hexToRgba(st.color, 0.3);
  ctx.lineWidth = 2;
  roundRect(ctx, mechBoxX, mechBoxY, mechBoxW, mechBoxH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(24, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('03 · 实验理论与物理机理', mechBoxX + 22, mechBoxY + 20);

  ctx.fillStyle = '#1e293b';
  ctx.font = buildUiFont(24, '500');
  const conceptLines = wrapText(ctx, selected.concept, mechBoxW - 48);
  conceptLines.forEach((ln, idx) => {
    ctx.fillText(ln, mechBoxX + 24, mechBoxY + 70 + idx * 42);
  });

  // 右下模块：3D 实验室实测与操作指引
  const labBoxY = mechBoxY + mechBoxH + 20;
  const labBoxH = contentH - (labBoxY - contentTop) - 24;

  ctx.fillStyle = hexToRgba(st.color, 0.04);
  ctx.strokeStyle = hexToRgba(st.color, 0.3);
  ctx.lineWidth = 2;
  roundRect(ctx, mechBoxX, labBoxY, mechBoxW, labBoxH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = st.color;
  ctx.font = buildUiFont(24, 'bold');
  ctx.fillText('04 · 3D 实验室实测与操作指引', mechBoxX + 22, labBoxY + 20);

  ctx.fillStyle = '#1e293b';
  ctx.font = buildUiFont(24, '500');
  const labLines = wrapText(ctx, selected.labLink, mechBoxW - 48);
  labLines.forEach((ln, idx) => {
    ctx.fillText(ln, mechBoxX + 24, labBoxY + 70 + idx * 42);
  });
}

// ═════════════════════════════════════════════════════════
// 页面 0：待机休眠视图 (Standby View) — 纯粹高能科技图腾、发光霓虹星环
// ═════════════════════════════════════════════════════════
function drawStandbyView(ctx, W, H) {
  // 深空高科技暗色渐变背景
  const darkBg = ctx.createLinearGradient(0, 0, W, H);
  darkBg.addColorStop(0, '#030712');
  darkBg.addColorStop(0.5, '#0b1329');
  darkBg.addColorStop(1, '#0f172a');
  ctx.fillStyle = darkBg;
  ctx.fillRect(0, 0, W, H);

  // 科技网格背景
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // 居中核心坐标
  const cx = W / 2;
  const cy = H / 2;

  ctx.save();
  ctx.globalAlpha = 0.45; // 整体柔和淡化

  // 背景同心雷达测量环 (轻量科技纵深)
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 360, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.beginPath(); ctx.arc(cx, cy, 270, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
  ctx.beginPath(); ctx.arc(cx, cy, 180, 0, Math.PI * 2); ctx.stroke();

  // 中心柔和径向能量光晕
  const coreRadial = ctx.createRadialGradient(cx, cy, 10, cx, cy, 360);
  coreRadial.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
  coreRadial.addColorStop(0.4, 'rgba(14, 165, 233, 0.06)');
  coreRadial.addColorStop(0.8, 'rgba(14, 165, 233, 0.01)');
  coreRadial.addColorStop(1, 'transparent');
  ctx.fillStyle = coreRadial;
  ctx.beginPath();
  ctx.arc(cx, cy, 360, 0, Math.PI * 2);
  ctx.fill();

  // 辅助发光椭圆绘制函数 (柔和半透明星环)
  const drawGlowOrbit = (rx, ry, rot, mainColor, glowColor) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // 1. 外层柔和弱光晕
    ctx.strokeStyle = hexToRgba(glowColor || mainColor, 0.12);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 2. 中层优雅星环本体
    ctx.strokeStyle = hexToRgba(mainColor, 0.7);
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 3. 内层高光亮线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  };

  // 4 大物理领域代表发光星环
  // 1. 电离天青蓝星环 (-32°)
  drawGlowOrbit(280, 105, -Math.PI / 5.5, '#00f0ff', '#38bdf8');

  // 2. 霓虹紫星环 (+32°)
  drawGlowOrbit(280, 105, Math.PI / 5.5, '#e879f9', '#c084fc');

  // 3. 极光金垂直星环 (90°)
  drawGlowOrbit(260, 96, Math.PI / 2, '#fbbf24', '#f59e0b');

  // 4. 电光蓝水平能量环 (0°)
  drawGlowOrbit(270, 100, 0, '#38bdf8', '#0284c7');

  // 轨道上的发光量子节点
  const nodes = [
    { x: cx + 245 * Math.cos(Math.PI / 5.5), y: cy - 90 * Math.sin(Math.PI / 5.5), color: '#00f0ff' },
    { x: cx - 245 * Math.cos(Math.PI / 5.5), y: cy + 90 * Math.sin(Math.PI / 5.5), color: '#e879f9' },
    { x: cx, y: cy - 260, color: '#fbbf24' },
    { x: cx + 270, y: cy, color: '#38bdf8' },
    { x: cx - 270, y: cy, color: '#38bdf8' },
  ];

  nodes.forEach((n) => {
    // 节点外发光
    ctx.fillStyle = hexToRgba(n.color, 0.25);
    ctx.beginPath();
    ctx.arc(n.x, n.y, 10, 0, Math.PI * 2);
    ctx.fill();

    // 节点主体
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // 节点白色核心
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(n.x, n.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // 核心柔和原子反应核
  // 外层能量环
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 60, 0, Math.PI * 2);
  ctx.stroke();

  // 中心发光球体
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
  coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  coreGrad.addColorStop(0.25, 'rgba(125, 211, 252, 0.6)');
  coreGrad.addColorStop(0.65, 'rgba(2, 132, 199, 0.35)');
  coreGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 50, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawFormulaBoard(ctx, W, H, state = {}) {
  if (state.isStandby) {
    drawStandbyView(ctx, W, H, state);
    return { hits: [] };
  }

  const hits = [];
  const stationId = state.stationId
    || (state.category && state.category !== 'all' ? state.category : null);
  const selectedId = state.selectedId || null;
  const background = ctx.createLinearGradient(0, 0, W, H);
  background.addColorStop(0, '#f8fafc');
  background.addColorStop(0.5, '#f1f5f9');
  background.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  if (selectedId) drawExperimentDetailView(ctx, W, H, state, hits);
  else if (stationId) drawStationSubpageView(ctx, W, H, stationId, hits);
  else drawHomeView(ctx, W, H, state, hits);
  return { hits };
}

/**
 * UV 交互坐标拾取。
 * @param {number} u
 * @param {number} v
 * @param {number} W
 * @param {number} H
 * @param {Array} hits
 */
export function pickFormulaBoard(u, v, W, H, hits) {
  if (!hits?.length || u == null || v == null) return null;
  const candidates = [
    [u * W, (1 - v) * H],
    [u * W, v * H],
    [(1 - u) * W, (1 - v) * H],
  ];
  for (const [px, py] of candidates) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
        return h;
      }
    }
  }
  return null;
}

