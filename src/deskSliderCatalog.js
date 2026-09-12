/**
 * Desk slider specs per experiment — values read from live experiment data.
 * Returned actions match content-screen / manager slider contracts.
 */

function range(key, label, min, max, {
  unit = '',
  digits = 2,
  step = null,
  buttonDelta = null,
  hasButtons = null,
  setAction,
  action = 'param-slider',
  target = null,
  axis = null,
} = {}) {
  return {
    kind: 'range',
    key,
    label,
    min,
    max,
    unit,
    digits,
    step,
    buttonDelta,
    hasButtons: hasButtons ?? (buttonDelta != null),
    setAction,
    action,
    target,
    axis,
  };
}

/** Discrete one-shot control on the desk panel (not a continuous track). */
function actionBtn(label, action, { key = null } = {}) {
  return {
    kind: 'action',
    key: key || action,
    label,
    action,
    setAction: null,
  };
}

/** Multi-button row on the desk panel (e.g. [感应·B] [动生·x] [播放变化]). */
function actionGroup(buttons = [], { key = null } = {}) {
  return {
    kind: 'actionGroup',
    key: key || (buttons[0] && buttons[0].action) || 'group',
    buttons,
    setAction: null,
  };
}


function inducedSpecs(d) {
  const isAuto = d?.auto === true;
  return [
    actionGroup([
      {
        label: isAuto ? '停止' : '自动变化',
        action: 'induced-e-mode',
        payload: { auto: !isAuto },
        active: isAuto,
      },
    ]),
    range('R', '半径 R', 0.8, 3.0, { unit: 'm', setAction: 'induced-e-set', action: 'induced-e-slider' }),
    range('dBdt', 'dB/dt', -6.25, 6.25, { unit: 'T/s', setAction: 'induced-e-set', action: 'induced-e-slider' }),
  ];
}

function electricSpecs(d) {
  // Position is 3D-drag only — no x/y/z desk sliders.
  const charges = Array.isArray(d?.charges) ? d.charges : [];
  const selected = charges.find((c) => c.id === d?.selectedId) || null;
  const out = [];
  const currentShape = d?.gaussShape || 'sphere';
  if (Boolean(d?.showGauss)) {
    out.push(
      actionGroup([
        { label: '球形', action: 'electric-gauss-shape', payload: { shape: 'sphere' }, shape: 'sphere', active: currentShape === 'sphere' },
        { label: '正方体', action: 'electric-gauss-shape', payload: { shape: 'cube' }, shape: 'cube', active: currentShape === 'cube' },
        { label: '圆柱体', action: 'electric-gauss-shape', payload: { shape: 'cylinder' }, shape: 'cylinder', active: currentShape === 'cylinder' },
        { label: '不规则', action: 'electric-gauss-shape', payload: { shape: 'irregular' }, shape: 'irregular', active: currentShape === 'irregular' },
      ], { key: 'gaussShape' }),
      range('radius', '高斯面缩放', 1.2, 4.2, { setAction: 'electric-set' }),
    );
  }
  if (selected) {
    const subDigits = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
    const idx = (d.charges || []).findIndex((c) => c.id === selected.id) + 1;
    const subStr = idx > 0 ? String(idx).split('').map((c) => subDigits[c] || c).join('') : '';
    const qLabel = subStr ? `|q${subStr}|/μC` : '|q|/μC';
    out.push(
      range('q', qLabel, 0.2, 3, { digits: 1, setAction: 'electric-set' }),
    );
  }
  out.push(
    range('q0', '|q₀|/μC', 0.2, 3, { digits: 1, setAction: 'electric-set', target: 'probe' }),
  );
  return out;
}

function hallSpecs(d) {
  const target = d?.target === 'helmholtz' ? 'helmholtz' : 'solenoid';
  return [
    range('Im', '励磁电流 Im', 0, 1, { unit: 'A', step: 0.01, buttonDelta: 0.01, setAction: 'hall-set' }),
    range('Is', '霍尔电流 Is', 0, 0.010, { unit: 'A', digits: 3, step: 0.0005, buttonDelta: 0.001, setAction: 'hall-set' }),
    target === 'helmholtz'
      ? range('probePos', '探头 X', -0.25, 0.25, { unit: 'm', digits: 3, step: 0.01, buttonDelta: 0.005, setAction: 'hall-set' })
      : range('probePos', '探杆刻度 X', 1, 31, { unit: 'cm', digits: 1, step: 0.5, buttonDelta: 1, setAction: 'hall-set' }),
    target === 'helmholtz'
      ? range('rightCoilPos', '右线圈位置', 0.02, 0.155, { unit: 'm', digits: 3, step: 0.01, buttonDelta: 0.005, setAction: 'hall-set' })
      : range('turns', '螺线管匝数 N', 10, 5000, { unit: '匝', digits: 0, step: 10, buttonDelta: 100, setAction: 'hall-set' }),
    // Primary capture control lives on the bench panel next to the apparatus.
    actionBtn('记录当前读数', 'hall-record'),
  ];
}

