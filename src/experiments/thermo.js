/**
 * Thermodynamics station migrated from reli-source.
 *
 * The source project contains five standalone experiments.  This module keeps
 * their physical state and equations in the host experiment manager while the
 * station scene is only responsible for rendering the apparatus.
 *
 * Heavy integrate (mix clock, 1D conduction FD, ideal-gas / convection particles)
 * runs through ExperimentSimBackend (main | worker | auto) — latest-complete-wins.
 */

import { labFrameScheduler } from '../frameBudget.js';
import {
  createSimBackend,
  SIM_KIND,
  PARTICLE_STRIDE_POS_VEL,
  PARTICLE_STRIDE_POS_VEL_TEMP,
  preferredWorkerSlot,
} from '../runtime/threading/simBackend.js';

const C_WATER = 4180;
const R_GAS = 8.314;

/** Host convection paints fewer particles than the full source demo (1800). */
const CONVECTION_SIM_COUNT = 1800;

/** Map host expId → pure sim kind (null = no off-thread compute). */
function simKindForExp(expId) {
  if (expId === 'calorimetry') return SIM_KIND.CALORIMETRY_MIX;
  if (expId === 'heat-conduction') return SIM_KIND.HEAT_CONDUCTION;
  if (expId === 'ideal-gas') return SIM_KIND.IDEAL_GAS;
  if (expId === 'convection') return SIM_KIND.CONVECTION;
  return null;
}
const MATERIALS = Object.freeze({
  aluminum: { label: '铝', alpha: 23.1e-6 },
  copper: { label: '铜', alpha: 16.5e-6 },
  steel: { label: '钢', alpha: 12.0e-6 },
  invar: { label: '殷钢', alpha: 1.2e-6 },
});

export const station = {
  id: 'thermo',
  title: '热力学实验台',
  accent: '#fb923c',
  experiments: [
    {
      id: 'calorimetry',
      name: '混合量热',
      goal: '拖动热、冷水烧杯到量热杯，观察混合平衡温度',
      theory: 'Q = cmΔt；热平衡时 Q放 = Q吸',
      steps: [
        { id: 'pour_hot', text: '将热水烧杯倒入量热杯', hint: '瞄准红色烧杯点击，或点击“倒入热水”' },
        { id: 'pour_cold', text: '将冷水烧杯倒入量热杯', hint: '再倒入蓝色烧杯，混合后温度自动趋于平衡' },
        { id: 'equilibrate', text: '等待热平衡并读取终温', hint: '观察量热杯温度和理论平衡温度' },
        { id: 'record', text: '写入数据并比较多组', hint: '点击「写入数据」保存 m、T 与 Tₑq；改参数后再写一组做对比' },
      ],
    },
    {
      id: 'convection',
      name: '自然对流',
      goal: '改变热板温度，观察封闭腔体内的浮力驱动流动',
      theory: '对流换热 Q = hAΔt；温差越大，对流越强',
      steps: [
        { id: 'set_plate', text: '设置热板与环境温度', hint: '拖动温度滑块，建立温差' },
        { id: 'observe', text: '观察热羽流和回流', hint: '开启“流动”后，粒子颜色表示温度' },
        { id: 'record', text: '写入 Ra / h / Q 到数据表', hint: '不同 ΔT 各写一组，对照换热量如何变化' },
      ],
    },
    {
      id: 'heat-conduction',
      name: '热传导',
      goal: '比较导热系数对温度场和热流密度的影响',
      theory: 'Q/t ∝ kA(ΔT/Δx)；稳态时棒上温度沿长度近似线性分布',
      steps: [
        { id: 'set_boundary', text: '设置热端、冷端和导热系数', hint: '拖动三个参数滑块' },
        { id: 'observe', text: '观察试样管内温度梯度', hint: '开启采集后等待温度场趋于稳定' },
        { id: 'record', text: '写入 k 与热流密度到数据表', hint: '改变 k 后写入，比较中点温度与 q' },
      ],
    },
    {
      id: 'ideal-gas',
      name: '理想气体定律',
      goal: '移动活塞并调节温度，验证 PV = nRT',
      theory: 'pV = nRT；分子平均动能与热力学温度 T 成正比',
      steps: [
        { id: 'set_volume', text: '改变活塞位置（体积）', hint: '拖动体积滑块，观察活塞和压强' },
        { id: 'set_temperature', text: '改变气体温度', hint: '温度越高，分子运动越快' },
        { id: 'record', text: '写入 P–T–V 对照点', hint: '各条件写一组，看 P 随 T 升、随 V 降' },
      ],
    },
    {
      id: 'thermal-expansion',
      name: '固体热膨胀',
      goal: '加热金属棒并比较不同材料的线膨胀系数',
      theory: 'Δl = α l₀ Δt；l = l₀(1 + αΔt)',
      steps: [
        { id: 'set_material', text: '选择试样材料和初始长度', hint: '选择铝、铜、钢或殷钢' },
        { id: 'heat', text: '升高试样温度', hint: '观察自由端相对零点的位移' },
        { id: 'record', text: '写入 ΔL 与 α 到数据表', hint: '换材料或温度后写入，比较膨胀量' },
      ],
    },
  ],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));

