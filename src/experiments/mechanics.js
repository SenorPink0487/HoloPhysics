/** Six source-authored mechanics experiments adapted to the host manager/UI. */
import { labFrameScheduler } from '../frameBudget.js';

const COMMON_STEPS = [
  { id: 'configure', text: '调节实验参数并重置装置', hint: '在前方全息屏拖动参数滑轨' },
  { id: 'observe', text: '运行仿真，观察装置运动与实时读数', hint: '可暂停、继续或重新开始' },
  { id: 'compare', text: '比较实测值与理论值，检查物理关系', hint: '读数与轨迹来自同一源仿真状态' },
];

const range = (key, label, min, max, step, unit = '', digits = 2) => ({
  kind: 'range', key, label, min, max, step, unit, digits,
});
const select = (key, label, options) => ({ kind: 'select', key, label, options });

export const station = {
  id: 'mechanics',
  title: '力学实验台',
  accent: '#0ea5e9',
  experiments: [
    {
      id: 'free-fall',
      name: '自由落体',
      goal: '比较不同质量小球的下落时间，验证真空中加速度与质量无关',
      theory: 'a = g；t = √(2h/g)；v = √(2gh)（自由落体）',
      defaults: { height: 5.5, massA: 1, massB: 5, g: 9.81 },
      controls: [
        range('height', '释放高度 h', 2.5, 7, 0.5, 'm', 1),
        range('massA', '蓝球质量 m₁', 0.5, 10, 0.5, 'kg', 1),
        range('massB', '红球质量 m₂', 0.5, 10, 0.5, 'kg', 1),
        range('g', '重力 g', 1.6, 20, 0.1, 'm/s²', 1),
      ],
      steps: COMMON_STEPS,
    },
    {
      id: 'inclined-plane',
      name: '斜面运动',
      goal: '调节倾角与摩擦因数，观察下滑加速度和临界角',
      theory: 'a = g(sinθ − μ cosθ)；θ_c = arctan μ',
      defaults: { angleDeg: 30, mu: 0.12, mass: 2, length: 8, g: 9.81 },
      controls: [
        range('angleDeg', '倾角 θ', 5, 50, 1, '°', 0),
        range('mu', '动摩擦因数 μ', 0, 0.8, 0.01, '', 2),
        range('mass', '木块质量 m', 0.5, 8, 0.5, 'kg', 1),
      ],
      steps: COMMON_STEPS,
    },
    {
      id: 'pendulum',
      name: '单摆实验',
      goal: '观察非线性阻尼单摆并比较小角周期与大角修正',
      theory: '小角近似 T = 2π√(l/g)；运动方程 α = −(g/l)sinθ',
      defaults: { length: 1.6, angleDeg: 35, mass: 0.8, g: 9.81, damping: 0.08 },
      controls: [
        range('length', '摆长 L', 0.6, 2.4, 0.05, 'm', 2),
        range('angleDeg', '初始摆角 θ₀', 3, 70, 1, '°', 0),
        range('mass', '摆球质量 m', 0.2, 3, 0.1, 'kg', 1),
        range('damping', '空气阻尼 c', 0, 0.4, 0.01, '', 2),
      ],
      steps: COMMON_STEPS,
    },
    {
      id: 'collision',
      name: '碰撞与动能',
      goal: '在气垫导轨上检验一维碰撞的动量守恒、动能变化和恢复系数',
      theory: 'm₁v₁ + m₂v₂ = m₁v₁′ + m₂v₂′；e = (v₂′−v₁′)/(v₁−v₂)',
      defaults: { m1: 3, m2: 1.5, v1: 3.5, e: 1, mode: 'elastic' },
      controls: [
        select('mode', '碰撞类型', [
          { value: 'elastic', label: '完全弹性' },
          { value: 'inelastic', label: '非弹性 e=0.4' },
          { value: 'sticky', label: '近完全非弹性' },
          { value: 'exchange', label: '等质量速度交换' },
        ]),
        range('m1', '入射球质量 m₁', 0.5, 8, 0.5, 'kg', 1),
        range('m2', '靶球质量 m₂', 0.5, 8, 0.5, 'kg', 1),
        range('v1', '入射初速度 v₁', 1, 7, 0.5, 'm/s', 1),
        range('e', '恢复系数 e', 0, 1, 0.05, '', 2),
      ],
      steps: COMMON_STEPS,
    },
    {
      id: 'projectile',
      name: '抛体运动',
      goal: '观察理论轨迹、频闪采样与速度分量，比较射高、射程和飞行时间',
      theory: 'x = v₀ cosθ · t，y = v₀ sinθ · t − (1/2)gt²',
      defaults: { v0: 10, angleDeg: 42, g: 9.81, h0: 1.2, assist: 'strobe' },
      controls: [
        range('v0', '初速度 v₀', 4, 18, 0.5, 'm/s', 1),
        range('angleDeg', '仰角 θ', 10, 80, 1, '°', 0),
        range('h0', '发射高度 h₀', 0.5, 3.5, 0.1, 'm', 1),
        range('g', '重力 g', 1.6, 15, 0.1, 'm/s²', 1),
        select('assist', '辅助显示', [
          { value: 'strobe', label: '等时采样点' },
          { value: 'complement', label: '互补角轨迹' },
          { value: 'components', label: '分运动' },
          { value: 'none', label: '仅理论曲线' },
        ]),
      ],
      steps: COMMON_STEPS,
    },
    {
      id: 'viscosity',
      name: '落球法测粘滞系数',
      goal: '用光电门测量钢球终端速度，并用 Stokes 定律与管壁修正求 η',
      theory: 'η = 2r²(ρ−ρ₀)g / [9v(1+2.4r/R)]；v=S/Δt',
      defaults: {
        liquid: 'glycerin', diameterMm: 2.5, temperature: 20,
        tubeDiameterMm: 50, measureS: 0.2, timeScale: 6, _placedBallMm: null,
      },
      controls: [
        select('liquid', '待测液体', [
          { value: 'glycerin', label: '甘油' },
          { value: 'castor', label: '蓖麻油' },
          { value: 'silicone', label: '硅油' },
          { value: 'machine', label: '机油' },
        ]),
        range('temperature', '温度 t', 10, 40, 1, '°C', 0),
        range('diameterMm', '钢球直径 d', 1, 5, 0.1, 'mm', 1),
        range('tubeDiameterMm', '量筒内径 D', 30, 80, 1, 'mm', 0),
        range('measureS', '光电门间距 S', 0.1, 0.3, 0.01, 'm', 2),
        range('timeScale', '仿真加速', 1, 12, 1, '×', 0),
      ],
      actions: [
        { id: 'drop', label: '释放钢球' },
        { id: 'returnBtn', label: '放回球盒' },
        { id: 'record', label: '记录数据' },
        { id: 'clear', label: '清空记录' },
      ],
      steps: [
        { id: 'liquid', text: '选择液体与温度', hint: '先设置液体、温度和量筒参数' },
        { id: 'ball', text: '从钢球盒取球', hint: '抓住钢球拖到漏斗；全息屏也可选直径' },
        { id: 'rig', text: '确认量筒与光电门间距 S', hint: '检查 D 与 S 的设置' },
        { id: 'drop', text: '释放钢球并计时', hint: '钢球通过两道光电门后自动计算速度' },
        { id: 'compute', text: '计算粘滞系数 η', hint: '对比测量值和理论值' },
        { id: 'record', text: '记录多组数据并求平均', hint: '更换球径重复测量' },
      ],
    },
  ],
};