/**
 * @returns {{ title: string, specs: object[] }}
 */
export function getDeskSliderConfig(stationId, expId, data = {}, experiment = null) {
  if (!stationId || !expId) return { title: '参数调节', specs: [] };
  const d = data || {};

  if (stationId === 'electro') {
    if (expId === 'faraday_induction') {
      const channelX = d.animChannel === 'x';
      const animating = !!d.pendingAnim;
      const targetChanged = channelX
        ? (d.lastMotion && Math.abs(d.lastMotion.x1 - (d.targetX ?? d.x)) > 1e-4)
        : (d.lastInduction && Math.abs(d.lastInduction.B1 - (d.targetB ?? d.B)) > 1e-4);
      const hasPlayed = channelX ? !!(d.lastMotion && !targetChanged) : !!(d.lastInduction && !targetChanged);
      const playLabel = animating ? '停止' : (hasPlayed ? '重复变化' : '自动演示');

      return {
        title: '法拉第电磁感应',
        specs: [
          actionGroup([
            { label: '动生', action: 'faraday-channel', payload: { channel: 'x' }, active: channelX },
            { label: '感生', action: 'faraday-channel', payload: { channel: 'B' }, active: !channelX },
          ]),
          channelX
            ? range('targetX', '目标 x', 1.2, 8, { unit: 'm', setAction: 'faraday-set' })
            : range('targetB', '目标 B', -3, 3, { unit: 'T', setAction: 'faraday-set' }),
          range('animDuration', '时长 Δt', 0.3, 6, { unit: 's', setAction: 'faraday-set' }),
          actionGroup([
            { label: playLabel, action: animating ? 'faraday-stop' : 'faraday-play', active: animating },
            { label: '反向变化', action: 'faraday-reverse' },
          ]),
          range('B', '实时 B', -3, 3, { unit: 'T', setAction: 'faraday-set' }),
          range('x', '实时 x', 1.2, 8, { unit: 'm', setAction: 'faraday-set' }),
        ],
      };
    }
    if (expId === 'induced_electric_field') {
      return { title: '感生电场 · 参数', specs: inducedSpecs(d) };
    }
    if (expId === 'electric_field') {
      return { title: '静电场 · 电荷量', specs: electricSpecs(d) };
    }
    if (expId === 'hall_effect') {
      return { title: '霍尔测磁 · 控制', specs: hallSpecs(d) };
    }
    if (expId === 'hall_carrier_demo') {
      return {
        title: '霍尔原理 · 参数',
        specs: [
          range('I', '电流 I', 0, 2, { unit: 'A', setAction: 'hall-demo-set' }),
          range('B', '磁场 B', -2, 2, { unit: 'T', setAction: 'hall-demo-set' }),
          range('n', '浓度 n', 0.3, 2.5, { unit: 'm⁻³', setAction: 'hall-demo-set' }),
          range('d', '厚度 d', 0.1, 1.2, { unit: 'm', setAction: 'hall-demo-set' }),
        ],
      };
    }
  }

  return { title: '参数调节', specs: [] };
}

/** Read live value for a desk slider spec from experiment data. */
export function readDeskSliderValue(spec, data = {}, experiment = null) {
  if (!spec || spec.kind === 'action' || spec.kind === 'actionGroup') return null;
  const d = data || {};
  const key = spec.key;

  if (key === 'targetX') return Number(d.targetX ?? d.x ?? 4.5);
  if (key === 'targetB') return Number(d.targetB ?? 1.5);
  if (key === 'animDuration') return Number(d.animDuration ?? 1.5);

  if (spec.setAction === 'electric-set' && spec.target === 'probe') {
    const probe = d.probe || {};
    if (key === 'q0') return Math.abs(Number(probe.q0 || 0));
    return Number(probe[key]);
  }
  if (spec.setAction === 'electric-set') {
    if (key === 'radius' || key === 'R') return Number(d.radius ?? 2.4);
    const charges = Array.isArray(d.charges) ? d.charges : [];
    const selected = charges.find((c) => c.id === d.selectedId);
    if (!selected) return null;
    if (key === 'q') return Math.abs(Number(selected.q || 0));
    return Number(selected[key]);
  }
  if (spec.setAction === 'gauss-set') {
    if (key === 'radius') return Number(d.radius);
    const charges = Array.isArray(d.charges) ? d.charges : [];
    const selected = charges.find((c) => c.id === d.selectedId);
    if (!selected) return null;
    if (key === 'q') return Math.abs(Number(selected.q || 0));
    return Number(selected[key]);
  }
  if (spec.setAction === 'mechanics-source-set') {
    const params = d.params || d;
    return Number(params?.[key]);
  }
  if (spec.action === 'faraday-b-slider' || key === 'B' && spec.setAction === 'faraday-b-set') {
    return Number(d.B);
  }
  return Number(d[key]);
}