function initData(expId) {
  const table = {
    tableScrollTop: 0,
    tableScrollAuto: true,
    records: [],
    completed: false,
    recordsPanelOpen: false,
  };
  if (expId === 'calorimetry') {
    return {
      tHot: 80, tCold: 20, mHot: 200, mCold: 200,
      cupHot: false, cupCold: false, pouring: null, pourPhase: 'idle', pourProgress: 0,
      mixProgress: 0, tCurrent: null,
      ...table,
    };
  }
  if (expId === 'convection') {
    return { tPlate: 650, tAir: 300, area: 0.12, running: true, elapsed: 0, ...table };
  }
  if (expId === 'heat-conduction') {
    const temps = new Float32Array(48).fill(300);
    temps[0] = 700;
    temps[47] = 280;
    return { tHot: 700, tCold: 280, conductivity: 1.2, running: true, temps, ...table };
  }
  if (expId === 'ideal-gas') {
    return {
      temperature: 300, volume: 1.0, n: 0.04,
      collisions: 0, collisionWindow: 0, collisionsPerSec: 0, ...table,
    };
  }
  if (expId === 'thermal-expansion') {
    return { temperature: 80, length0: 1.0, material: 'aluminum', ...table };
  }
  return {};
}

/**
 * Numeric metrics for HUD / data table. Prefer this over ad-hoc canvas formulas.
 * @returns {Record<string, number|string|null|boolean>}
 */
export function computeThermoMetrics(expId, d = {}) {
  if (expId === 'calorimetry') {
    const mh = d.cupHot ? Number(d.mHot || 0) : 0;
    const mc = d.cupCold ? Number(d.mCold || 0) : 0;
    const teq = mh + mc > 0
      ? (mh * Number(d.tHot || 0) + mc * Number(d.tCold || 0)) / (mh + mc)
      : null;
    const tNow = d.tCurrent == null ? null : Number(d.tCurrent);
    const qHot = teq == null || tNow == null
      ? null
      : (mh / 1000) * C_WATER * (Number(d.tHot || 0) - tNow) / 1000;
    const err = teq == null || tNow == null ? null : Math.abs(tNow - teq);
    return {
      mHot: Number(d.mHot || 0),
      mCold: Number(d.mCold || 0),
      tHot: Number(d.tHot || 0),
      tCold: Number(d.tCold || 0),
      tNow,
      teq,
      qHot,
      err,
      mixPct: Math.round(Number(d.mixProgress || 0) * 100),
      poured: !!(d.cupHot && d.cupCold),
      balanced: !!(d.cupHot && d.cupCold && Number(d.mixProgress || 0) >= 0.96),
    };
  }
  if (expId === 'convection') {
    const deltaT = Math.max(0, Number(d.tPlate || 0) - Number(d.tAir || 0));
    const area = Number(d.area || 0.12);
    const L = Math.sqrt(Math.max(1e-6, area));
    const ra = 1e8 * deltaT * L ** 3;
    const nu = 0.15 * Math.pow(Math.max(ra, 1), 1 / 3);
    const h = deltaT < 1 ? 2 : Math.max(3, (nu * 0.028) / L);
    const q = h * area * deltaT;
    return {
      tPlate: Number(d.tPlate || 0),
      tAir: Number(d.tAir || 0),
      area,
      deltaT,
      ra,
      nu,
      h,
      q,
      running: d.running !== false,
    };
  }
  if (expId === 'heat-conduction') {
    const temps = d.temps;
    const n = temps?.length || 48;
    const mid = Number(temps?.[Math.floor(n / 2)] ?? 0);
    const tHot = Number(d.tHot || 0);
    const tCold = Number(d.tCold || 0);
    const k = Number(d.conductivity || 0);
    const deltaT = tHot - tCold;
    const heatFlux = k * Math.abs(deltaT) * 85;
    let err = 0;
    if (temps?.length) {
      for (let i = 0; i < temps.length; i += 1) {
        const linear = tHot + (tCold - tHot) * (i / (temps.length - 1));
        err += Math.abs(temps[i] - linear);
      }
    }
    const steadyPct = temps?.length
      ? Math.max(0, 100 - (err / temps.length / Math.max(1, Math.abs(deltaT))) * 100)
      : 0;
    return {
      tHot, tCold, k, mid, deltaT, heatFlux, steadyPct, running: d.running !== false,
    };
  }
  if (expId === 'ideal-gas') {
    const T = Number(d.temperature || 0);
    const V = Number(d.volume || 1);
    const n = Number(d.n || 0.04);
    // Host demo scale factor (matches existing apparatus readout).
    const pressure = ((n * R_GAS * T) / Math.max(1e-6, V) / 1000) * 12;
    const avgSpeed = Math.sqrt(Math.max(0, T) / 300) * 480;
    const collisions = Number(d.collisionsPerSec || 0);
    return { T, V, n, pressure, avgSpeed, collisions };
  }
  if (expId === 'thermal-expansion') {
    const mat = MATERIALS[d.material] || MATERIALS.aluminum;
    const T = Number(d.temperature || 20);
    const L0 = Number(d.length0 || 1);
    const deltaL = mat.alpha * L0 * (T - 20);
    const length = L0 + deltaL;
    const strain = L0 > 0 ? deltaL / L0 : 0;
    return {
      material: d.material || 'aluminum',
      materialLabel: mat.label,
      alpha: mat.alpha,
      T,
      L0,
      deltaL,
      length,
      strain,
    };
  }
  return {};
}