function getDefinition(id) {
  return station.experiments.find((experiment) => experiment.id === id);
}

export function createHandlers(ctx) {
  const { state, equipment, toast, pushHud, currentStep } = ctx;
  let manipulation = null;
  let lastHudAt = -Infinity;
  let lastSignature = '';

  function mergeSnapshot(snapshot, forceHud = false) {
    if (!snapshot) return;
    Object.assign(state.data, snapshot);
    if (state.expId === 'viscosity' && snapshot.workflowStep >= 0) {
      state.stepIndex = Math.min(getDefinition(state.expId).steps.length - 1, snapshot.workflowStep);
    } else if (Number(snapshot.sourceTime) > 0.55) {
      state.stepIndex = Math.max(state.stepIndex, 1);
    }
    // Cheap signature — avoid JSON.stringify of params every physics frame.
    // Live hologram repaints are expensive and were hitching camera look-around.
    // Quantize readout values so tiny float chatter does not thrash the canvas.
    const readoutSig = Array.isArray(snapshot.readouts)
      ? snapshot.readouts.map((row) => {
        const v = String(row.value || '');
        // Keep first number-ish chunk at modest precision for the signature only.
        const m = v.match(/-?\d+(?:\.\d+)?/);
        if (!m) return v;
        const n = Number(m[0]);
        return Number.isFinite(n) ? n.toFixed(1) : v;
      }).join('·')
      : '';
    if (snapshot.params?._records) {
      state.data.records = snapshot.params._records;
    }
    const signature = [
      state.stepIndex,
      snapshot.paused ? 1 : 0,
      state.data.recordsPanelOpen ? 1 : 0,
      Array.isArray(snapshot.params?._records) ? snapshot.params._records.length : 0,
      // quantize time so HUD does not thrash every fixed step (~2 Hz)
      Math.floor(Number(snapshot.sourceTime || 0) * 2),
      readoutSig,
    ].join('|');
    const now = performance.now();
    // Prefer ~2 HUD paints/sec while sim runs; forceHud always wins.
    if (forceHud || signature !== lastSignature) {
      if (forceHud || now - lastHudAt > 450) {
        lastSignature = signature;
        lastHudAt = now;
        pushHud();
      }
    }
  }

  function initData(expId) {
    manipulation = null;
    const definition = getDefinition(expId);
    return {
      params: { ...(definition?.defaults || {}) },
      readouts: [],
      records: [],
      recordsPanelOpen: false,
      formula: '',
      paused: false,
      sourceTime: 0,
      workflowStep: -1,
    };
  }

  function applyVisualDefaults(expId) {
    const definition = getDefinition(expId);
    const defaults = { ...(definition?.defaults || {}) };
    // O(1) setMode mount and synchronous soft reset matching prewarm state.
    equipment.mechanics?.setMode?.(expId, defaults, { reset: false, snapshot: false });
    const snapshot = equipment.mechanics?.reset?.(expId, defaults);
    mergeSnapshot(snapshot, false);
  }

  function onUiAction(action, payload = {}) {
    const expId = state.expId;
    if (action === 'viscosity-records-panel' || action === 'mechanics-records-panel') {
      state.data.recordsPanelOpen = payload.open !== undefined ? !!payload.open : !state.data.recordsPanelOpen;
      pushHud();
      return true;
    }
    if (action === 'mechanics-source-set') {
      const snapshot = equipment.mechanics?.setParam?.(expId, payload.key, payload.value);
      mergeSnapshot(snapshot, true);
      toast('参数已更新，源装置已按新条件重置');
      return true;
    }
    if (action === 'mechanics-source-select') {
      const snapshot = equipment.mechanics?.setParam?.(expId, payload.key, payload.value);
      mergeSnapshot(snapshot, true);
      return true;
    }
    if (action === 'mechanics-source-reset') {
      const snapshot = equipment.mechanics?.reset?.(expId, state.data.params);
      state.stepIndex = 0;
      state.data.recordsPanelOpen = false;
      mergeSnapshot(snapshot, true);
      toast('实验已重置');
      return true;
    }
    if (action === 'mechanics-source-pause') {
      const paused = !state.data.paused;
      equipment.mechanics?.setPaused?.(expId, paused);
      state.data.paused = paused;
      pushHud();
      toast(paused ? '仿真已暂停' : '仿真已继续');
      return true;
    }
    if (action === 'mechanics-source-action') {
      const ok = equipment.mechanics?.action?.(expId, payload.id);
      mergeSnapshot(equipment.mechanics?.snapshot?.(expId), true);
      if (!ok) toast('当前状态下暂不能执行该操作');
      return true;
    }
    return false;
  }

  function interact(target) {
    if (target?.userData?.role !== 'mechanics_source') return false;
    return onUiAction('mechanics-source-pause');
  }

  function beginManipulation(target, context = {}) {
    const role = target?.userData?.role;
    if (state.expId === 'viscosity' && role === 'mechanics_viscosity_ball') {
      const diameterMm = Number(target.userData.diameterMm || state.data.params?.diameterMm || 2.5);
      const ok = equipment.mechanics?.beginBallDrag?.(diameterMm, context);
      if (ok) {
        manipulation = { kind: 'viscosityBall', target, diameterMm };
        toast('按住鼠标拖动钢球至量筒漏斗口，松开释放');
      }
      return !!ok;
    }
    if (role === 'mechanics_source') {
      manipulation = { kind: 'tap', target, time: context.time || 0 };
      return true;
    }
    return false;
  }

  function updateManipulation(_target, context = {}) {
    if (!manipulation) return false;
    if (manipulation.kind === 'viscosityBall') {
      equipment.mechanics?.updateBallDrag?.(context.totalX || 0, context.totalY || 0, context);
      mergeSnapshot(equipment.mechanics?.snapshot?.('viscosity'));
    }
    return true;
  }

  function endManipulation(target, context = {}) {
    if (!manipulation) return false;
    const active = manipulation;
    manipulation = null;
    if (active.kind === 'viscosityBall') {
      equipment.mechanics?.endBallDrag?.(!!context.cancelled, context);
      mergeSnapshot(equipment.mechanics?.snapshot?.('viscosity'), true);
      return true;
    }
    if (active.kind === 'tap' && !context.dragged && !context.cancelled) return interact(target || active.target);
    return true;
  }

  function update(_t, dt) {
    // Cap mechanics dt so a long frame does not spiral cannon substeps.
    const stepDt = Math.min(Number(dt) || 0, 0.05);
    const snapshot = equipment.mechanics?.updateSource?.(state.expId, stepDt);
    mergeSnapshot(snapshot);
    return state.data;
  }

  function cleanup() {
    manipulation = null;
    equipment.mechanics?.setMode?.(null);
  }

  return {
    initData,
    applyVisualDefaults,
    interact,
    beginManipulation,
    updateManipulation,
    endManipulation,
    onUiAction,
    onKey: () => false,
    onWheel: () => false,
    holdInteract: () => {},
    update,
    cleanup,
    currentStep,
  };
}