/** Column headers + value extractors for the measurement log table. */
export function thermoRecordColumns(expId) {
  if (expId === 'calorimetry') {
    return [
      { key: 'idx', label: '#', width: 0.06 },
      { key: 'mh', label: 'mₕ/g', width: 0.12 },
      { key: 'Th', label: 'Tₕ/°C', width: 0.12 },
      { key: 'mc', label: 'm𝚌/g', width: 0.12 },
      { key: 'Tc', label: 'T𝚌/°C', width: 0.12 },
      { key: 'Teq', label: 'Tₑq', width: 0.14 },
      { key: 'Tnow', label: 'T测', width: 0.14 },
      { key: 'dT', label: '|ΔT|', width: 0.14 },
    ];
  }
  if (expId === 'convection') {
    return [
      { key: 'idx', label: '#', width: 0.06 },
      { key: 'Tp', label: 'T板/K', width: 0.12 },
      { key: 'Ta', label: 'T气/K', width: 0.12 },
      { key: 'dT', label: 'ΔT', width: 0.1 },
      { key: 'A', label: 'A/m²', width: 0.12 },
      { key: 'Ra', label: 'Ra', width: 0.14 },
      { key: 'h', label: 'h', width: 0.12 },
      { key: 'Q', label: 'Q/W', width: 0.14 },
    ];
  }
  if (expId === 'heat-conduction') {
    return [
      { key: 'idx', label: '#', width: 0.06 },
      { key: 'Th', label: 'T热/K', width: 0.14 },
      { key: 'Tc', label: 'T冷/K', width: 0.14 },
      { key: 'k', label: 'k', width: 0.12 },
      { key: 'Tmid', label: 'T中', width: 0.14 },
      { key: 'q', label: 'q', width: 0.16 },
      { key: 'ss', label: '稳态%', width: 0.14 },
    ];
  }
  if (expId === 'ideal-gas') {
    return [
      { key: 'idx', label: '#', width: 0.06 },
      { key: 'T', label: 'T/K', width: 0.12 },
      { key: 'V', label: 'V/×', width: 0.12 },
      { key: 'P', label: 'P/kPa', width: 0.14 },
      { key: 'n', label: 'n/mol', width: 0.12 },
      { key: 'v', label: 'v̄', width: 0.14 },
      { key: 'coll', label: '碰撞/Hz', width: 0.16 },
    ];
  }
  if (expId === 'thermal-expansion') {
    return [
      { key: 'idx', label: '#', width: 0.06 },
      { key: 'mat', label: '材料', width: 0.12 },
      { key: 'T', label: 'T/°C', width: 0.12 },
      { key: 'L0', label: 'L₀/mm', width: 0.14 },
      { key: 'dL', label: 'ΔL/mm', width: 0.16 },
      { key: 'alpha', label: 'α×10⁶', width: 0.14 },
      { key: 'eps', label: '应变×10³', width: 0.16 },
    ];
  }
  return [{ key: 'idx', label: '#', width: 1 }];
}

export function formatThermoRecordCell(expId, row, key, index = 0) {
  if (key === 'idx') return String(index + 1);
  const m = row?.metrics || row || {};
  if (expId === 'calorimetry') {
    if (key === 'mh') return Number(m.mHot ?? row.mHot ?? 0).toFixed(0);
    if (key === 'Th') return Number(m.tHot ?? row.tHot ?? 0).toFixed(0);
    if (key === 'mc') return Number(m.mCold ?? row.mCold ?? 0).toFixed(0);
    if (key === 'Tc') return Number(m.tCold ?? row.tCold ?? 0).toFixed(0);
    if (key === 'Teq') return m.teq == null ? '—' : Number(m.teq).toFixed(1);
    if (key === 'Tnow') return m.tNow == null ? '—' : Number(m.tNow).toFixed(1);
    if (key === 'dT') return m.err == null ? '—' : Number(m.err).toFixed(2);
  }
  if (expId === 'convection') {
    if (key === 'Tp') return Number(m.tPlate ?? 0).toFixed(0);
    if (key === 'Ta') return Number(m.tAir ?? 0).toFixed(0);
    if (key === 'dT') return Number(m.deltaT ?? 0).toFixed(0);
    if (key === 'A') return Number(m.area ?? 0).toFixed(2);
    if (key === 'Ra') {
      const ra = Number(m.ra ?? 0);
      return ra >= 1e6 ? `${(ra / 1e6).toFixed(2)}e6` : ra.toFixed(0);
    }
    if (key === 'h') return Number(m.h ?? 0).toFixed(1);
    if (key === 'Q') return Number(m.q ?? 0).toFixed(1);
  }
  if (expId === 'heat-conduction') {
    if (key === 'Th') return Number(m.tHot ?? 0).toFixed(0);
    if (key === 'Tc') return Number(m.tCold ?? 0).toFixed(0);
    if (key === 'k') return Number(m.k ?? 0).toFixed(2);
    if (key === 'Tmid') return Number(m.mid ?? 0).toFixed(1);
    if (key === 'q') return Number(m.heatFlux ?? 0).toFixed(0);
    if (key === 'ss') return Number(m.steadyPct ?? 0).toFixed(0);
  }
  if (expId === 'ideal-gas') {
    if (key === 'T') return Number(m.T ?? 0).toFixed(0);
    if (key === 'V') return Number(m.V ?? 0).toFixed(2);
    if (key === 'P') return Number(m.pressure ?? 0).toFixed(1);
    if (key === 'n') return Number(m.n ?? 0).toFixed(3);
    if (key === 'v') return String(Math.round(Number(m.avgSpeed ?? 0)));
    if (key === 'coll') return String(Math.round(Number(m.collisions ?? 0)));
  }
  if (expId === 'thermal-expansion') {
    if (key === 'mat') return m.materialLabel || m.material || '—';
    if (key === 'T') return Number(m.T ?? 0).toFixed(0);
    if (key === 'L0') return (Number(m.L0 ?? 0) * 1000).toFixed(0);
    if (key === 'dL') return (Number(m.deltaL ?? 0) * 1000).toFixed(3);
    if (key === 'alpha') return (Number(m.alpha ?? 0) * 1e6).toFixed(1);
    if (key === 'eps') return (Number(m.strain ?? 0) * 1000).toFixed(3);
  }
  return '—';
}

export function buildThermoRecordRow(expId, d) {
  const metrics = computeThermoMetrics(expId, d);
  return {
    expId,
    t: Date.now(),
    metrics,
    // Keep a few flat fields for older readouts / toasts.
    ...sourceReadoutsFromMetrics(expId, metrics, d),
  };
}

function sourceReadoutsFromMetrics(expId, m, d) {
  if (expId === 'calorimetry') {
    return {
      tNow: m.tNow == null ? '—' : m.tNow.toFixed(1),
      tEq: m.teq == null ? '—' : m.teq.toFixed(1),
      qTransfer: m.qHot == null ? '—' : m.qHot.toFixed(2),
      progress: String(m.mixPct ?? 0),
      records: d.records?.length || 0,
    };
  }
  if (expId === 'convection') {
    return {
      deltaT: m.deltaT.toFixed(0),
      h: m.h.toFixed(1),
      q: m.q.toFixed(1),
      ra: m.ra >= 1e6 ? `${(m.ra / 1e6).toFixed(2)}e6` : m.ra.toFixed(0),
      nu: m.nu.toFixed(1),
      records: d.records?.length || 0,
    };
  }
  if (expId === 'heat-conduction') {
    return {
      tMid: m.mid.toFixed(1),
      heatFlux: m.heatFlux.toFixed(0),
      deltaT: m.deltaT.toFixed(0),
      progress: m.steadyPct.toFixed(0),
      records: d.records?.length || 0,
    };
  }
  if (expId === 'ideal-gas') {
    return {
      pressure: m.pressure.toFixed(1),
      n: m.n.toFixed(3),
      avgSpeed: String(Math.round(m.avgSpeed)),
      collisions: String(Math.round(m.collisions)),
      records: d.records?.length || 0,
    };
  }
  if (expId === 'thermal-expansion') {
    return {
      deltaL: (m.deltaL * 1000).toFixed(3),
      length: (m.length * 1000).toFixed(2),
      alpha: (m.alpha * 1e6).toFixed(1),
      strain: (m.strain * 1000).toFixed(3),
      records: d.records?.length || 0,
    };
  }
  return {};
}

/** Whether the current state is meaningful to log. */
export function thermoCanRecord(expId, d) {
  if (expId === 'calorimetry') {
    return !!(d?.cupHot && d?.cupCold && Number(d?.mixProgress || 0) >= 0.5);
  }
  return true;
}

/** Short caption: what “写入数据表” means for this experiment. */
export function thermoRecordCaption(expId) {
  if (expId === 'calorimetry') {
    return '写入当前 m、T 条件与测得终温 / 理论 Tₑq，用于对照热平衡。';
  }
  if (expId === 'convection') {
    return '写入 ΔT、面积与导出的 Ra、Nu、h、换热量 Q，便于比较温差对流强度。';
  }
  if (expId === 'heat-conduction') {
    return '写入两端温度、k、中点温度与热流密度 q，比较不同 k 的梯度。';
  }
  if (expId === 'ideal-gas') {
    return '写入 T、V、P、平均速率与碰撞率，验证 P 随 T/V 的变化趋势。';
  }
  if (expId === 'thermal-expansion') {
    return '写入材料、温度、ΔL 与 α，比较不同金属的线膨胀。';
  }
  return '写入当前参数与计算量到下方对照表。';
}

export function thermoRecordBlockedReason(expId, d) {
  if (expId === 'calorimetry') {
    if (!d?.cupHot || !d?.cupCold) return '请先倒入热水和冷水，待混合后再写入。';
    if (Number(d?.mixProgress || 0) < 0.5) return '混合尚未过半，请等待温度接近平衡。';
  }
  return '';
}

function sourceReadouts(expId, d) {
  return sourceReadoutsFromMetrics(expId, computeThermoMetrics(expId, d), d);
}

export function createHandlers(ctx) {
  const { state, equipment, toast, pushHud, advanceStep, setStep, currentStep } = ctx;
  let liveHudAccumulator = 0;
  /** Last time we painted the HUD during a continuous slider drag (ms). */
  let liveSliderHudAt = -Infinity;
  /** Active ExperimentSimBackend for the current compute-heavy exp (or null). */
  let simBackend = null;
  let simBackendExpId = null;
  /** Last applied sim generation (skip redundant host writes). */
  let lastAppliedGeneration = -1;

  function disposeSimBackend() {
    try {
      simBackend?.dispose?.();
    } catch { /* ignore */ }
    simBackend = null;
    simBackendExpId = null;
    lastAppliedGeneration = -1;
  }

  /**
   * Build initial options for a pure sim kind from host data.
   * @param {string} expId
   * @param {object} d
   */
  function simOptionsFromData(expId, d) {
    if (expId === 'calorimetry') {
      return {
        mixProgress: Number(d.mixProgress) || 0,
        tCurrent: d.tCurrent == null ? Number(d.tCold) || 20 : Number(d.tCurrent),
        mHot: Number(d.mHot) || 200,
        mCold: Number(d.mCold) || 200,
        tHot: Number(d.tHot) || 80,
        tCold: Number(d.tCold) || 20,
        cupHot: !!d.cupHot,
        cupCold: !!d.cupCold,
        pouring: !!d.pouring,
      };
    }
    if (expId === 'heat-conduction') {
      const temps = d.temps instanceof Float32Array
        ? d.temps
        : Float32Array.from(d.temps || []);
      return {
        segments: temps.length || 48,
        temps,
        tHot: Number(d.tHot) || 700,
        tCold: Number(d.tCold) || 280,
        conductivity: Number(d.conductivity) || 1.2,
        running: d.running !== false,
      };
    }
    if (expId === 'ideal-gas') {
      return {
        count: 200,
        temperature: Number(d.temperature) || 300,
        volume: Number(d.volume) || 1,
        chamberR: 0.9,
        floorY: 0.22,
        baseH: 1.35,
      };
    }
    if (expId === 'convection') {
      return {
        count: CONVECTION_SIM_COUNT,
        tPlate: Number(d.tPlate) || 650,
        tAir: Number(d.tAir) || 300,
        area: Number(d.area) || 0.12,
        running: d.running !== false,
        chamberW: 2.2,
        chamberD: 1.25,
        airBot: 0.38,
        airTop: 2.43,
        plateY: 0.28,
      };
    }
    return {};
  }

  /**
   * Ensure a SimBackend matches the active experiment. Recreates on exp change.
   * @param {string} expId
   * @param {object} d
   */
  function ensureSimBackend(expId, d) {
    const kind = simKindForExp(expId);
    if (!kind || !d) {
      if (simBackend) disposeSimBackend();
      return null;
    }
    if (simBackend && simBackendExpId === expId) return simBackend;
    disposeSimBackend();
    try {
      simBackend = createSimBackend({
        kind,
        // Default auto → worker when available (same policy as physics).
        // Tests / debug: globalThis.__SIM_BACKEND_MODE__ = 'main'
        // Convection / ideal-gas prefer slot 1 (secondary continuous particles).
        workerSlot: preferredWorkerSlot(kind),
        options: simOptionsFromData(expId, d),
      });
      simBackendExpId = expId;
      lastAppliedGeneration = -1;
      if (expId === 'ideal-gas') {
        const exp = equipment.thermo?.sourceExperiments?.['ideal-gas'];
        if (exp) exp._hostParticlesOwned = true;
      }
      if (expId === 'convection') {
        const exp = equipment.thermo?.sourceExperiments?.convection;
        if (exp) exp._hostParticlesOwned = true;
      }
      if (expId === 'heat-conduction') {
        const exp = equipment.thermo?.sourceExperiments?.['heat-conduction'];
        if (exp) exp._hostFieldOwned = true;
      }
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.warn('[thermo] SimBackend init failed', error);
      }
      simBackend = null;
      simBackendExpId = null;
    }
    return simBackend;
  }

  /** Push host params into the running kind (cheap command post). */
  function syncSimParams(d = state.data) {
    if (!simBackend || !d || simBackendExpId !== state.expId) return;
    const expId = state.expId;
    if (expId === 'calorimetry') {
      simBackend.command('setParams', {
        mHot: d.mHot,
        mCold: d.mCold,
        tHot: d.tHot,
        tCold: d.tCold,
        cupHot: !!d.cupHot,
        cupCold: !!d.cupCold,
        pouring: !!d.pouring,
        mixProgress: d.mixProgress,
        tCurrent: d.tCurrent,
      });
    } else if (expId === 'heat-conduction') {
      simBackend.command('setParams', {
        tHot: d.tHot,
        tCold: d.tCold,
        conductivity: d.conductivity,
        running: d.running,
      });
    } else if (expId === 'ideal-gas') {
      simBackend.command('setParams', {
        temperature: d.temperature,
        volume: d.volume,
      });
    } else if (expId === 'convection') {
      simBackend.command('setParams', {
        tPlate: d.tPlate,
        tAir: d.tAir,
        area: d.area,
        running: d.running,
      });
    }
  }

  /**
   * Apply latest-complete snapshot onto host data (+ ideal-gas source particles).
   * @param {object} snap
   * @param {object} d
   * @returns {{ mixJustCompleted: boolean }}
   */
  function applySimSnapshot(snap, d) {
    const out = { mixJustCompleted: false };
    if (!snap || !d || snap.skipped) return out;
    const gen = snap.generation | 0;
    // Always allow first apply; then only when generation advanced (even = complete).
    if (gen === lastAppliedGeneration && gen !== 0) return out;
    if (gen > 0 && (gen & 1) === 1) return out; // odd = write in flight
    lastAppliedGeneration = gen;

    const expId = state.expId;
    const s = snap.scalars || {};

    if (expId === 'calorimetry') {
      if (s.mixProgress != null) d.mixProgress = Number(s.mixProgress);
      if (s.tCurrent != null) d.tCurrent = Number(s.tCurrent);
      out.mixJustCompleted = !!s.mixJustCompleted;
      return out;
    }

    if (expId === 'heat-conduction') {
      const field = snap.fields?.temps;
      if (field?.length) {
        if (d.temps instanceof Float32Array && d.temps.length === field.length) {
          d.temps.set(field);
        } else {
          d.temps = field instanceof Float32Array ? field : Float32Array.from(field);
        }
      }
      return out;
    }

    if (expId === 'ideal-gas') {
      if (Number.isFinite(s.collisionsPerSec)) {
        d.collisionsPerSec = s.collisionsPerSec;
      }
      const particles = snap.particles;
      if (particles?.length) {
        const exp = equipment.thermo?.sourceExperiments?.['ideal-gas'];
        if (exp) {
          exp._hostParticlesOwned = true;
          const stride = (s.particleStride | 0) || PARTICLE_STRIDE_POS_VEL;
          const count = Math.min(
            exp.particles?.length || 0,
            Math.floor(particles.length / stride),
          );
          for (let i = 0; i < count; i += 1) {
            const o = i * stride;
            const p = exp.particles[i];
            if (!p?.pos || !p?.vel) continue;
            p.pos.set(particles[o], particles[o + 1], particles[o + 2]);
            p.vel.set(particles[o + 3], particles[o + 4], particles[o + 5]);
          }
          if (Number.isFinite(s.collisionsPerSec)) {
            exp.collisionsPerSec = s.collisionsPerSec;
          }
        }
      }
      return out;
    }

    if (expId === 'convection') {
      // Prefer pure-kind metrics when present (matches computeThermoMetrics).
      if (Number.isFinite(s.deltaT)) d._simDeltaT = s.deltaT;
      if (Number.isFinite(s.h)) d._simH = s.h;
      if (Number.isFinite(s.q)) d._simQ = s.q;
      if (Number.isFinite(s.ra)) d._simRa = s.ra;
      if (Number.isFinite(s.nu)) d._simNu = s.nu;
      const particles = snap.particles;
      if (particles?.length) {
        const exp = equipment.thermo?.sourceExperiments?.convection;
        if (exp?.particles?.length) {
          exp._hostParticlesOwned = true;
          const stride = (s.particleStride | 0) || PARTICLE_STRIDE_POS_VEL_TEMP;
          const count = Math.min(
            exp.particles.length,
            Math.floor(particles.length / stride),
          );
          for (let i = 0; i < count; i += 1) {
            const o = i * stride;
            const p = exp.particles[i];
            if (!p) continue;
            p.x = particles[o];
            p.y = particles[o + 1];
            p.z = particles[o + 2];
            p.vx = particles[o + 3];
            p.vy = particles[o + 4];
            p.vz = particles[o + 5];
            if (stride >= 7) p.temp = particles[o + 6];
          }
          // Hide unused source particles when host sim runs a reduced count.
          for (let i = count; i < exp.particles.length; i += 1) {
            const p = exp.particles[i];
            if (!p) continue;
            p.y = -10;
            p.temp = Number(d.tAir) || 300;
            p.vx = 0;
            p.vy = 0;
            p.vz = 0;
          }
        }
      }
    }
    return out;
  }

  function applyVisualDefaults(expId) {
    // O(1) mount only on this pulse. Soft-sync later; never hard-reset on open
    // (hard reset was multi-frame particle thrash). cleanup() still hard-resets.
    equipment.thermo?.setMode?.(expId);
    state.data._awaitThermoReset = null;
    // Spin up pure sim for mix / conduction / ideal-gas as soon as the exp opens.
    if (state.data) ensureSimBackend(expId, state.data);
    labFrameScheduler.schedule(`thermo:reset:${expId}`, () => {
      if (!state.running || state.expId !== expId || !state.data) return;
      try {
        const d = state.data;
        ensureSimBackend(expId, d);
        // Soft-sync host defaults onto the already-built source rig.
        // forceVisual:false when signature likely matches boot seed.
        if (expId === 'thermal-expansion') {
          const src = equipment.thermo?.sourceExperiments?.['thermal-expansion'];
          if (src?.params && d) {
            src.params.temperature = d.temperature;
            src.params.length0 = d.length0;
            src.params.material = d.material;
            src._applyMaterialLook?.();
            src._updateGeometry?.(true);
          }
          equipment.thermo?.updateState?.(expId, d, { forceVisual: false });
        } else {
          // forceVisual only if params diverged; boot seed matches defaults.
          equipment.thermo?.updateState?.(expId, d, { forceVisual: false });
        }
      } catch { /* ignore */ }
    }, { priority: 35, soft: false });
  }

  /**
   * Quantize continuous slider values so tiny float jitter does not thrash
   * 3D onParamChange / HUD redraws while the user is still dragging.
   */
  function quantizeThermoValue(key, value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return value;
    if (key === 'area' || key === 'volume' || key === 'length0' || key === 'conductivity') {
      return Math.round(v * 100) / 100;
    }
    // Temperature / mass style controls are displayed with 0 decimals.
    return Math.round(v);
  }

  function setValue(key, value, opts = {}) {
    const d = state.data;
    if (!d || !Object.prototype.hasOwnProperty.call(d, key)) return false;
    const live = opts.live === true;
    // Material is discrete; running is boolean — never quantize those.
    const next = (key === 'material' || key === 'running')
      ? value
      : quantizeThermoValue(key, value);

    if (state.expId === 'convection') {
      if (key === 'tPlate') d.tPlate = clamp(next, 300, 900);
      else if (key === 'tAir') d.tAir = clamp(next, 250, 350);
      else if (key === 'area') d.area = clamp(next, 0.05, 0.25);
      else if (key === 'running') d.running = !!next;
      else return false;
    } else if (state.expId === 'heat-conduction') {
      if (key === 'tHot') d.tHot = clamp(next, 200, 900);
      else if (key === 'tCold') d.tCold = clamp(next, 200, 900);
      else if (key === 'conductivity') d.conductivity = clamp(next, 0.15, 3.5);
      else if (key === 'running') d.running = !!next;
      else return false;
    } else if (state.expId === 'ideal-gas') {
      if (key === 'temperature') d.temperature = clamp(next, 150, 600);
      else if (key === 'volume') d.volume = clamp(next, 0.4, 1.25);
      else return false;
    } else if (state.expId === 'thermal-expansion') {
      if (key === 'temperature') d.temperature = clamp(next, 20, 400);
      else if (key === 'length0') d.length0 = clamp(next, 0.6, 1.4);
      else if (key === 'material' && MATERIALS[next]) d.material = next;
      else return false;
    } else if (state.expId === 'calorimetry') {
      if (key === 'tHot') d.tHot = clamp(next, 40, 95);
      else if (key === 'tCold') d.tCold = clamp(next, 5, 40);
      else if (key === 'mHot') d.mHot = clamp(next, 50, 400);
      else if (key === 'mCold') d.mCold = clamp(next, 50, 400);
      else return false;
    } else {
      return false;
    }

    // Skip redundant 3D/HUD work when the quantized value did not change.
    if (live && d._lastThermoKey === key && d._lastThermoValue === d[key]) {
      return true;
    }
    d._lastThermoKey = key;
    d._lastThermoValue = d[key];

    // Keep pure sim params in lockstep with host data (command is cheap).
    ensureSimBackend(state.expId, d);
    syncSimParams(d);

    equipment.thermo?.updateState?.(state.expId, d, { live });

    if (!live) {
      liveSliderHudAt = -Infinity;
      pushHud();
      return true;
    }

    // Continuous drag: keep the 3D rig live, but do not repaint the full
    // hologram canvas on every pointermove (that was the main hitch source).
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - liveSliderHudAt >= 90) {
      liveSliderHudAt = now;
      pushHud();
    }
    return true;
  }

  function pour(kind) {
    const d = state.data;
    const key = kind === 'hot' ? 'cupHot' : 'cupCold';
    if (d[key]) return false;
    if (equipment.thermo?.pour && equipment.thermo.pour(kind) === false) return false;
    d[key] = true;
    d.tCurrent = d.cupHot ? d.tHot : d.tCold;
    d.pouring = kind;
    d.pourPhase = 'approach';
    d.pourProgress = 0;
    ensureSimBackend(state.expId, d);
    syncSimParams(d);
    toast(kind === 'hot' ? '热水已倒入量热杯' : '冷水已倒入量热杯');
    pushHud();
    return true;
  }

  function record() {
    const d = state.data;
    const expId = state.expId;
    if (!thermoCanRecord(expId, d)) {
      toast(thermoRecordBlockedReason(expId, d) || '当前状态尚不可记录');
      return false;
    }
    const row = buildThermoRecordRow(expId, d);
    d.records = [...(d.records || []), row].slice(-24);
    d.tableScrollAuto = true;
    // Do not auto-open the records panel — user opens it via「数据表」.
    d.completed = d.records.length >= 1;
    // Advance to the "record" step when the experiment defines one.
    const steps = station.experiments.find((e) => e.id === expId)?.steps || [];
    if (steps.some((s) => s.id === 'record')) setStep('record');
    const n = d.records.length;
    const summary = thermoRecordColumns(expId)
      .filter((c) => c.key !== 'idx')
      .slice(0, 3)
      .map((c) => `${c.label}=${formatThermoRecordCell(expId, row, c.key, n - 1)}`)
      .join(' · ');
    toast(`已写入第 ${n} 组：${summary}`);
    pushHud();
    return true;
  }

  function clearRecords() {
    const d = state.data;
    if (!d) return false;
    d.records = [];
    d.completed = false;
    d.tableScrollTop = 0;
    d.tableScrollAuto = true;
    toast('已清空数据表');
    pushHud();
    return true;
  }

  function interact(target, _t, step) {
    const role = target?.userData?.role;
    if (state.expId === 'calorimetry') {
      if (role === 'thermo_hot_beaker' || step.id === 'pour_hot' && (role === 'thermo_calorimeter' || role === 'ui_action')) return pour('hot');
      if (role === 'thermo_cold_beaker' || step.id === 'pour_cold' && (role === 'thermo_calorimeter' || role === 'ui_action')) return pour('cold');
    }
    if (role === 'ui_action' || role === 'generic') {
      if (step.id === 'record') return record();
      if (step.id === 'pour_hot') return pour('hot');
      if (step.id === 'pour_cold') return pour('cold');
      if (step.id === 'observe' || step.id === 'heat' || step.id === 'set_temperature' || step.id === 'set_volume' || step.id === 'set_boundary' || step.id === 'set_plate' || step.id === 'set_material') {
        advanceStep();
        pushHud();
        return true;
      }
    }
    return false;
  }

  function onUiAction(action, payload = {}) {
    if (!state.running) return false;
    if (action === 'thermo-set') {
      return setValue(payload.key, payload.value, { live: payload.live === true });
    }
    if (action === 'thermo-toggle') return setValue(payload.key, !state.data[payload.key]);
    if (action === 'thermo-pour-hot') return pour('hot');
    if (action === 'thermo-pour-cold') return pour('cold');
    if (action === 'thermo-record') return record();
    if (action === 'thermo-clear-records') return clearRecords();
    if (action === 'thermo-records-panel') {
      const d = state.data;
      if (!d) return false;
      if (payload.open === true) d.recordsPanelOpen = true;
      else if (payload.open === false) d.recordsPanelOpen = false;
      else d.recordsPanelOpen = !d.recordsPanelOpen;
      pushHud();
      return true;
    }
    if (action === 'thermo-reset') {
      state.data = initData(state.expId);
      // Reset the source apparatus as well as the controller data.  The
      // source calorimetry rig owns the actual cup liquid meshes/fill levels;
      // merely replacing state.data would leave poured water visible.
      disposeSimBackend();
      equipment.thermo?.reset?.(state.expId);
      equipment.thermo?.setMode?.(state.expId);
      ensureSimBackend(state.expId, state.data);
      equipment.thermo?.updateState?.(state.expId, state.data);
      liveHudAccumulator = 0;
      liveSliderHudAt = -Infinity;
      pushHud();
      return true;
    }
    return false;
  }

  function onKey(code) {
    if (code === 'KeyR') return onUiAction('thermo-reset');
    if (code !== 'KeyE') return false;
    const step = currentStep();
    return interact({ userData: { role: 'ui_action' } }, 0, step);
  }

  function beginManipulation(target) {
    const role = target?.userData?.role;
    if (role === 'thermo_hot_beaker' || role === 'thermo_cold_beaker') {
      state.data.dragging = role;
      return true;
    }
    return false;
  }

  function endManipulation() {
    const role = state.data?.dragging;
    state.data.dragging = null;
    if (role === 'thermo_hot_beaker') return pour('hot');
    if (role === 'thermo_cold_beaker') return pour('cold');
    return false;
  }

  // The host loop calls holdInteract every animation frame while pointer/AR
  // input is held.  Beakers commit on release, so the hold path only keeps the
  // armed role alive and deliberately does not change the physical state.
  function holdInteract(holding) {
    if (!holding && state.data?.dragging) endManipulation();
  }

  function update(_t, dt) {
    const d = state.data;
    if (!d) return d;
    state._dt = dt;
    liveHudAccumulator += dt;
    const sliding = !!d._uiSlider;
    let mixCompletedThisFrame = false;
    if (state.expId === 'calorimetry') {
      const pourState = equipment.thermo?.getPourState?.();
      if (d.pouring && pourState?.active) {
        d.pourPhase = pourState.phase;
        const phaseDur = { approach: 0.35, pouring: 0.9, return: 0.4 };
        const phaseStart = pourState.phase === 'approach' ? 0 : pourState.phase === 'pouring' ? 0.35 : 1.25;
        d.pourProgress = Math.min(1, (phaseStart + Math.min(phaseDur[pourState.phase] || 0.4, pourState.t)) / 1.65);
      } else if (d.pouring && !pourState?.active) {
        d.pourProgress = 1;
        d.pourPhase = 'idle';
        d.pouring = null;
        // Pour finished — unlock mix clock on the sim backend.
        syncSimParams(d);
        if (d.cupHot && d.cupCold) setStep('equilibrate');
        else if (d.cupHot) setStep('pour_cold');
        else setStep('pour_hot');
      }
    }

    // Heavy integrate via ExperimentSimBackend (main or worker).
    // latest-complete-wins: worker may return deferred + previous snapshot.
    if (simKindForExp(state.expId)) {
      const backend = ensureSimBackend(state.expId, d);
      if (backend) {
        const prevMix = Number(d.mixProgress) || 0;
        // Keep cup/pour flags fresh every frame (pour animation is source-owned).
        if (state.expId === 'calorimetry') {
          backend.command('setParams', {
            cupHot: !!d.cupHot,
            cupCold: !!d.cupCold,
            pouring: !!d.pouring,
          });
        }
        const snap = backend.step(dt);
        const applied = applySimSnapshot(snap, d);
        // Worker path: also pull any completed snapshot that arrived after last step.
        if (snap?.deferred || snap?.skipped) {
          applySimSnapshot(backend.getSnapshot?.() || snap, d);
        }
        // Edge-detect mix completion even if worker skipped the one-shot flag.
        mixCompletedThisFrame = applied.mixJustCompleted
          || (state.expId === 'calorimetry' && prevMix < 1 && Number(d.mixProgress) >= 1);
        if (
          state.expId === 'calorimetry'
          && d.mixProgress > 0.96
          && currentStep()?.id === 'equilibrate'
        ) {
          setStep('record');
        }
      }
    }

    if (state.expId === 'convection') d.elapsed += Math.min(dt, 0.05);

    // While a content-screen slider is held, setValue already pushed params;
    // only re-sync for time-evolving experiments (mix / conduction / gas).
    if (
      !sliding
      || state.expId === 'calorimetry'
      || state.expId === 'heat-conduction'
      || state.expId === 'ideal-gas'
      || state.expId === 'convection'
    ) {
      equipment.thermo?.updateState?.(state.expId, d, { live: sliding });
    }
    const liveCalorimetry = state.expId === 'calorimetry'
      && (d.pouring || (d.cupHot && d.cupCold && d.mixProgress < 1));
    if (mixCompletedThisFrame) {
      // The live-update condition intentionally stops at 1.0; explicitly
      // publish the terminal frame so the HUD cannot remain visually at 99%.
      liveHudAccumulator = 0;
      pushHud();
    } else if (sliding) {
      // Final paint is owned by clearUiSlider; keep a low-rate live readout.
      if (liveHudAccumulator >= 0.1) {
        liveHudAccumulator = 0;
        pushHud();
      }
    } else if (liveCalorimetry && liveHudAccumulator >= 0.05) {
      liveHudAccumulator = 0;
      pushHud();
    }
    return d;
  }

  function cleanup(_expId, session = state) {
    if (session?.data) session.data._awaitThermoReset = null;
    disposeSimBackend();
    // Park apparatus and hard-reset the active source so a half-poured mix /
    // mid-flight particle field cannot leak into the next open.
    const eid = session?.expId || state.expId;
    try {
      if (eid) equipment.thermo?.reset?.(eid);
    } catch { /* ignore */ }
    equipment.thermo?.setMode?.(null);
  }

  return { initData, applyVisualDefaults, interact, onUiAction, onKey, beginManipulation, updateManipulation: () => false, endManipulation, holdInteract, update, cleanup, sourceReadouts };
}

export { MATERIALS, sourceReadouts };
