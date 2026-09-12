import * as THREE from 'three';
import { labFrameScheduler } from '../frameBudget.js';
import {
  K_COULOMB,
  EPSILON_0,
  chargeUiToCoulomb,
  coulombFieldContribution,
  coulombPotentialContribution,
} from '../physicsFormula.js';
import {
  createSimBackend,
  SIM_KIND,
  PARTICLE_STRIDE_POS_VEL,
  preferredWorkerSlot,
} from '../runtime/threading/simBackend.js';
import { openHtmlReport } from '../tauri.js';

export { K_COULOMB, EPSILON_0, chargeUiToCoulomb };

/**
 * 电磁学实验台 — 霍尔效应测磁
 *
 * 静电场 / 高斯定理采用人教版 SI 写法：
 *   E = kQ/r²，φ = kQ/r，F = qE，Φ_E = Q内/ε₀
 *   k = 9.0×10⁹ N·m²/C²；界面电荷读数单位为 μC；位置单位为 m。
 */

export const station = {
  id: 'electro',
  title: '电磁学实验台',
  accent: '#ec4899',
  experiments: [
    {
      id: 'electric_field',
      name: '静电场探索',
      goal: '拖动正负点电荷与试探电荷，观察叠加电场、受力与电势的空间分布',
      theory: 'E=F/q；E=kQ/r^2；F=qE；k=9.0\\times 10^9 N\\cdot m^2/C^2（电荷以 \\mu C 计，位置以 m 计）',
      steps: [
        {
          id: 'explore',
          text: '自由探索静电场与试探电荷',
          hint: '拖动调 X/Y；滚轮或 Shift+拖 调 Z；内容屏可锁轴；电荷量在桌侧滑条。',
        },
      ],
    },
    {
      id: 'faraday_induction',
      name: '法拉第电磁感应',
      goal: '设定 B 或铜棒位置 x 的目标值与变化时长，播放动态过程，观察磁通量变化、感应电动势与楞次定律方向。',
      theory: '\\Phi_B = BS, S = (x - x_0)L; \\varepsilon_i = n\\Delta\\Phi_B/\\Delta t（方向由楞次定律判定）',
      steps: [
        { id: 'motion', text: '设定目标 x 并播放，测量动生电动势', hint: '模式选「动生」，设目标位置与时长，点「自动演示」；也可手拖铜棒。' },
        { id: 'field', text: '设定目标 B 并播放，测量感生电动势', hint: '模式选「感生」，设目标磁场与时长，点「自动演示」；或点「反向变化」快速演示。' },
        { id: 'conclude', text: '完成法拉第定律验证', hint: '比较 \\varepsilon_i = BL\\Delta x/\\Delta t 与 \\varepsilon_i = S\\cdot\\Delta B/\\Delta t 的结果，并用楞次定律判定方向。' },
      ],
    },
    {
      id: 'induced_electric_field',
      name: '感生电场',
      goal: '手动调节 B 与 dB/dt，观察涡旋感生电场：面内 E∝r，面外 E∝1/r，方向由楞次定律判定。',
      theory: 'E\\cdot 2\\pi r = \\Delta\\Phi/\\Delta t；r\\le R 时 E=(r/2)|\\Delta B/\\Delta t|，r>R 时 E=(R^2/(2r))|\\Delta B/\\Delta t|',
      steps: [
        { id: 'observe', text: '观察圆柱形磁场区与同心涡旋 E 线', hint: '感生电场是闭合涡旋线，不是静电场的起止线。默认手动设定 B 与 dB/dt。' },
        { id: 'probe', text: '拖动试探电荷，比较面内/面外 E 的大小', hint: '面内 |E| 随 r 增大，面外随 r 减小。' },
        { id: 'lenz', text: '调节 dB/dt 或反转变化趋势，观察 E 的环绕方向', hint: '在桌右侧滑条拖 dB/dt，或点「反转 dB/dt」；需要连续交变时可开「自动振荡」。' },
        { id: 'conclude', text: '完成感生电场规律归纳', hint: '对照全息屏公式与 E–r 曲线归纳规律。' },
      ],
    },
    {
      id: 'hall_carrier_demo',
      name: '霍尔效应原理',
      goal: '观察电流、磁场、载流子浓度、样品厚度与载流子类型如何共同改变载流子的三维运动和霍尔电压极性。',
      theory: '霍尔电压 U_H = K_{\\text{IB}}\\cdot I\\cdot B ；n 型与 p 型载流子的霍尔电压极性相反（演示量为相对值）。',
      steps: [
        { id: 'observe', text: '自由调节参数并观察载流子运动', hint: '在桌右侧滑条调节 I、B、n、d，内容屏可切换 n/p 型。' },
      ],
    },
    {
      id: 'hall_effect',
      name: '霍尔效应测磁',
      goal: '调节励磁与霍尔电流，扫描探头位置并比较亥姆霍兹线圈和长螺线管的磁场分布',
      theory: 'U_H = K_H I_s B；由霍尔电压测磁感应强度 B',
      steps: [
        { id: 'identify', text: '认识器材：线圈、霍尔探头与 HCC-2 测磁仪', hint: '按 01→04 顺序瞄准 3D 器材点击确认；选对/选错均有提示' },
        { id: 'configure', text: '选择测量对象并确认电流方向', hint: '在全息屏选择亥姆霍兹线圈或长螺线管' },
        { id: 'energize', text: '设置励磁电流 Im 与霍尔电流 Is', hint: '在桌右侧滑条调节 Im / Is' },
        { id: 'scan', text: '移动探头并记录至少 3 组 B–X 数据', hint: '调节 X 后在桌面控制面板点击「记录当前读数」，系统由 VH 换算 B' },
        { id: 'compare', text: '切换测量对象，比较磁场分布', hint: '切换线圈并继续记录，观察曲线形状变化' },
        { id: 'conclude', text: '根据数据归纳霍尔电压与磁场的关系', hint: '记录多组数据并对照曲线归纳结论' },
      ],
    },
  ],
};

export function getIrregularBump(theta, phi, seed = 0) {
  const s = Number(seed || 0);
  if (!s) {
    return 1 + 0.24 * Math.sin(3 * theta) * Math.cos(4 * phi)
             + 0.15 * Math.cos(5 * theta) * Math.sin(2 * phi)
             + 0.08 * Math.sin(7 * phi);
  }
  const r1 = Math.sin(s * 12.9898 + 1.2) * 43758.5453;
  const r2 = Math.sin(s * 78.2330 + 3.4) * 43758.5453;
  const r3 = Math.sin(s * 45.1640 + 5.6) * 43758.5453;
  const r4 = Math.sin(s * 93.8190 + 7.8) * 43758.5453;
  const r5 = Math.sin(s * 27.1820 + 9.0) * 43758.5453;
  const r6 = Math.sin(s * 31.4150 + 2.4) * 43758.5453;

  const p1 = Math.abs(r1 - Math.floor(r1));
  const p2 = Math.abs(r2 - Math.floor(r2));
  const p3 = Math.abs(r3 - Math.floor(r3));
  const p4 = Math.abs(r4 - Math.floor(r4));
  const p5 = Math.abs(r5 - Math.floor(r5));
  const p6 = Math.abs(r6 - Math.floor(r6));

  const f1 = 2 + Math.floor(p1 * 4);
  const f2 = 2 + Math.floor(p2 * 4);
  const f3 = 2 + Math.floor(p3 * 4);
  const f4 = 2 + Math.floor(p4 * 4);

  const a1 = 0.12 + p1 * 0.16;
  const a2 = 0.08 + p2 * 0.14;
  const a3 = 0.05 + p3 * 0.08;

  const phase1 = p5 * Math.PI * 2;
  const phase2 = p6 * Math.PI * 2;

  return 1 + a1 * Math.sin(f1 * theta + phase1) * Math.cos(f2 * phi)
           + a2 * Math.cos(f3 * theta) * Math.sin(f4 * phi + phase2)
           + a3 * Math.sin((f1 + f3) * phi + phase1);
}

export function gaussEnclosedCharge(charges = [], radius = 2.4, shape = 'sphere', seed = 0) {
  const r = Number(radius || 2.4);
  const s = String(shape || 'sphere');
  const seedNum = Number(seed || 0);
  return charges.reduce((sum, charge) => {
    const x = Number(charge?.x || 0);
    const y = Number(charge?.y || 0);
    const z = Number(charge?.z || 0);
    let enclosed = false;

    if (s === 'cube') {
      const half = r * 0.85;
      enclosed = Math.abs(x) < half && Math.abs(y) < half && Math.abs(z) < half;
    } else if (s === 'cylinder') {
      const rho = Math.hypot(x, z);
      const halfH = r * 1.0;
      enclosed = rho < r * 0.95 && Math.abs(y) < halfH;
    } else if (s === 'irregular') {
      const dist = Math.hypot(x, y, z);
      const theta = Math.atan2(z, x);
      const phi = Math.acos(THREE.MathUtils.clamp(y / (dist || 1), -1, 1));
      const bump = getIrregularBump(theta, phi, seedNum);
      enclosed = dist < r * bump - 1e-4;
    } else {
      enclosed = Math.hypot(x, y, z) < r - 1e-4;
    }

    return enclosed ? sum + Number(charge?.q || 0) : sum;
  }, 0);
}

/** Φ_E = Q内/ε₀（Q 由界面 μC 换算为 C） */
export function gaussFlux(charges = [], radius = 2.4, epsilon0 = EPSILON_0, shape = 'sphere', seed = 0) {
  const qC = chargeUiToCoulomb(gaussEnclosedCharge(charges, radius, shape, seed));
  return qC / Number(epsilon0 || EPSILON_0);
}

/** 与 electricFieldAt 相同：E = kQ r̂ / r² */
export function gaussFieldAt(charges = [], point = {}, options = {}) {
  return electricFieldAt(charges, point, options);
}

export function gaussMeanNormalField(charges = [], radius = 2.4) {
  const r = Math.max(1e-6, Number(radius || 0));
  if (charges.length === 1) {
    const charge = charges[0];
    const distance = Math.hypot(Number(charge.x || 0), Number(charge.y || 0), Number(charge.z || 0));
    if (distance < 0.12 && distance < r && Math.abs(Number(charge.q || 0)) > 0.01) {
      // 球心点电荷：E = k|Q|/R²
      return (K_COULOMB * Math.abs(chargeUiToCoulomb(charge.q))) / (r * r);
    }
  }
  const sampleCount = 40;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let sum = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const y = 1 - (i / Math.max(sampleCount - 1, 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const field = gaussFieldAt(charges, {
      x: Math.cos(theta) * radial * r,
      y: y * r,
      z: Math.sin(theta) * radial * r,
    });
    sum += Math.hypot(field.x, field.y, field.z);
  }
  return sum / sampleCount;
}

/**
 * Local normal flux density E·n on a spherical Gaussian surface.
 * direction is any non-zero vector; n is taken as its unit vector.
 * Positive ⇒ outward flux through that patch, negative ⇒ inward.
 */
export function gaussNormalFluxDensity(charges = [], direction = {}, radius = 2.4) {
  const r = Math.max(1e-6, Number(radius || 0));
  const nx = Number(direction?.x || 0);
  const ny = Number(direction?.y || 0);
  const nz = Number(direction?.z || 0);
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-12) return 0;
  const ux = nx / nLen;
  const uy = ny / nLen;
  const uz = nz / nLen;
  const field = gaussFieldAt(charges, { x: ux * r, y: uy * r, z: uz * r });
  return field.x * ux + field.y * uy + field.z * uz;
}

/**
 * Map local E·n and cycle progress ∈ [0,1] to a radial factor r/R.
 * Outward patches travel R_in → R_out; inward patches travel R_out → R_in.
 * Returns null when the patch carries negligible flux (particle should hide).
 */
export function gaussFluxParticleRadiusNorm(density, progress, options = {}) {
  const eps = Number(options.eps ?? 1e-5);
  if (!(Math.abs(Number(density) || 0) > eps)) return null;
  const rIn = Number(options.rIn ?? 0.58);
  const rOut = Number(options.rOut ?? 1.52);
  const t = Math.min(1, Math.max(0, Number(progress) || 0));
  return Number(density) > 0
    ? rIn + (rOut - rIn) * t
    : rOut + (rIn - rOut) * t;
}

/** Advection speed for a flux tracer; stronger |E·n| streams move faster. */
export function gaussFluxParticleSpeed(density, options = {}) {
  const abs = Math.abs(Number(density) || 0);
  const ref = Number(options.refAbs ?? K_COULOMB * 1e-6); // ~9×10³ N/C
  const base = Number(options.base ?? 0.38);
  const gain = Number(options.gain ?? 0.72);
  const maxExtra = Number(options.maxExtra ?? 1.15);
  return base + Math.min(maxExtra, (abs / ref) * gain);
}

/**
 * Visual weight for a tracer (scale/opacity proxy).
 * Emphasizes the surface crossing so E·dA is readable.
 */
export function gaussFluxParticleEmphasis(density, radiusNorm, options = {}) {
  const abs = Math.abs(Number(density) || 0);
  // SI 下 |E| 约 10³ N/C 量级（1 μC、米级距离）
  const refAbs = Number(options.refAbs ?? K_COULOMB * 1e-6 * 0.15);
  const strength = 0.42 + 0.58 * Math.min(1, abs / refAbs);
  const near = Math.abs(Number(radiusNorm) - 1);
  const surfaceBoost = 0.72 + 0.38 * Math.exp(-(near * near) / Number(options.surfaceWidth || 0.07));
  return strength * surfaceBoost;
}

/**
 * 静电场强 E = Σ kQᵢ r̂ᵢ / rᵢ²（SI，N/C）
 * charges[].q 为界面 μC 读数；point 坐标单位 m。
 */
export function electricFieldAt(charges = [], point = {}, options = {}) {
  const minRadius = Math.max(1e-4, Number(options.minRadius ?? 0.04));
  const field = { x: 0, y: 0, z: 0 };
  for (const charge of charges) {
    const dx = Number(point.x || 0) - Number(charge?.x || 0);
    const dy = Number(point.y || 0) - Number(charge?.y || 0);
    const dz = Number(point.z || 0) - Number(charge?.z || 0);
    const dE = coulombFieldContribution(charge?.q, dx, dy, dz, minRadius);
    field.x += dE.x;
    field.y += dE.y;
    field.z += dE.z;
  }
  return field;
}

/** 电势 φ = Σ kQᵢ / rᵢ（V，取无穷远处为零） */
export function electricPotentialAt(charges = [], point = {}, options = {}) {
  const minRadius = Math.max(1e-4, Number(options.minRadius ?? 0.04));
  let potential = 0;
  for (const charge of charges) {
    const dx = Number(point.x || 0) - Number(charge?.x || 0);
    const dy = Number(point.y || 0) - Number(charge?.y || 0);
    const dz = Number(point.z || 0) - Number(charge?.z || 0);
    potential += coulombPotentialContribution(
      charge?.q,
      Math.hypot(dx, dy, dz),
      minRadius,
    );
  }
  return potential;
}

/** 试探电荷受力 F = qE（N）；q0 为界面 μC 读数 */
export function electricForceAt(charges = [], point = {}, q0 = 1, options = {}) {
  const field = electricFieldAt(charges, point, options);
  const q = chargeUiToCoulomb(q0);
  return { x: field.x * q, y: field.y * q, z: field.z * q };
}

export function electricSourceForceAt(charges = [], id, options = {}) {
  const source = charges.find((charge) => charge?.id === id);
  if (!source) return { x: 0, y: 0, z: 0 };
  return electricForceAt(
    charges.filter((charge) => charge?.id !== id),
    source,
    source.q,
    options,
  );
}

const HALL_MU0 = 4 * Math.PI * 1e-7;
const HALL_K = 301;
const HALL_COIL_RADIUS_M = 0.05;
const HALL_COIL_TURNS = 210;
const HALL_SOLENOID_LENGTH_M = 0.30;
const HALL_SOLENOID_RADIUS_M = 0.005;

export function hallDemoVoltage(data) {
  const carrierSign = data?.nType === false ? 1 : -1;
  const current = Number(data?.I ?? data?.i ?? data?.Is ?? 0);
  const bField = Number(data?.B ?? 0);
  const nConc = Math.max(0.3, Number(data?.n ?? 1));
  const thicknessNorm = Math.max(0.05, Number(data?.d ?? 0.5) / 0.5);
  const numerator = current * bField;
  if (numerator === 0) return 0;
  return (numerator * carrierSign) / (nConc * thicknessNorm);
}

export function hallDemoForce(data) {
  const current = Number(data?.I ?? data?.i ?? data?.Is ?? 0);
  const bField = Number(data?.B ?? 0);
  return Math.abs(current * bField);
}

// Source apparatus constants (physical coordinates, before the scene adapter's
// visual scale/offset conversion).
export const FARADAY_ROD_LENGTH = 4;
export const FARADAY_X_END = 0.25;
export const FARADAY_X_MIN = 1.2;
export const FARADAY_X_MAX = 8;
export const FARADAY_SCALE = 0.12;
export const FARADAY_OFFSET_X = -0.48;
export const FARADAY_Y = 0.08;

export function faradayArea(x, rodLength = FARADAY_ROD_LENGTH, xEnd = FARADAY_X_END) {
  return Math.max(0, Number(x || 0) - xEnd) * rodLength;
}

export function faradayFlux(B, x, rodLength = FARADAY_ROD_LENGTH, xEnd = FARADAY_X_END) {
  return Number(B || 0) * faradayArea(x, rodLength, xEnd);
}

export function faradayEmfFromDelta(dFlux, dt) {
  const duration = Math.max(1e-9, Math.abs(Number(dt || 0)));
  return -Number(dFlux || 0) / duration;
}

/** Lenz direction for a signed increase/decrease in the declared flux. */
export function faradaySense(dFluxRate) {
  const rate = Number(dFluxRate || 0);
  if (Math.abs(rate) < 1e-8) return 'none';
  return rate > 0 ? 'cw' : 'ccw';
}

export function faradaySenseLabel(sense) {
  if (sense === 'cw') return '顺时针（俯视）';
  if (sense === 'ccw') return '逆时针（俯视）';
  return '无感应电流';
}

// —— Induced electric field (Maxwell–Faraday / 感生电场) ——
// Uniform axial B confined to a cylinder of radius R. Changing B produces
// azimuthal E with |E|∝r inside and |E|∝1/r outside (normalized SI-like units).
export const INDUCED_E_R_MIN = 0.8;
export const INDUCED_E_R_MAX = 3.0;
export const INDUCED_E_PROBE_R_MAX = 4.5;
export const INDUCED_E_AMP_MAX = 2.5;
export const INDUCED_E_OMEGA_MAX = 2.5;

/**
 * |E| at radial distance r for uniform dB/dt inside radius R.
 * @param {number} r
 * @param {number} R
 * @param {number} dBdt signed dB/dt; only magnitude enters |E|
 */
export function inducedEMagnitude(r, R, dBdt) {
  const radius = Math.max(0, Number(r || 0));
  const region = Math.max(1e-6, Number(R || 0));
  const rate = Math.abs(Number(dBdt || 0));
  if (rate < 1e-12 || radius < 1e-9) return 0;
  if (radius <= region) return 0.5 * radius * rate;
  return 0.5 * (region * region / radius) * rate;
}

/**
 * Lenz sense looking down +y (scene up, independent of B sign):
 * dB_y/dt > 0 → clockwise E when viewed from +y.
 * (Do not phrase as “looking along B”: when B is negative that would reverse CW/CCW.)
 * @returns {'cw'|'ccw'|'none'}
 */
export function inducedESense(dBdt) {
  const rate = Number(dBdt || 0);
  if (Math.abs(rate) < 1e-8) return 'none';
  return rate > 0 ? 'cw' : 'ccw';
}

export function inducedESenseLabel(sense) {
  if (sense === 'cw') return '顺时针（俯视 +y）';
  if (sense === 'ccw') return '逆时针（俯视 +y）';
  return '无感生电场';
}

/**
 * Sample E–r curve points for the content-screen plot.
 * @returns {Array<{ r: number, E: number, inside: boolean }>}
 */
export function inducedEProfile(R, dBdt, samples = 48, rMax = INDUCED_E_PROBE_R_MAX) {
  const region = Math.max(1e-6, Number(R || 0));
  const maxR = Math.max(region * 1.05, Number(rMax || INDUCED_E_PROBE_R_MAX));
  const n = Math.max(8, Math.round(Number(samples) || 48));
  const points = [];
  for (let i = 0; i <= n; i += 1) {
    const r = (i / n) * maxR;
    points.push({
      r,
      E: inducedEMagnitude(r, region, dBdt),
      inside: r <= region + 1e-9,
    });
  }
  return points;
}

/**
 * Tangential unit vector in the xz plane (B along +y).
 * CW looking from +y: ê_θ = (ẑ × r̂) with right-hand? Looking from +y:
 * CCW (right-hand around +y) = (-z, 0, x)/r ; CW = (z, 0, -x)/r.
 */
export function inducedEDirection(x, z, sense) {
  if (sense === 'none') return { x: 0, y: 0, z: 0 };
  const r = Math.hypot(Number(x || 0), Number(z || 0));
  if (r < 1e-9) return { x: 0, y: 0, z: 0 };
  const sx = Number(x || 0) / r;
  const sz = Number(z || 0) / r;
  // CCW around +y (looking from +y): point (1,0,0) moves toward -z => ê = (sz, 0, -sx); CW: opposite
  if (sense === 'ccw') return { x: sz, y: 0, z: -sx };
  return { x: -sz, y: 0, z: sx };
}

export function inducedEVectorAt(point, R, dBdt) {
  const x = Number(point?.x || 0);
  const z = Number(point?.z || 0);
  const r = Math.hypot(x, z);
  const sense = inducedESense(dBdt);
  const mag = inducedEMagnitude(r, R, dBdt);
  const dir = inducedEDirection(x, z, sense);
  return { x: dir.x * mag, y: 0, z: dir.z * mag, magnitude: mag, sense, r };
}

const HALL_PART_NAMES = {
  hall_helmholtz: '亥姆霍兹线圈',
  hall_solenoid: '长螺线管',
  hall_probe: '霍尔探头与标尺',
  hall_console: 'HCC-2 测磁仪',
};
const HALL_PART_ROLES = Object.keys(HALL_PART_NAMES);
const HALL_TERMINAL_KEYS = {
  hall_terminal_solenoid: 'solenoid',
  hall_terminal_helmholtz: 'helmholtz',
  hall_terminal_output: 'output',
};
const HALL_WIRING_RULES = {
  solenoid: {
    positive: ['sol_red'],
    negative: ['sol_black'],
    label: '螺线管',
    target: 'solenoid',
    coilMode: 'solenoid',
  },
  helmholtz: {
    positive: ['hh_red'],
    negative: ['hh_black'],
    label: '亥姆霍兹线圈 (双线圈)',
    target: 'helmholtz',
    coilMode: 'both',
  },
  helmholtz_fixed: {
    positive: ['hh_fixed'],
    negative: ['hh_black'],
    label: '固定线圈 (L1)',
    target: 'helmholtz',
    coilMode: 'fixed',
  },
  helmholtz_moving: {
    positive: ['hh_red'],
    negative: ['hh_fixed'],
    label: '移动线圈 (L2)',
    target: 'helmholtz',
    coilMode: 'moving',
  },
};

export function analyzeHallWiring(wires = []) {
  const links = new Map();
  wires.forEach((pair) => {
    const [a, b] = Array.isArray(pair) ? pair : [pair?.from, pair?.to];
    if (!a || !b || a === b) return;
    links.set(a, b);
    links.set(b, a);
  });
  const redPeer = links.get('out_red') || null;
  const blackPeer = links.get('out_black') || null;
  for (const [ruleKey, rule] of Object.entries(HALL_WIRING_RULES)) {
    const direct = rule.positive.includes(redPeer) && rule.negative.includes(blackPeer);
    const reversed = rule.negative.includes(redPeer) && rule.positive.includes(blackPeer);
    if (direct || reversed) {
      return {
        energized: true,
        target: rule.target || ruleKey,
        coilMode: rule.coilMode || 'both',
        ruleKey,
        direction: reversed ? -1 : 1,
        reversed,
        status: reversed ? 'reversed' : 'forward',
        label: rule.label,
      };
    }
  }
  return {
    energized: false,
    target: null,
    coilMode: null,
    ruleKey: null,
    direction: 1,
    reversed: false,
    status: redPeer || blackPeer ? 'invalid' : 'open',
    label: '',
  };
}

/** @param {object} ctx shared manager context */
export function createHandlers(ctx) {
  const {
    state, equipment, toast, pushHud, advanceStep, setStep, currentStep,
  } = ctx;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  /** Active ExperimentSimBackend for heavy electro compute (or null). */
  let simBackend = null;
  let simBackendExpId = null;
  let lastAppliedGeneration = -1;
  /**
   * Hall carriers stay on the local equipment integrator until the first
   * particle snapshot actually arrives. Worker backends are deferred; if we
   * flip host-owned immediately, carriers freeze at spawn for several frames
   * (or forever if the worker never delivers particles).
   */
  let hallHostParticlesLive = false;

  function setHallHostParticlesOwned(owned) {
    hallHostParticlesLive = !!owned;
    try {
      equipment.electro?.setHallDemoHostParticlesOwned?.(hallHostParticlesLive);
    } catch { /* ignore */ }
  }

  function disposeSimBackend() {
    try { simBackend?.dispose?.(); } catch { /* ignore */ }
    simBackend = null;
    simBackendExpId = null;
    lastAppliedGeneration = -1;
    setHallHostParticlesOwned(false);
  }

  function simKindForExp(expId) {
    if (expId === 'electric_field') return SIM_KIND.ELECTRIC_FIELD_LINES;
    if (expId === 'gauss_theorem') return SIM_KIND.GAUSS_METRICS;
    if (expId === 'hall_carrier_demo') return SIM_KIND.HALL_CARRIERS;
    return null;
  }

  function chargePayload(charges = []) {
    return (charges || []).map((c) => ({
      q: Number(c.q) || 0,
      x: Number(c.x) || 0,
      y: Number(c.y) || 0,
      z: Number(c.z) || 0,
    }));
  }

  function ensureSimBackend(expId, d) {
    const kind = simKindForExp(expId);
    if (!kind || !d) {
      if (simBackend) disposeSimBackend();
      return null;
    }
    if (simBackend && simBackendExpId === expId) return simBackend;
    disposeSimBackend();
    try {
      let options = {};
      if (expId === 'electric_field' || expId === 'gauss_theorem') {
        options = {
          charges: chargePayload(d.charges),
          radius: Number(d.radius) || 2.4,
        };
      } else if (expId === 'hall_carrier_demo') {
        options = {
          count: 240,
          I: Number(d.I) || 1,
          B: Number(d.B) || 1,
          n: Number(d.n) || 1,
          d: Number(d.d) || 0.5,
          nType: d.nType !== false,
          paused: !!d.paused,
        };
      }
      simBackend = createSimBackend({
        kind,
        workerSlot: preferredWorkerSlot(kind),
        options,
      });
      simBackendExpId = expId;
      lastAppliedGeneration = -1;
      // Do not host-own Hall particles yet — wait for applySimSnapshot.
      if (expId === 'hall_carrier_demo') {
        setHallHostParticlesOwned(false);
      }
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.warn('[electro] SimBackend init failed', error);
      }
      simBackend = null;
      simBackendExpId = null;
      setHallHostParticlesOwned(false);
    }
    return simBackend;
  }

  function syncSimParams(d = state.data) {
    if (!simBackend || !d || simBackendExpId !== state.expId) return;
    const expId = state.expId;
    if (expId === 'electric_field' || expId === 'gauss_theorem') {
      simBackend.command('setParams', {
        charges: chargePayload(d.charges),
        radius: Number(d.radius) || 2.4,
      });
    } else if (expId === 'hall_carrier_demo') {
      simBackend.command('setParams', {
        I: d.I,
        B: d.B,
        n: d.n,
        d: d.d,
        nType: d.nType,
        paused: d.paused,
      });
    }
  }

  function applySimSnapshot(snap, d) {
    if (!snap || !d || snap.skipped) return false;
    const gen = snap.generation | 0;
    if (gen === lastAppliedGeneration) return false;
    if (gen > 0 && (gen & 1) === 1) return false;
    lastAppliedGeneration = gen;
    const s = snap.scalars || {};
    const expId = state.expId;

    if (expId === 'gauss_theorem') {
      if (Number.isFinite(s.qEnclosed)) d.qEnclosed = s.qEnclosed;
      if (Number.isFinite(s.flux)) d.flux = s.flux;
      if (Number.isFinite(s.meanField)) d.meanField = s.meanField;
      return true;
    }

    if (expId === 'electric_field') {
      const packed = snap.fields?.fieldLines;
      if (packed?.length) {
        d._simFieldLines = packed instanceof Float32Array
          ? packed
          : Float32Array.from(packed);
        // The backend result is authoritative for the parameter signature
        // submitted before the worker step. Equipment uses this to reject a
        // stale result during a drag-release transition.
        d._simFieldLinesSignature = d._simFieldSig || '';
        // Force decoration rebuild to consume host polylines.
        d._forceDecorations = true;
      }
      if (Number.isFinite(s.lineCount)) d._simLineCount = s.lineCount;
      return true;
    }

    if (expId === 'hall_carrier_demo') {
      if (Number.isFinite(s.vh)) d.vh = s.vh;
      if (Number.isFinite(s.force)) d.force = s.force;
      const particles = snap.particles;
      if (particles?.length) {
        equipment.electro?.applyHallDemoHostParticles?.(
          particles,
          (s.particleStride | 0) || PARTICLE_STRIDE_POS_VEL,
        );
        // First real particle pack → hand off integrate to the backend.
        setHallHostParticlesOwned(true);
      }
      return true;
    }
    return false;
  }

  function stepSimBackend(dt) {
    const expId = state.expId;
    if (!simKindForExp(expId) || !state.data) return;

    // Moving a source charge only needs the lightweight mesh/probe path while
    // the pointer is held. Re-tracing a multi-charge field on every movement
    // sample makes the main-thread fallback (and the worker snapshot churn)
    // compete with input and rendering. Keep the previous decoration snapshot
    // during the drag; the first post-release frame sees the new signature and
    // performs one authoritative field-line step.
    if (expId === 'electric_field' && state.data.dragging) return;

    const backend = ensureSimBackend(expId, state.data);
    if (!backend) return;

    if (expId === 'electric_field') {
      // Only re-trace when charges / visibility flags change (avoid thrash).
      const sig = `${(state.data.charges || []).map((c) => `${c.id}:${c.q}:${c.x}:${c.y}:${c.z}`).join(';')}|L${state.data.showLines !== false ? 1 : 0}|A${state.data.showArrows !== false ? 1 : 0}`;
      if (sig === state.data._simFieldSig) {
        // Pull any deferred worker snapshot that completed after last step.
        if (backend.generation !== lastAppliedGeneration) {
          applySimSnapshot(backend.getSnapshot?.(), state.data);
        }
        return;
      }
      state.data._simFieldSig = sig;
      syncSimParams(state.data);
    } else {
      syncSimParams(state.data);
    }

    const snap = backend.step(dt);
    applySimSnapshot(snap, state.data);
    if (snap?.deferred || snap?.skipped) {
      applySimSnapshot(backend.getSnapshot?.() || snap, state.data);
    }
  }

  function applyWiringState(data) {
    data.wiring = analyzeHallWiring(data.wires);
    if (data.wiring.energized) {
      data.target = data.wiring.target;
      data.direction = data.wiring.direction;
    } else {
      data.direction = 1;
    }
    return data.wiring;
  }

  function initData(expId) {
    if (expId === 'faraday_induction') {
      return {
        B: -1,
        x: 4.5,
        rodLength: FARADAY_ROD_LENGTH,
        xEnd: FARADAY_X_END,
        xMin: FARADAY_X_MIN,
        xMax: FARADAY_X_MAX,
        showField: true,
        area: faradayArea(4.5),
        flux: faradayFlux(-1, 4.5),
        currentSense: 'none',
        measureMode: null,
        // Preset-then-play: set target + duration, then animate smoothly.
        animChannel: 'B', // 'B' | 'x'
        targetB: 1.5,
        targetX: 6.5,
        animDuration: 1.5,
        pendingAnim: null,
        liveEmf: 0,
        animProgress: 0,
        /** Keep current-flow arrows visible briefly after a change ends. */
        currentLinger: 0,
        lingerSense: 'none',
        dragging: false,
        motionStart: null,
        inductionStart: null,
        pendingB: null, // legacy alias cleared; animations use pendingAnim
        sliderDragging: false,
        sliderStart: null,
        lastMotion: null,
        lastInduction: null,
        records: [],
        completed: false,
        _time: 0,
        _prevX: 4.5,
        _prevB: -1,
        _dragDirectionB: 0,
        _dragReverseDistanceB: 0,
        _hudThrottle: 0,
      };
    }
    if (expId === 'hall_effect') {
      return {
        target: 'solenoid',
        Im: 0.5,
        Is: 0.005,
        probePos: 16,
        rightCoilPos: 0.05,
        solenoidLength: 0.30,
        turns: 2340,
        direction: 1,
        zeroOffset: 0,
        wires: [],
        terminalDragFrom: null,
        terminalSnapPort: null,
        hallDragArmed: false,
        hallDragging: false,
        hallDragOffset: null,
        identified: {
          hall_helmholtz: false,
          hall_solenoid: false,
          hall_probe: false,
          hall_console: false,
        },
        vh: 0,
        records: [],
        showCurve: false,
        showFit: false,
        /** First visible row index in the data table (0 = top / oldest). */
        tableScrollTop: 0,
        /** When true, the table sticks to the newest rows after each record. */
        tableScrollAuto: true,
        /** Sub-row pixel residual for smooth trackpad / drag scrolling. */
        tableScrollPx: 0,
        completed: false,
        _hudThrottle: 0,
      };
    }
    if (expId === 'hall_carrier_demo') {
      return {
        I: 1,
        B: 1,
        n: 1,
        d: 0.5,
        nType: true,
        paused: false,
        autoCam: false,
        showB: true,
        vh: -1,
        force: 1,
      };
    }
    if (expId === 'gauss_theorem') {
      return {
        radius: 2.4,
        charges: [{ id: 1, q: 1, x: 0, y: 0, z: 0 }],
        selectedId: 1,
        nextChargeId: 2,
        showSurface: true,
        showLines: true,
        showFlux: true,
        dragArmed: false,
        dragging: false,
        completed: false,
        qEnclosed: 1,
        // Φ_E = Q/ε₀，Q = 1 μC；E = kQ/R²
        flux: chargeUiToCoulomb(1) / EPSILON_0,
        meanField: (K_COULOMB * chargeUiToCoulomb(1)) / (2.4 ** 2),
        _hudThrottle: 0,
      };
    }
    if (expId === 'electric_field') {
      const probe = { x: 2, y: 0, z: 0.8, q0: 1 };
      const charges = [{ id: 1, q: 1, x: 0, y: 0, z: 0 }];
      const field = electricFieldAt(charges, probe);
      const force = electricForceAt(charges, probe, probe.q0);
      return {
        charges,
        selectedId: 1,
        nextChargeId: 2,
        probe,
        showLines: true,
        showArrows: true,
        showEquipot: false,
        showProbe: true,
        showGauss: false,
        showAxes: false,
        gaussShape: 'sphere',
        gaussSeed: 0,
        radius: 2.4,
        qEnclosed: 1,
        flux: 1 * 1e-6 / EPSILON_0,
        meanField: 0,
        autoRotate: false,
        formulaTab: 'def',
        /**
         * Axis locks for mouse drag. true = that world axis is frozen.
         * Position is drag-only (no coordinate desk sliders).
         */
        axisLock: { x: false, y: false, z: false },
        dragging: false,
        dragTarget: null,
        dragMouseX: 0,
        dragMouseY: 0,
        dragStart: null,
        field,
        force,
        magnitudeE: Math.hypot(field.x, field.y, field.z),
        magnitudeF: Math.hypot(force.x, force.y, force.z),
        potential: electricPotentialAt(charges, probe),
        completed: false,
        _hudThrottle: 0,
      };
    }
    if (expId === 'induced_electric_field') {
      const R = 2;
      // Default: manual control (static B + dB/dt). Auto sine drive is opt-in.
      const amp = 1.2;
      const omega = 0.9;
      const phase = 0;
      const B = 1.0;
      const dBdt = 1.1;
      const probeR = 1.4;
      const probeAngle = 0.35;
      const probe = {
        x: probeR * Math.cos(probeAngle),
        y: 0,
        z: probeR * Math.sin(probeAngle),
        q0: 1,
      };
      const field = inducedEVectorAt(probe, R, dBdt);
      return {
        R,
        amp,
        omega,
        phase,
        B,
        bStart: -2.0,
        bEnd: 2.0,
        dBdt,
        auto: false,
        paused: false,
        probe,
        probeR,
        showB: true,
        showE: false,
        showParticles: true,
        showProbe: true,
        field,
        magnitudeE: field.magnitude,
        force: {
          x: field.x * probe.q0,
          y: 0,
          z: field.z * probe.q0,
        },
        sense: field.sense,
        senseLabel: inducedESenseLabel(field.sense),
        profile: inducedEProfile(R, dBdt),
        eAtBoundary: inducedEMagnitude(R, R, dBdt),
        dragging: false,
        dragMouseX: 0,
        dragMouseY: 0,
        dragStart: null,
        completed: false,
        sliderDragging: false,
        sliderKey: null,
        _time: 0,
        _hudThrottle: 0,
      };
    }
    return {};
  }

  function selectedGaussCharge(data) {
    return data.charges?.find((charge) => charge.id === data.selectedId) || null;
  }

  function syncGauss(data, refresh = true, dt = 0) {
    // Prefer SimBackend metrics when available (off-thread mean |E| sample).
    const backend = ensureSimBackend('gauss_theorem', data);
    if (backend && state.expId === 'gauss_theorem') {
      syncSimParams(data);
      const snap = backend.step(0);
      applySimSnapshot(snap, data);
      if (snap?.deferred) applySimSnapshot(backend.getSnapshot?.() || snap, data);
    }
    if (!Number.isFinite(data.qEnclosed)) {
      data.qEnclosed = gaussEnclosedCharge(data.charges, data.radius, data.gaussShape || 'sphere', data.gaussSeed || 0);
    }
    if (!Number.isFinite(data.flux)) {
      data.flux = gaussFlux(data.charges, data.radius, EPSILON_0, data.gaussShape || 'sphere', data.gaussSeed || 0);
    }
    if (!Number.isFinite(data.meanField)) {
      data.meanField = gaussMeanNormalField(data.charges, data.radius);
    }
    // Fallback if backend didn't populate yet.
    if (!simBackend || simBackendExpId !== 'gauss_theorem') {
      data.qEnclosed = gaussEnclosedCharge(data.charges, data.radius, data.gaussShape || 'sphere', data.gaussSeed || 0);
      data.flux = gaussFlux(data.charges, data.radius, EPSILON_0, data.gaussShape || 'sphere', data.gaussSeed || 0);
      data.meanField = gaussMeanNormalField(data.charges, data.radius);
    }
    equipment.electro?.updateGauss?.(data, dt);
    if (refresh) pushHud();
  }

  function selectedElectricCharge(data) {
    return data.charges?.find((charge) => charge.id === data.selectedId) || null;
  }

  /** Walk the picked mesh / parent chain for a finite charge id. */
  function resolveChargeId(target) {
    let node = target;
    while (node) {
      const id = Number(node.userData?.chargeId);
      if (Number.isFinite(id)) return id;
      node = node.parent;
    }
    return NaN;
  }

  function mouseDragDelta(data) {
    return {
      dx: Number(equipment.electro?.mouseDrag?.movementX || 0) - Number(data.dragMouseX || 0),
      dy: Number(equipment.electro?.mouseDrag?.movementY || 0) - Number(data.dragMouseY || 0),
    };
  }

  function electricAxisLock(data) {
    const lock = data?.axisLock || {};
    return {
      x: lock.x === true,
      y: lock.y === true,
      z: lock.z === true,
    };
  }

  /** Human-readable free/locked axes for toasts and HUD. */
  function electricAxisLockSummary(data) {
    const lock = electricAxisLock(data);
    const locked = ['x', 'y', 'z'].filter((a) => lock[a]).map((a) => a.toUpperCase());
    if (!locked.length) return '拖动 X/Z（水平/竖直）· Shift+拖 调 Y（深度）· 滚轮调 Z';
    if (locked.length === 3) return 'X/Y/Z 已全部锁定';
    const free = ['x', 'y', 'z'].filter((a) => !lock[a]).map((a) => a.toUpperCase());
    if (lock.z && free.includes('X') && free.includes('Y')) {
      return '已锁 Z · 屏幕拖动可自由控制 XY 平面位置';
    }
    if (lock.y && free.includes('X') && free.includes('Z')) {
      return '已锁 Y · 屏幕拖动可自由控制 XZ 平面位置';
    }
    if (lock.x && free.includes('Y') && free.includes('Z')) {
      return '已锁 X · 屏幕拖动可自由控制 YZ 平面位置';
    }
    return `已锁 ${locked.join('/')} · 可动 ${free.join('/')}`;
  }

  function electricDragWantsShiftZ(data) {
    // Prefer explicit context flag, then mouseDrag facade (desktop / pointer-lock).
    return !!(
      data?._dragShiftZ
      || equipment.electro?.mouseDrag?.shiftKey
    );
  }

  /**
   * Map screen drag → world Δ on free axes only.
   * - All 3 free: Mouse X → X, Mouse Y → Z (height), Shift + Mouse Y → Y (depth).
   * - 1 axis locked: Drag maps 2D screen movement directly onto the 2 free axes plane!
   *   (e.g., Z locked → Mouse X → X, Mouse Y → Y; drag freely on XY plane).
   * - 2 axes locked: Drag along the 1 remaining free axis.
   * Wheel (separate) nudges Z (vertical height) when free.
   */
  function electricDragOffsets(data, dx, dy) {
    const lock = electricAxisLock(data);
    const freeX = !lock.x;
    const freeY = !lock.y;
    const freeZ = !lock.z;
    const scale = 0.025;
    const shiftKey = electricDragWantsShiftZ(data);

    const camera = equipment.electro?.getCamera?.();
    let rx = 1, ry = 0, rz = 0;
    let ux = 0, uy = 0, uz = -1;
    if (camera) {
      const q = new THREE.Quaternion();
      if (typeof camera.getWorldQuaternion === 'function') camera.getWorldQuaternion(q);
      else if (camera.quaternion) q.copy(camera.quaternion);
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      rx = camRight.x; ry = camRight.y; rz = camRight.z;
      ux = -camUp.x; uy = -camUp.y; uz = -camUp.z;
    }

    let ox = (dx * rx + dy * ux) * scale;
    // Experiment Y is rendered on the scene Z axis. With the side camera,
    // scene +Z projects to screen-left, so a leftward mouse drag increases Y.
    let oy = (dx * rz + dy * uz) * scale;
    let oz = (dx * ry + dy * uy) * scale;

    const count = (freeX ? 1 : 0) + (freeY ? 1 : 0) + (freeZ ? 1 : 0);

    if (count === 3) {
      if (shiftKey) {
        oz = 0;
      } else {
        ox = dx * scale;
        oz = -dy * scale;
        oy = 0;
      }
    }

    if (count === 1) {
      const drive = Math.abs(dy) >= Math.abs(dx) ? -dy : dx;
      if (freeX) ox = drive * scale;
      // When Y is the only free experiment axis, use the camera-projected
      // component. This is essential in side view: +experiment-Y is scene +Z
      // and may be controlled by horizontal mouse movement rather than raw dy.
      if (freeY && !camera) oy = drive * scale;
      if (freeZ) oz = drive * scale;
    } else {
      if (!freeX) ox = 0;
      if (!freeY) oy = 0;
      if (!freeZ) oz = 0;
    }

    return { ox, oy, oz, freeX, freeY, freeZ, lock };
  }

  const _invMat = new THREE.Matrix4();
  const _localRay = new THREE.Ray();

  function resolveElectroApparatusRoot(mode) {
    if (!equipment.electro) return null;
    return equipment.electro.getRuntimeRoot?.(mode)
      || equipment.electro.userData?.[`${mode}Group`]
      || equipment.electro.userData?.faradayGroup
      || equipment.electro.getRoot?.()
      || equipment.electro.root
      || (equipment.electro.isObject3D ? equipment.electro : null);
  }

  /**
   * Directly map 3D crosshair/pointer ray onto the charge target plane.
   * Ensures 1:1 crosshair tracking ("指哪打哪",跟手).
   */
  function applyElectricDragRaycast(data, raycaster, context = {}) {
    if (!data?.dragStart || !raycaster?.ray) return false;
    const lock = electricAxisLock(data);
    const freeX = !lock.x;
    const freeY = !lock.y;
    const freeZ = !lock.z;
    if (!freeX && !freeY && !freeZ) return false;

    const shiftKey = electricDragWantsShiftZ(data) || !!context.shiftKey;
    const s = data.dragStart;
    const WORLD_SCALE = 0.13;

    const root = resolveElectroApparatusRoot('electric-field');
    if (root) {
      if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
      if (root.matrixWorld) {
        _invMat.copy(root.matrixWorld).invert();
        _localRay.copy(raycaster.ray).applyMatrix4(_invMat);
      } else {
        _localRay.copy(raycaster.ray);
      }
    } else {
      _localRay.copy(raycaster.ray);
    }

    const plane = new THREE.Plane();
    const hit = new THREE.Vector3();
    let hitFound = false;

    if (freeX || freeY) {
      if (!shiftKey || lock.z) {
        // Horizontal plane: Y_local = s.z * WORLD_SCALE
        const planeY = (s.z || 0) * WORLD_SCALE;
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, planeY, 0));
        if (_localRay.intersectPlane(plane, hit)) {
          hitFound = true;
        }
      } else {
        // Shift+drag: Vertical depth plane Z_local = s.y * WORLD_SCALE for height adjust
        const planeZ = (s.y || 0) * WORLD_SCALE;
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, planeZ));
        if (_localRay.intersectPlane(plane, hit)) {
          hitFound = true;
        }
      }
    } else if (freeZ) {
      const planeZ = (s.y || 0) * WORLD_SCALE;
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, planeZ));
      if (_localRay.intersectPlane(plane, hit)) {
        hitFound = true;
      }
    }

    if (!hitFound) return false;

    const targetObj = data.dragTarget === 'probe' ? data.probe : selectedElectricCharge(data);
    if (!targetObj) return false;

    const lo = data.dragTarget === 'probe' ? -5 : -4.5;
    const hi = data.dragTarget === 'probe' ? 5 : 4.5;

    if (freeX) targetObj.x = clamp(hit.x / WORLD_SCALE, lo, hi);
    if (freeY) {
      if (!shiftKey || lock.z) {
        // Experiment Y is rendered as local/world +Z. Preserve that sign so
        // the charge follows the crosshair on the side-view Y axis.
        targetObj.y = clamp(hit.z / WORLD_SCALE, lo, hi);
      }
    }
    if (freeZ) {
      if (shiftKey || (!freeX && !freeY)) {
        targetObj.z = clamp(hit.y / WORLD_SCALE, lo, hi);
      }
    }
    data.dragging = true;
    data._aimPoint = { x: hit.x, y: hit.y, z: hit.z };
    data._aimVisible = true;
    return true;
  }

  function applyGaussDragRaycast(data, raycaster) {
    const charge = selectedGaussCharge(data);
    if (!charge || !data?.dragArmed || !raycaster?.ray) return false;
    data.dragging = true;
    const root = resolveElectroApparatusRoot('gauss');
    if (root) {
      if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
      if (root.matrixWorld) {
        _invMat.copy(root.matrixWorld).invert();
        _localRay.copy(raycaster.ray).applyMatrix4(_invMat);
      } else {
        _localRay.copy(raycaster.ray);
      }
    } else {
      _localRay.copy(raycaster.ray);
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (_localRay.intersectPlane(plane, hit)) {
      charge.x = clamp(hit.x / 0.13, -5, 5);
      charge.y = clamp(hit.z / 0.13, -5, 5);
      data._aimPoint = { x: hit.x, y: hit.y, z: hit.z };
      data._aimVisible = true;
      if (state.stepIndex < 1 && (Math.abs(hit.x) > 0.1 || Math.abs(hit.z) > 0.1)) setStep('cross');
      return true;
    }
    return false;
  }

  function applyInducedProbeDragRaycast(data, raycaster) {
    if (!data?.dragStart || !data.probe || !raycaster?.ray) return false;
    const root = resolveElectroApparatusRoot('induced-e');
    if (root) {
      if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
      if (root.matrixWorld) {
        _invMat.copy(root.matrixWorld).invert();
        _localRay.copy(raycaster.ray).applyMatrix4(_invMat);
      } else {
        _localRay.copy(raycaster.ray);
      }
    } else {
      _localRay.copy(raycaster.ray);
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (_localRay.intersectPlane(plane, hit)) {
      data.probe.x = clamp(hit.x / 0.13, -INDUCED_E_PROBE_R_MAX, INDUCED_E_PROBE_R_MAX);
      data.probe.z = clamp(hit.z / 0.13, -INDUCED_E_PROBE_R_MAX, INDUCED_E_PROBE_R_MAX);
      data.probe.y = 0;
      data._aimPoint = { x: hit.x, y: hit.y, z: hit.z };
      data._aimVisible = true;
      const r = Math.hypot(data.probe.x, data.probe.z);
      if (r > INDUCED_E_PROBE_R_MAX) {
        const s = INDUCED_E_PROBE_R_MAX / r;
        data.probe.x *= s;
        data.probe.z *= s;
      }
      if (state.stepIndex < 1 && (Math.abs(data.probe.x) > 0.1 || Math.abs(data.probe.z) > 0.1)) setStep('probe');
      syncInducedElectric(data, false);
      return true;
    }
    return false;
  }

  function applyFaradayDragRaycast(data, raycaster, context = {}) {
    if (!data?.motionStart || !raycaster?.ray) return false;
    const root = resolveElectroApparatusRoot('faraday');
    if (root) {
      if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
      if (root.matrixWorld) {
        _invMat.copy(root.matrixWorld).invert();
        _localRay.copy(raycaster.ray).applyMatrix4(_invMat);
      } else {
        _localRay.copy(raycaster.ray);
      }
    } else {
      _localRay.copy(raycaster.ray);
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(FARADAY_Y * FARADAY_SCALE));
    const hit = new THREE.Vector3();
    if (_localRay.intersectPlane(plane, hit)) {
      data.dragging = true;
      const hitSimX = (hit.x - FARADAY_OFFSET_X) / FARADAY_SCALE;
      if (!Number.isFinite(data.dragOffsetSimX)) {
        data.dragOffsetSimX = clamp((data.x || 4.5) - hitSimX, -0.3, 0.3);
      }
      const targetX = hitSimX + (data.dragOffsetSimX || 0);
      const nextX = clamp(targetX, data.xMin, data.xMax);
      if (Math.abs(nextX - data.x) > 1e-6) {
        const visualDt = Math.max(Number(context.dt) || 0, 1 / 60);
        const dx = nextX - data.x;
        data.x = nextX;
        updateFaradayDragCurrent(data, dx, visualDt);
        data._prevX = nextX;
        syncFaraday(data, false, visualDt);
      }
      return true;
    }
    return false;
  }

  function getHallRayHitX(raycaster, data) {
    if (!raycaster?.ray) return null;
    const root = resolveElectroApparatusRoot('hall');
    if (!root) return null;
    if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
    if (root.matrixWorld) {
      _invMat.copy(root.matrixWorld).invert();
      _localRay.copy(raycaster.ray).applyMatrix4(_invMat);
    } else {
      _localRay.copy(raycaster.ray);
    }
    const targetSolenoid = data?.target === 'solenoid';
    const probeY = targetSolenoid ? 0.245 : 0.28;
    const probeZ = targetSolenoid ? -0.24 : -0.02;

    const O = _localRay.origin;
    const D = _localRay.direction;
    const denom = D.y * D.y + D.z * D.z;
    if (denom > 1e-5) {
      const w0y = O.y - probeY;
      const w0z = O.z - probeZ;
      const dotDW0 = D.x * O.x + D.y * w0y + D.z * w0z;
      const hitX = (O.x - D.x * dotDW0) / denom;
      if (Number.isFinite(hitX)) return hitX;
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -probeY);
    const hit = new THREE.Vector3();
    if (_localRay.intersectPlane(plane, hit)) {
      return hit.x;
    }
    return null;
  }

  /**
   * Apply screen-space drag deltas to the armed electric-field target.
   * Position only — visuals / E·F / decorations run once per animation frame
   * in update(). Calling sync here from every pointermove freezes the UI.
   */
  function applyElectricDragDelta(data, dx, dy, _dt = 0) {
    if (!data?.dragStart) return false;
    const { ox, oy, oz, freeX, freeY, freeZ } = electricDragOffsets(data, dx, dy);
    if (!freeX && !freeY && !freeZ) return false;

    const applyAxis = (obj, axis, free, start, delta, lo, hi) => {
      if (!free) {
        obj[axis] = start;
        return;
      }
      obj[axis] = clamp(start + delta, lo, hi);
    };

    if (data.dragTarget === 'probe') {
      const p = data.probe;
      const s = data.dragStart;
      applyAxis(p, 'x', freeX, s.x, ox, -5, 5);
      applyAxis(p, 'y', freeY, s.y, oy, -5, 5);
      applyAxis(p, 'z', freeZ, s.z, oz, -5, 5);
    } else {
      const charge = selectedElectricCharge(data);
      if (!charge) return false;
      const s = data.dragStart;
      applyAxis(charge, 'x', freeX, s.x, ox, -4.5, 4.5);
      applyAxis(charge, 'y', freeY, s.y, oy, -4.5, 4.5);
      applyAxis(charge, 'z', freeZ, s.z, oz, -4.5, 4.5);
    }
    return true;
  }

  /**
   * Gauss charge drag: write X/Y only. Field-line rebuild + flux particles are
   * owned by the per-frame syncGauss in update() (and once more on release).
   */
  function applyGaussDragDelta(data, dx, dy, _dt = 0) {
    const charge = selectedGaussCharge(data);
    if (!charge || !data?.dragArmed) return false;
    data.dragging = true;
    const camera = equipment.electro?.getCamera?.();
    let rx = 1, rz = 0, ux = 0, uz = -1;
    if (camera) {
      const q = new THREE.Quaternion();
      if (typeof camera.getWorldQuaternion === 'function') camera.getWorldQuaternion(q);
      else if (camera.quaternion) q.copy(camera.quaternion);
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      rx = camRight.x; rz = camRight.z;
      ux = -camUp.x; uz = -camUp.z;
    }
    const ox = (dx * rx + dy * ux) * 0.025;
    const oy = (dx * rz + dy * uz) * 0.025;
    charge.x = clamp(Number(data.dragStartX || 0) + ox, -5, 5);
    charge.y = clamp(Number(data.dragStartY || 0) + oy, -5, 5);
    if (state.stepIndex < 1 && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) setStep('cross');
    return true;
  }

  function syncElectricField(data, refresh = true, dt = 0) {
    const probe = data.probe || { x: 0, y: 0, z: 0, q0: 1 };
    data.field = electricFieldAt(data.charges, probe);
    data.force = electricForceAt(data.charges, probe, probe.q0);
    data.magnitudeE = Math.hypot(data.field.x, data.field.y, data.field.z);
    data.magnitudeF = Math.hypot(data.force.x, data.force.y, data.force.z);
    data.potential = electricPotentialAt(data.charges, probe);
    const radius = Number(data.radius || 2.4);
    data.qEnclosed = gaussEnclosedCharge(data.charges, radius, data.gaussShape || 'sphere', data.gaussSeed || 0);
    data.flux = gaussFlux(data.charges, radius, EPSILON_0, data.gaussShape || 'sphere', data.gaussSeed || 0);
    // Optional Gauss overlay on the field bench — only when the toggle is on.
    if (Boolean(data.showGauss)) {
      data.meanField = gaussMeanNormalField(data.charges, radius);
    }
    // Field-line pack via SimBackend only when charge/flag signature changes
    // (probe E/F stay main-thread — cheap every frame).
    if (state.expId === 'electric_field') {
      stepSimBackend(dt || 1 / 60);
    }
    equipment.electro?.updateElectricField?.(data, dt);
    if (data._forceDecorations) data._forceDecorations = false;
    if (refresh) pushHud();
  }

  function syncFaraday(data, refresh = true, dt = 0, visual = true) {
    data.area = faradayArea(data.x, data.rodLength, data.xEnd);
    data.flux = faradayFlux(data.B, data.x, data.rodLength, data.xEnd);
    if (visual) equipment.electro?.updateFaraday?.(data, dt);
    if (refresh) pushHud();
  }

  function recomputeInducedElectric(data) {
    const probe = data.probe || { x: 0, y: 0, z: 0, q0: 1 };
    data.probeR = Math.hypot(Number(probe.x || 0), Number(probe.z || 0));
    const field = inducedEVectorAt(probe, data.R, data.dBdt);
    data.field = field;
    data.magnitudeE = field.magnitude;
    data.force = {
      x: field.x * Number(probe.q0 || 0),
      y: 0,
      z: field.z * Number(probe.q0 || 0),
    };
    data.sense = field.sense;
    data.senseLabel = inducedESenseLabel(field.sense);
    data.eAtBoundary = inducedEMagnitude(data.R, data.R, data.dBdt);
    data.profile = inducedEProfile(data.R, data.dBdt);
    return data;
  }

  function syncInducedElectric(data, refresh = true, dt = 0) {
    recomputeInducedElectric(data);
    equipment.electro?.updateInducedElectric?.(data, dt);
    if (refresh) pushHud();
  }

  function applyInducedProbeDrag(data, dx, dy) {
    if (!data?.dragStart || !data.probe) return false;
    // Screen drag maps to tabletop XZ (B is vertical).
    data.probe.x = clamp(data.dragStart.x + dx * 0.02, -INDUCED_E_PROBE_R_MAX, INDUCED_E_PROBE_R_MAX);
    data.probe.z = clamp(data.dragStart.z + dy * 0.02, -INDUCED_E_PROBE_R_MAX, INDUCED_E_PROBE_R_MAX);
    data.probe.y = 0;
    const r = Math.hypot(data.probe.x, data.probe.z);
    if (r > INDUCED_E_PROBE_R_MAX) {
      const s = INDUCED_E_PROBE_R_MAX / r;
      data.probe.x *= s;
      data.probe.z *= s;
    }
    if (state.stepIndex < 1 && Math.hypot(dx, dy) > 4) setStep('probe');
    syncInducedElectric(data, false);
    return true;
  }

  const INDUCED_DBDT_MAX = INDUCED_E_AMP_MAX * INDUCED_E_OMEGA_MAX;
  const INDUCED_SLIDER_RANGES = {
    R: [INDUCED_E_R_MIN, INDUCED_E_R_MAX],
    amp: [0.2, INDUCED_E_AMP_MAX],
    omega: [0.15, INDUCED_E_OMEGA_MAX],
    B: [-INDUCED_E_AMP_MAX, INDUCED_E_AMP_MAX],
    bStart: [-2.5, 2.5],
    bEnd: [-2.5, 2.5],
    dBdt: [-INDUCED_DBDT_MAX, INDUCED_DBDT_MAX],
    probeR: [0.15, INDUCED_E_PROBE_R_MAX],
    q0: [0.2, 3],
  };

  function inducedSliderBaseValue(data, key) {
    if (key === 'probeR') return Number(data.probeR || 0);
    if (key === 'q0') return Math.abs(Number(data.probe?.q0 || 1));
    return Number(data[key] || 0);
  }

  /** Relative content-screen slider drag (pointer-lock / hold path). */
  function applyInducedSliderRelative(data, totalX) {
    const key = data.sliderKey;
    if (!key || !data.sliderDragging) return false;
    const range = INDUCED_SLIDER_RANGES[key];
    if (!range) return false;
    const [min, max] = range;
    const span = max - min;
    if (data.sliderDragBase == null || !Number.isFinite(data.sliderDragBase)) {
      data.sliderDragBase = inducedSliderBaseValue(data, key);
      data.sliderDragOriginX = 0;
    }
    // ~full range over ~360 px of mouse travel — readable without overshoot.
    const next = clamp(
      Number(data.sliderDragBase) + Number(totalX || 0) * span * 0.0028,
      min,
      max,
    );
    onUiAction('induced-e-set', { key, value: next, live: true });
    return true;
  }

  function finishInducedSlider(data) {
    if (!data?.sliderDragging) return false;
    data.sliderDragging = false;
    data.sliderKey = null;
    data.sliderDragBase = null;
    data.sliderDragOriginX = null;
    Object.keys(data).forEach((key) => {
      if (key.startsWith('_sliderBase_')) delete data[key];
    });
    syncInducedElectric(data);
    return true;
  }

  function updateInducedElectric(data, dt = 0) {
    const step = Math.max(0, Number(dt || 0));
    data._time = Number(data._time || 0) + step;
    if (data.auto && !data.paused) {
      const bMin = -2.0;
      const bMax = 2.0;
      const span = bMax - bMin;
      const userRate = Number(data.dBdt || 0);
      const sign = userRate < 0 ? -1 : 1;
      const speed = Math.abs(userRate) || 1.10;
      const rate = sign * speed;
      data.dBdt = rate;
      if (span > 1e-4) {
        let nextB = Number(data.B ?? (sign > 0 ? bMin : bMax)) + rate * step;
        if (sign > 0 && nextB >= bMax) {
          nextB = bMin + ((nextB - bMax) % span);
        } else if (sign < 0 && nextB <= bMin) {
          nextB = bMax - ((bMin - nextB) % span);
        }
        data.B = nextB;
      }
    }
    recomputeInducedElectric(data);
    equipment.electro?.updateInducedElectric?.(data, step);
    data._hudThrottle = Number(data._hudThrottle || 0) + step;
    const hudInterval = data.dragging || data.sliderDragging ? 0.1 : 0.22;
    if (data._hudThrottle > hudInterval) {
      data._hudThrottle = 0;
      pushHud();
    }
    return data;
  }

  function faradayBusy(data) {
    return !!(data?.dragging || data?.sliderDragging || data?.pendingAnim);
  }

  function finishFaradayMotion(data) {
    if (!data.motionStart) return false;
    const start = data.motionStart;
    const dt = Math.max(1e-6, data._time - start.t0);
    const dx = data.x - start.x0;
    const dFlux = faradayFlux(start.B, data.x, data.rodLength, data.xEnd)
      - start.flux0;
    const emf = faradayEmfFromDelta(dFlux, dt);
    const sense = faradaySense(dFlux / dt);
    data.lastMotion = {
      x0: start.x0, x1: data.x, dx, dt, B: start.B,
      flux0: start.flux0, flux1: start.flux0 + dFlux, dFlux, emf, sense,
      senseLabel: faradaySenseLabel(sense),
    };
    data.records.push({ type: 'motion', ...data.lastMotion });
    data.records = data.records.slice(-12);
    data.motionStart = null;
    data.dragging = false;
    data.dragOffsetSimX = null;
    data._dragDirection = 0;
    data._dragReverseDistance = 0;
    data.measureMode = null;
    data.currentSense = 'none';
    data.liveEmf = 0;
    data.animProgress = 0;
    data.currentLinger = 0;
    data.lingerSense = 'none';
    if (state.stepIndex < 1 && Math.abs(dx) > 1e-4) setStep('field');
    toast(`动生测量完成：ε_i = ${emf.toFixed(4)} V，${faradaySenseLabel(sense)}`);
    return true;
  }

  /**
   * Animate B or x from the current value to a target over `duration` seconds.
   * Used by “播放变化” and by reverse-B preset.
   */
  function startFaradayAnim(data, opts = {}) {
    if (faradayBusy(data)) return false;
    const channel = opts.channel === 'x' || opts.channel === 'B'
      ? opts.channel
      : (data.animChannel === 'x' ? 'x' : 'B');
    const duration = clamp(
      Number(opts.duration ?? data.animDuration ?? 1.5),
      0.3,
      6,
    );
    let from;
    let to;
    if (channel === 'x') {
      from = Number(data.x || 0);
      to = clamp(
        Number(opts.to ?? data.targetX ?? from),
        FARADAY_X_MIN,
        FARADAY_X_MAX,
      );
    } else {
      from = Number(data.B || 0);
      to = clamp(Number(opts.to ?? data.targetB ?? from), -3, 3);
    }
    if (Math.abs(to - from) < 1e-8) {
      if (channel === 'x' && data.lastMotion) {
        data.x = data.lastMotion.x0;
        from = data.lastMotion.x0;
      } else if (channel === 'B' && data.lastInduction) {
        data.B = data.lastInduction.B0;
        from = data.lastInduction.B0;
      } else {
        toast('目标与当前值相同，请先调整目标');
        return false;
      }
    }
    data.animChannel = channel;
    // Steady dΦ/dt for the whole play (linear ramp) so current arrows stay on.
    const dValDt = (to - from) / Math.max(1e-6, duration);
    let dFluxDt0 = 0;
    if (channel === 'x') {
      dFluxDt0 = Number(data.B || 0) * Number(data.rodLength || FARADAY_ROD_LENGTH) * dValDt;
    } else {
      dFluxDt0 = faradayArea(data.x, data.rodLength, data.xEnd) * dValDt;
    }
    data.pendingAnim = {
      channel,
      from,
      to,
      t0: data._time,
      duration,
      dValDt,
      dFluxDt: dFluxDt0,
      B0: Number(data.B || 0),
      x0: Number(data.x || 0),
      area0: faradayArea(data.x, data.rodLength, data.xEnd),
      flux0: faradayFlux(data.B, data.x, data.rodLength, data.xEnd),
    };
    data.inductionStart = channel === 'B' ? data.pendingAnim : null;
    data.measureMode = channel === 'x' ? 'motion' : 'induction';
    data.currentSense = faradaySense(dFluxDt0);
    data.lingerSense = 'none';
    data.liveEmf = -dFluxDt0;
    data.animProgress = 0;
    data.currentLinger = 0;
    data.pendingB = null;
    return true;
  }

  function startFaradayBChange(data, target, duration = 0.6) {
    return startFaradayAnim(data, { channel: 'B', to: target, duration });
  }

  function finishFaradayAnim(data) {
    const pending = data.pendingAnim;
    if (!pending) return false;
    if (pending.channel === 'x') data.x = pending.to;
    else data.B = pending.to;
    const dt = Math.max(1e-6, data._time - pending.t0, pending.duration);
    const flux1 = faradayFlux(data.B, data.x, data.rodLength, data.xEnd);
    const dFlux = flux1 - pending.flux0;
    const emf = faradayEmfFromDelta(dFlux, dt);
    const sense = faradaySense(dFlux / dt);
    if (pending.channel === 'x') {
      const dx = data.x - pending.x0;
      data.lastMotion = {
        x0: pending.x0,
        x1: data.x,
        dx,
        dt,
        B: pending.B0,
        flux0: pending.flux0,
        flux1,
        dFlux,
        emf,
        sense,
        senseLabel: faradaySenseLabel(sense),
      };
      data.records.push({ type: 'motion', ...data.lastMotion });
      if (state.stepIndex < 1 && Math.abs(dx) > 1e-4) setStep('field');
      toast(`动生测量完成：ε_i = ${emf.toFixed(4)} V，${faradaySenseLabel(sense)}`);
    } else {
      const dB = data.B - pending.from;
      data.lastInduction = {
        B0: pending.from,
        B1: data.B,
        dB,
        dt,
        area: pending.area0,
        flux0: pending.flux0,
        flux1,
        dFlux,
        emf,
        sense,
        senseLabel: faradaySenseLabel(sense),
      };
      data.records.push({ type: 'induction', ...data.lastInduction });
      if (state.stepIndex < 2 && Math.abs(dB) > 1e-6) setStep('conclude');
      toast(`感生测量完成：ε_i = ${emf.toFixed(4)} V，${faradaySenseLabel(sense)}`);
    }
    data.records = data.records.slice(-12);
    data.pendingAnim = null;
    data.pendingB = null;
    data.inductionStart = null;
    data.measureMode = null;
    // Stop current flow as soon as the change ends (no linger).
    data.currentSense = 'none';
    data.lingerSense = 'none';
    data.liveEmf = 0;
    data.animProgress = 0;
    data.currentLinger = 0;
    return true;
  }

  /** Stop early: treat current value as the endpoint and record the partial change. */
  function stopFaradayAnim(data) {
    const pending = data.pendingAnim;
    if (!pending) return false;
    pending.to = pending.channel === 'x' ? Number(data.x) : Number(data.B);
    pending.duration = Math.max(1e-3, data._time - pending.t0);
    return finishFaradayAnim(data);
  }

  // Back-compat alias used by reverse-B path.
  function finishFaradayBChange(data) {
    return finishFaradayAnim(data);
  }

  function beginFaradaySlider(data) {
    if (faradayBusy(data)) return false;
    data.sliderDragging = true;
    data.measureMode = 'induction';
    data.currentSense = 'none';
    data._prevB = data.B;
    data._dragDirectionB = 0;
    data._dragReverseDistanceB = 0;
    data.sliderStart = {
      B0: data.B,
      t0: data._time,
      area: faradayArea(data.x, data.rodLength, data.xEnd),
      flux0: faradayFlux(data.B, data.x, data.rodLength, data.xEnd),
      // dragB0 is the relative-drag origin (may differ from B0 after click-to-set).
      dragB0: data.B,
    };
    return true;
  }

  /** Map a faraday-b-slider or desk slider hit (desk 3D value or content-screen px) → B. */
  function faradayBFromPick(pick) {
    if (!pick) return null;
    if (pick.action !== 'faraday-b-slider' && !(pick.action === 'param-slider' && (pick.key === 'B' || pick.setAction === 'faraday-set'))) {
      return null;
    }
    const min = Number(pick.min ?? -3);
    const max = Number(pick.max ?? 3);
    if (Number.isFinite(pick.value)) return clamp(Number(pick.value), min, max);
    if (!Number.isFinite(pick.px)) return null;
    const trackX = Number.isFinite(pick.trackX) ? Number(pick.trackX) : Number(pick.x || 0);
    const trackW = Math.max(1, Number.isFinite(pick.trackW) ? Number(pick.trackW) : Number(pick.w || 1));
    const u = clamp((Number(pick.px) - trackX) / trackW, 0, 1);
    return min + u * (max - min);
  }

  /**
   * Jump the thumb to an absolute B while keeping relative drag continuous.
   * totalX is the cumulative pointer delta already spent in this gesture so
   * B = dragB0 + totalX*0.01 still equals `value` after the jump.
   */
  function setFaradaySliderAbsolute(data, value, totalX = 0) {
    const next = clamp(Number(value), -3, 3);
    data.B = next;
    if (data.sliderStart) {
      data.sliderStart.dragB0 = next - Number(totalX || 0) * 0.01;
    }
  }

  function applyFaradaySliderRelative(data, totalX) {
    const start = data.sliderStart;
    if (!start) return;
    const base = Number.isFinite(start.dragB0) ? start.dragB0 : start.B0;
    data.B = clamp(base + Number(totalX || 0) * 0.01, -3, 3);
  }

  function finishFaradaySlider(data) {
    const start = data.sliderStart;
    if (!data.sliderDragging || !start) return false;
    const dt = Math.max(1e-6, data._time - start.t0);
    const flux1 = faradayFlux(data.B, data.x, data.rodLength, data.xEnd);
    const dFlux = flux1 - start.flux0;
    const dB = data.B - start.B0;
    const emf = faradayEmfFromDelta(dFlux, dt);
    const sense = faradaySense(dFlux / dt);
    data.lastInduction = {
      B0: start.B0, B1: data.B, dB, dt, area: start.area,
      flux0: start.flux0, flux1, dFlux, emf, sense,
      senseLabel: faradaySenseLabel(sense),
    };
    data.records.push({ type: 'induction', ...data.lastInduction });
    data.records = data.records.slice(-12);
    data.sliderDragging = false;
    data.sliderStart = null;
    data._prevB = data.B;
    data._dragDirectionB = 0;
    data._dragReverseDistanceB = 0;
    data.measureMode = null;
    data.currentSense = 'none';
    data.lingerSense = 'none';
    data.currentLinger = 0;
    data.liveEmf = 0;
    if (state.stepIndex < 2 && Math.abs(dB) > 1e-6) setStep('conclude');
    toast(`磁场滑块测量完成：ε_i = ${emf.toFixed(4)} V，${faradaySenseLabel(sense)}`);
    return true;
  }

  function updateFaraday(data, dt = 0) {
    const step = Math.max(0, Number(dt || 0));
    data._time += step;
    if (data.pendingAnim) {
      const p = data.pendingAnim;
      const u = clamp((data._time - p.t0) / Math.max(1e-6, p.duration), 0, 1);
      // Linear ramp → constant dΦ/dt for the whole play (current arrows stay lit).
      const val = p.from + (p.to - p.from) * u;
      data.animProgress = u;
      // Prefer frame velocity for x (matches manual rod); planned rate for B.
      if (p.channel === 'x') {
        data.x = val;
        const v = step > 1e-8 ? (data.x - data._prevX) / step : Number(p.dValDt || 0);
        const dFluxDt = Number(data.B || 0) * Number(data.rodLength || FARADAY_ROD_LENGTH) * v;
        // Fallback planned rate if this frame's dx is 0 (first tick).
        const rate = Math.abs(dFluxDt) > 1e-8 ? dFluxDt : Number(p.dFluxDt || 0);
        data.currentSense = faradaySense(rate);
        data.liveEmf = -rate;
      } else {
        data.B = val;
        const dFluxDt = Number(p.dFluxDt);
        data.currentSense = faradaySense(dFluxDt);
        data.liveEmf = -dFluxDt;
      }
      if (u >= 1) finishFaradayAnim(data);
    } else if (data.dragging && data.motionStart) {
      const dx = data.x - data._prevX;
      if (Math.abs(dx) > 1e-6) {
        updateFaradayDragCurrent(data, dx, step);
      } else if (Number(data.currentLinger || 0) > 0 && data.lingerSense !== 'none') {
        // MediaPipe/touch samples do not necessarily land on every 60 Hz
        // fixed tick. Preserve the last direction between input samples so
        // current arrows remain visibly animated throughout a continuous drag.
        data.currentLinger = Math.max(0, Number(data.currentLinger) - step);
        data.currentSense = data.lingerSense;
      } else {
        data.currentSense = 'none';
        data.liveEmf = 0;
      }
    } else if (data.sliderDragging && data.sliderStart) {
      const prevB = Number.isFinite(data._prevB) ? data._prevB : data.sliderStart.B0;
      const dB = data.B - prevB;
      if (Math.abs(dB) > 1e-6) {
        updateFaradayBDragCurrent(data, dB, step);
      } else if (Number(data.currentLinger || 0) > 0 && data.lingerSense !== 'none') {
        data.currentLinger = Math.max(0, Number(data.currentLinger) - step);
        data.currentSense = data.lingerSense;
      } else {
        data.currentSense = 'none';
        data.liveEmf = 0;
      }
    } else {
      data.currentSense = 'none';
      data.liveEmf = 0;
      data.animProgress = 0;
      data.currentLinger = 0;
      data.lingerSense = 'none';
    }
    data._prevX = data.x;
    data._prevB = data.B;
    syncFaraday(data, false, step);
    data._hudThrottle += step;
    // Anim / drag needs livelier readout; keep well under full paint every frame.
    const hudInterval = data.pendingAnim || data.sliderDragging || data.dragging
      ? 0.08
      : 0.22;
    if (data._hudThrottle > hudInterval) {
      data._hudThrottle = 0;
      pushHud();
    }
    return data;
  }

  /**
   * Convert rod motion into an induced-current direction with input hysteresis.
   * Touch/MediaPipe coordinates naturally wander by a few pixels; requiring a
   * meaningful accumulated reverse distance prevents that noise from flipping
   * the Lenz-law arrows every other sample while preserving deliberate reversal.
   */
  function updateFaradayDragCurrent(data, dx, dt) {
    const delta = Number(dx || 0);
    if (Math.abs(delta) <= 1e-6) return false;
    const movementDirection = Math.sign(delta);
    let direction = Number(data._dragDirection || 0);
    if (!direction) {
      direction = movementDirection;
      data._dragReverseDistance = 0;
    } else if (movementDirection === direction) {
      data._dragReverseDistance = 0;
    } else {
      data._dragReverseDistance = Number(data._dragReverseDistance || 0) + Math.abs(delta);
      // ~4 CSS px at the current 0.015 m/px mapping. Small tracking wobble is
      // ignored; a clear reverse drag crosses this quickly and changes sense.
      if (data._dragReverseDistance < 0.06) {
        data.currentSense = data.lingerSense || data.currentSense || 'none';
        data.currentLinger = 0.14;
        return false;
      }
      direction = movementDirection;
      data._dragReverseDistance = 0;
    }
    data._dragDirection = direction;
    const seconds = Math.max(Number(dt) || 0, 1 / 60);
    const dFluxDt = Number(data.B || 0)
      * Number(data.rodLength || FARADAY_ROD_LENGTH)
      * (Math.abs(delta) / seconds)
      * direction;
    data.currentSense = faradaySense(dFluxDt);
    data.lingerSense = data.currentSense;
    data.currentLinger = 0.14;
    data.liveEmf = -dFluxDt;
    return data.currentSense !== 'none';
  }

  /**
   * Convert live B-slider dragging into an induced-current direction with input hysteresis.
   */
  function updateFaradayBDragCurrent(data, dB, dt) {
    const delta = Number(dB || 0);
    if (Math.abs(delta) <= 1e-6) return false;
    const movementDirection = Math.sign(delta);
    let direction = Number(data._dragDirectionB || 0);
    if (!direction) {
      direction = movementDirection;
      data._dragReverseDistanceB = 0;
    } else if (movementDirection === direction) {
      data._dragReverseDistanceB = 0;
    } else {
      data._dragReverseDistanceB = Number(data._dragReverseDistanceB || 0) + Math.abs(delta);
      if (data._dragReverseDistanceB < 0.04) {
        data.currentSense = data.lingerSense || data.currentSense || 'none';
        data.currentLinger = 0.14;
        return false;
      }
      direction = movementDirection;
      data._dragReverseDistanceB = 0;
    }
    data._dragDirectionB = direction;
    const seconds = Math.max(Number(dt) || 0, 1 / 60);
    const area = faradayArea(data.x, data.rodLength, data.xEnd);
    const dFluxDt = area * (Math.abs(delta) / seconds) * direction;
    data.currentSense = faradaySense(dFluxDt);
    data.lingerSense = data.currentSense;
    data.currentLinger = 0.14;
    data.liveEmf = -dFluxDt;
    return data.currentSense !== 'none';
  }

  function calculateHallField(data, pos = data.probePos) {
    if (!data.wiring?.energized || data.wiring.target !== data.target) return 0;
    const targetSolenoid = data.target === 'solenoid';
    const rawPos = Number(pos ?? (targetSolenoid ? 16 : 0));
    const Im = Number(data.Im || 0);
    let bTesla;
    if (data.target === 'helmholtz') {
      const x = Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos;
      const fixedX = 0;
      const rawMovingX = Number(data.rightCoilPos ?? 0.05);
      const movingX = Math.abs(rawMovingX) > 0.5 ? rawMovingX / 100 : rawMovingX;
      const fieldAt = (centreX) => (
        HALL_MU0 * HALL_COIL_TURNS * Im * HALL_COIL_RADIUS_M ** 2
        / (2 * Math.pow(HALL_COIL_RADIUS_M ** 2 + (x - centreX) ** 2, 1.5))
      );
      if (data.wiring?.coilMode === 'fixed') {
        bTesla = fieldAt(fixedX);
      } else if (data.wiring?.coilMode === 'moving') {
        bTesla = fieldAt(movingX);
      } else {
        bTesla = fieldAt(fixedX) + fieldAt(movingX);
      }
    } else {
      const rawLen = Number(data.solenoidLength || 0.30);
      const length = (rawLen > 1 ? rawLen / 100 : rawLen) || HALL_SOLENOID_LENGTH_M;
      const halfLength = length / 2;
      const turnsPerMetre = Number(data.turns || 2340) / length;
      const endCos = (z) => z / Math.sqrt(z * z + HALL_SOLENOID_RADIUS_M ** 2);
      // 探杆刻度 X (cm)：从 1.0 cm 测到 31.0 cm，中心为 16.0 cm
      const x = (16.0 - rawPos) / 100;
      bTesla = HALL_MU0 * turnsPerMetre * Im * 0.5
        * (endCos(x + halfLength) - endCos(x - halfLength));
    }
    return bTesla * Number(data.direction || 1);
  }

  function calculateHallVoltage(data) {
    const rawIs = Number(data.Is || 0);
    const isA = rawIs > 0.05 ? rawIs / 1000 : rawIs;
    return HALL_K * isA * calculateHallField(data)
      + Number(data.zeroOffset || 0);
  }

  function syncHall(data, refresh = true) {
    applyWiringState(data);
    data.vh = calculateHallVoltage(data);
    equipment.electro?.updateHall?.(data);
    if (refresh) pushHud();
  }

  function syncHallDemo(data, refresh = true) {
    ensureSimBackend('hall_carrier_demo', data);
    syncSimParams(data);
    // Prefer pure-kind Vh when backend is live; fall back to host formula.
    if (simBackend && simBackendExpId === 'hall_carrier_demo') {
      const snap = simBackend.getSnapshot?.();
      if (snap?.scalars && Number.isFinite(snap.scalars.vh)) {
        data.vh = snap.scalars.vh;
        data.force = snap.scalars.force;
      } else {
        data.vh = hallDemoVoltage(data);
        data.force = hallDemoForce(data);
      }
      // Pull any already-complete particle snapshot (main path / warm worker).
      if (snap?.particles?.length) {
        applySimSnapshot(snap, data);
      }
    } else {
      data.vh = hallDemoVoltage(data);
      data.force = hallDemoForce(data);
      setHallHostParticlesOwned(false);
    }
    // Keep ownership in sync; local integrate runs until particles are live.
    equipment.electro?.setHallDemoHostParticlesOwned?.(hallHostParticlesLive);
    equipment.electro?.updateHallDemo?.(data, 0);
    if (refresh) pushHud();
  }


  function remainingHallParts(data) {
    return HALL_PART_ROLES.filter((role) => !data.identified?.[role]);
  }

  /** Next equipment that must be identified (strict sequential order). */
  function nextHallPart(data) {
    return remainingHallParts(data)[0] || null;
  }

  function setIdentifyFeedback(ok, text) {
    const data = state.data;
    if (!data) return;
    data.identifyFeedback = {
      ok: !!ok,
      text: String(text || ''),
      at: Date.now(),
    };
  }

  function refreshHallIdentifyVisuals(hoverRole) {
    const data = state.data;
    if (state.expId !== 'hall_effect' || currentStep()?.id !== 'identify') return;
    const next = nextHallPart(data);
    // Strict: outline only while the crosshair is on that part.
    // Identified parts stay mode "done" so their hit volumes stop blocking
    // rear apparatus (solenoid sits behind Helmholtz on the bench).
    HALL_PART_ROLES.forEach((role) => {
      let mode = 'off';
      if (data.identified?.[role]) {
        mode = 'done';
      } else if (hoverRole === role) {
        mode = role === next ? 'hover' : 'locked';
      }
      equipment.electro?.setHallPartState?.(role, mode);
    });
    data._hoverRole = hoverRole || null;
    data.identifyNext = next;
  }


  function identifyHallRole(role) {
    const data = state.data;
    const name = HALL_PART_NAMES[role];
    if (!name || !data.identified) return false;

    // Already done earlier in the sequence
    if (data.identified[role]) {
      const next = nextHallPart(data);
      const msg = next
        ? `「${name}」已识别过。请按顺序瞄准：${HALL_PART_NAMES[next]}`
        : `「${name}」已识别过。器材认识已完成`;
      toast(msg);
      setIdentifyFeedback(true, msg);
      refreshHallIdentifyVisuals(role);
      pushHud();
      return true;
    }

    const expected = nextHallPart(data);
    // Wrong order: this is a real apparatus, but not the current step target
    if (expected && role !== expected) {
      const expectedName = HALL_PART_NAMES[expected];
      const expectedIdx = HALL_PART_ROLES.indexOf(expected) + 1;
      const pickedIdx = HALL_PART_ROLES.indexOf(role) + 1;
      const msg = `选错了：当前应按顺序识别第 ${expectedIdx} 件「${expectedName}」，你点的是第 ${pickedIdx} 件「${name}」`;
      toast(msg);
      setIdentifyFeedback(false, msg);
      data._lastWrongRole = role;
      refreshHallIdentifyVisuals(role);
      pushHud();
      return true;
    }

    data.identified[role] = true;
    data._lastWrongRole = null;
    const remaining = remainingHallParts(data);
    if (!remaining.length) {
      equipment.electro?.clearHallIdentifyVisuals?.();
      const msg = `✓ 正确：已识别「${name}」。器材认识完成，请到内容屏选择测量对象`;
      toast(msg);
      setIdentifyFeedback(true, msg);
      advanceStep();
    } else {
      const next = remaining[0];
      const nextIdx = HALL_PART_ROLES.indexOf(next) + 1;
      const msg = `✓ 正确：已识别「${name}」。下一项（${String(nextIdx).padStart(2, '0')}）：${HALL_PART_NAMES[next]}`;
      toast(msg);
      setIdentifyFeedback(true, msg);
      refreshHallIdentifyVisuals(null);
    }
    pushHud();
    return true;
  }


  function identifyHallWrong(role) {
    const expected = nextHallPart(state.data);
    const expectedName = expected ? HALL_PART_NAMES[expected] : '';
    const expectedIdx = expected ? HALL_PART_ROLES.indexOf(expected) + 1 : 0;
    let wrongLabel = '空白处或其他物体';
    if (role === 'ui_action') wrongLabel = '界面按钮';
    else if (role && role !== 'generic') wrongLabel = role;
    const msg = expected
      ? `选错了：「${wrongLabel}」不是目标。请按顺序瞄准第 ${expectedIdx} 件「${expectedName}」`
      : '器材认识已完成';
    toast(msg);
    setIdentifyFeedback(false, msg);
    state.data._lastWrongRole = role || 'generic';
    refreshHallIdentifyVisuals(state.data._hoverRole);
    pushHud();
    return true;
  }


  function applyVisualDefaults(expId) {
    if (!equipment.electro) return;
    // Visibility only; heavy field rebuild is a separate frame-budget job.
    let kind = null;
    if (expId === 'faraday_induction') {
      equipment.electro.setMode?.('faraday');
      kind = 'faraday';
    } else if (expId === 'induced_electric_field') {
      equipment.electro.setMode?.('induced-e');
      kind = 'induced-e';
    } else if (expId === 'hall_effect') {
      equipment.electro.setMode?.('hall');
      kind = 'hall';
    } else if (expId === 'hall_carrier_demo') {
      equipment.electro.setMode?.('hall-demo');
      kind = 'hall-demo';
    } else if (expId === 'gauss_theorem') {
      equipment.electro.setMode?.('gauss');
      kind = 'gauss';
    } else if (expId === 'electric_field') {
      equipment.electro.setMode?.('electric-field');
      kind = 'electric-field';
    }
    if (!kind) return;
    state.data._awaitElectroSync = kind;
    state.data._electroDetailsPending = true;
    // setMode is O(1) mount. Field sync is deferred and usually a signature no-op
    // never soft-switch the lab for it.
    labFrameScheduler.schedule('electro:sync-detail', () => {
      if (!state.running || state.expId !== expId) return;
      // Flush without forcing a HUD repaint when nothing visual changed.
      flushDeferredElectroSync();
    }, { priority: 35, soft: true });
  }

  function flushDeferredElectroSync() {
    const kind = state.data?._awaitElectroSync;
    if (!kind || !state.running) return false;
    state.data._awaitElectroSync = null;
    if (kind === 'faraday') syncFaraday(state.data, false);
    else if (kind === 'induced-e') syncInducedElectric(state.data, false);
    else if (kind === 'hall') {
      syncHall(state.data, false);
      refreshHallIdentifyVisuals(null);
    } else if (kind === 'hall-demo') syncHallDemo(state.data, false);
    else if (kind === 'gauss') syncGauss(state.data, false);
    else if (kind === 'electric-field') syncElectricField(state.data, false);
    else return false;
    state.data._electroDetailsPending = false;
    return true;
  }



  function onUiAction(action, payload = {}) {
    if (state.expId === 'induced_electric_field') {
      const data = state.data;
      if (action === 'induced-e-adjust') {
        const key = payload.key;
        const delta = Number(payload.delta || 0);
        if (key === 'R') data.R = clamp(data.R + delta, INDUCED_E_R_MIN, INDUCED_E_R_MAX);
        if (key === 'amp') data.amp = clamp(data.amp + delta, 0.2, INDUCED_E_AMP_MAX);
        if (key === 'omega') data.omega = clamp(data.omega + delta, 0.15, INDUCED_E_OMEGA_MAX);
        if (key === 'B' && !data.auto) {
          data.B = clamp(Number(data.B || 0) + delta, -INDUCED_E_AMP_MAX, INDUCED_E_AMP_MAX);
        }
        if (key === 'dBdt' && !data.auto) {
          data.dBdt = clamp(
            Number(data.dBdt || 0) + delta,
            -INDUCED_E_AMP_MAX * INDUCED_E_OMEGA_MAX,
            INDUCED_E_AMP_MAX * INDUCED_E_OMEGA_MAX,
          );
        }
        if (key === 'probeR') {
          const nextR = clamp(Number(data.probeR || 0) + delta, 0.15, INDUCED_E_PROBE_R_MAX);
          const angle = Math.atan2(Number(data.probe?.z || 0), Number(data.probe?.x || 1));
          data.probe.x = nextR * Math.cos(angle);
          data.probe.z = nextR * Math.sin(angle);
          data.probeR = nextR;
          if (state.stepIndex < 1) setStep('probe');
        }
        if (key === 'q0') {
          const magnitude = clamp(Math.abs(Number(data.probe?.q0 || 1)) + delta, 0.2, 3);
          data.probe.q0 = Math.sign(data.probe.q0 || 1) * Math.round(magnitude * 10) / 10;
        }
        if (state.stepIndex < 2 && (key === 'amp' || key === 'omega' || key === 'B' || key === 'dBdt')) {
          setStep('lenz');
        }
      } else if (action === 'induced-e-set' || action === 'induced-e-slider') {
        // Absolute value from content-screen sliders (live drag or one-shot set).
        const key = payload.key;
        let value = Number(payload.value);
        if (!Number.isFinite(value) && Number.isFinite(payload.px)) {
          const trackX = Number.isFinite(payload.trackX) ? Number(payload.trackX) : Number(payload.x || 0);
          const trackW = Math.max(1, Number.isFinite(payload.trackW) ? Number(payload.trackW) : Number(payload.w || 1));
          const min = Number(payload.min);
          const max = Number(payload.max);
          if (Number.isFinite(min) && Number.isFinite(max)) {
            const u = clamp((Number(payload.px) - trackX) / trackW, 0, 1);
            value = min + u * (max - min);
          }
        }
        if (!key || !Number.isFinite(value)) return true;
        if (key === 'R') data.R = clamp(value, INDUCED_E_R_MIN, INDUCED_E_R_MAX);
        else if (key === 'amp') {
          data.amp = clamp(value, 0.2, INDUCED_E_AMP_MAX);
          if (state.stepIndex < 2) setStep('lenz');
        } else if (key === 'omega') {
          data.omega = clamp(value, 0.15, INDUCED_E_OMEGA_MAX);
          if (state.stepIndex < 2) setStep('lenz');
        } else if (key === 'probeR') {
          const nextR = clamp(value, 0.15, INDUCED_E_PROBE_R_MAX);
          const angle = Math.atan2(Number(data.probe?.z || 0), Number(data.probe?.x || 1));
          data.probe.x = nextR * Math.cos(angle);
          data.probe.z = nextR * Math.sin(angle);
          data.probeR = nextR;
          if (state.stepIndex < 1) setStep('probe');
        } else if (key === 'q0') {
          const magnitude = clamp(Math.abs(value), 0.2, 3);
          data.probe.q0 = Math.sign(data.probe?.q0 || 1) * magnitude;
        } else if (key === 'dBdt') {
          data.dBdt = clamp(
            value,
            -INDUCED_E_AMP_MAX * INDUCED_E_OMEGA_MAX,
            INDUCED_E_AMP_MAX * INDUCED_E_OMEGA_MAX,
          );
          if (state.stepIndex < 2) setStep('lenz');
        } else if (key === 'bStart') {
          data.bStart = clamp(value, -2.5, 2.5);
          if (!data.auto) data.B = data.bStart;
        } else if (key === 'bEnd') {
          data.bEnd = clamp(value, -2.5, 2.5);
        } else if (key === 'B') {
          data.B = clamp(value, -INDUCED_E_AMP_MAX, INDUCED_E_AMP_MAX);
          if (state.stepIndex < 2) setStep('lenz');
        }
        data.sliderDragging = action === 'induced-e-slider' || payload.live === true;
        // Live slider moves: skip full HUD every pointermove (update loop paints).
        syncInducedElectric(data, !data.sliderDragging);
        return true;
      } else if (action === 'induced-e-mode') {
        const nextAuto = payload.auto !== false;
        data.auto = nextAuto;
        data.showE = nextAuto;
        if (nextAuto) {
          data.paused = false;
          const userRate = Number(data.dBdt || 0);
          const sign = userRate < 0 ? -1 : 1;
          const currB = Number(data.B ?? (sign > 0 ? -2.0 : 2.0));
          if (sign > 0 && (currB >= 2.0 || currB < -2.0)) {
            data.B = -2.0;
          } else if (sign < 0 && (currB <= -2.0 || currB > 2.0)) {
            data.B = 2.0;
          }
          if (state.stepIndex < 2) setStep('lenz');
        }
      } else if (action === 'induced-e-pause') {
        data.paused = !data.paused;
      } else if (action === 'induced-e-flip') {
        data.dBdt = -Number(data.dBdt || 0);
        if (state.stepIndex < 2) setStep('lenz');
      } else if (action === 'induced-e-toggle') {
        const key = {
          B: 'showB', E: 'showE', particles: 'showParticles', probe: 'showProbe',
        }[payload.key];
        if (key) data[key] = !data[key];
      } else if (action === 'induced-e-probe-sign') {
        data.probe.q0 = (Number(payload.sign) < 0 ? -1 : 1) * Math.max(0.2, Math.abs(data.probe.q0));
      } else if (action === 'induced-e-reset') {
        Object.assign(data, initData('induced_electric_field'));
      } else if (action === 'induced-e-complete') {
        data.completed = true;
        state.stepIndex = Math.max(state.stepIndex, 3);
        toast('感生电场实验完成：面内 E∝r，面外 E∝1/r');
      } else {
        return false;
      }
      syncInducedElectric(data);
      return true;
    }
    if (state.expId === 'faraday_induction') {
      const data = state.data;
      if (action === 'faraday-b-set') {
        // Live slider drags fire this every pointermove — never full-HUD refresh
        // here (updateFaraday throttles the content-screen paint).
        if (data.pendingAnim) return true;
        if (!data.sliderDragging && !beginFaradaySlider(data)) return true;
        setFaradaySliderAbsolute(data, payload.value ?? data.B, 0);
        syncFaraday(data, false, 0, payload.live !== true);
        return true;
      }
      if (action === 'faraday-b-slider') {
        // Content-screen hit region action id (not a discrete button). Arm the
        // drag; optional px / value jump the thumb to the aim position.
        if (data.pendingAnim) return true;
        if (!data.sliderDragging && !beginFaradaySlider(data)) return true;
        const fromPick = faradayBFromPick(payload);
        const value = Number.isFinite(payload?.value) ? Number(payload.value) : fromPick;
        if (value != null && Number.isFinite(value)) {
          setFaradaySliderAbsolute(data, value, 0);
        }
        syncFaraday(data, false);
        return true;
      }
      if (action === 'faraday-set') {
        // B / x: live desk (or content) drags arm measurement so current arrows
        // light while Φ changes. target* / animDuration are setup-only.
        // Non-live sets (preset before play, tests) snap values without a gesture.
        if (data.pendingAnim) return true;
        const key = payload.key;
        let value = Number(payload.value);
        if (!Number.isFinite(value) && Number.isFinite(payload.px)) {
          const trackX = Number.isFinite(payload.trackX) ? Number(payload.trackX) : Number(payload.x || 0);
          const trackW = Math.max(1, Number.isFinite(payload.trackW) ? Number(payload.trackW) : Number(payload.w || 1));
          const min = Number(payload.min);
          const max = Number(payload.max);
          if (Number.isFinite(min) && Number.isFinite(max)) {
            const u = clamp((Number(payload.px) - trackX) / trackW, 0, 1);
            value = min + u * (max - min);
          }
        }
        if (!Number.isFinite(value)) return true;
        const live = payload.live === true;
        if (key === 'B') {
          const next = clamp(value, -3, 3);
          if (live) {
            // Don't interleave with rod / x-slider motion.
            if (data.dragging) return true;
            if (!data.sliderDragging && !beginFaradaySlider(data)) return true;
            setFaradaySliderAbsolute(data, next, 0);
          } else if (data.sliderDragging) {
            setFaradaySliderAbsolute(data, next, 0);
          } else {
            data.B = next;
            data._prevB = next;
          }
        } else if (key === 'x') {
          const next = clamp(value, FARADAY_X_MIN, FARADAY_X_MAX);
          if (live) {
            // Don't interleave with B-slider induction measurement.
            if (data.sliderDragging) return true;
            if (!data.dragging) {
              data.dragging = true;
              data.measureMode = 'motion';
              data.motionStart = {
                t0: data._time,
                x0: data.x,
                B: data.B,
                flux0: faradayFlux(data.B, data.x, data.rodLength, data.xEnd),
              };
              data._prevX = data.x;
              data._dragDirection = 0;
              data._dragReverseDistance = 0;
              data.currentSense = 'none';
              data.liveEmf = 0;
            }
            data.x = next;
          } else {
            data.x = next;
          }
        } else if (key === 'targetB') data.targetB = clamp(value, -3, 3);
        else if (key === 'targetX') data.targetX = clamp(value, FARADAY_X_MIN, FARADAY_X_MAX);
        else if (key === 'animDuration') data.animDuration = clamp(value, 0.3, 6);
        else return false;
        // Live drag: light sync; updateFaraday owns sense/E each frame.
        // Release / non-live setup gets a full HUD refresh.
        // Live pointer samples only mutate state. The fixed/render frame owns
        // the expensive apparatus update so input frequency cannot cause
        // duplicate scene work or make B dragging uneven.
        syncFaraday(data, !live, 0, !live);
        return true;
      }
      if (action === 'faraday-channel') {
        const ch = payload.channel === 'x' ? 'x' : 'B';
        data.animChannel = ch;
        syncFaraday(data);
        return true;
      }
      if (action === 'faraday-play') {
        const ok = startFaradayAnim(data, {
          channel: payload.channel || data.animChannel,
          to: payload.to,
          duration: payload.duration,
        });
        if (ok) {
          toast(data.pendingAnim?.channel === 'x'
            ? '动生：铜棒位置动态变化中…'
            : '感生：磁场动态变化中…');
        }
        syncFaraday(data);
        return true;
      }
      if (action === 'faraday-stop') {
        if (data.pendingAnim) stopFaradayAnim(data);
        syncFaraday(data);
        return true;
      }
      if (action === 'faraday-b-step') {
        const delta = Number(payload.delta || 0.2);
        startFaradayBChange(data, data.B + delta, 0.5);
      } else if (action === 'faraday-reverse') {
        startFaradayBChange(data, -data.B, Math.max(0.5, Number(data.animDuration || 1.2) * 0.6));
      } else if (action === 'faraday-toggle-field') {
        data.showField = !data.showField;
      } else if (action === 'faraday-reset') {
        Object.assign(data, initData('faraday_induction'));
      } else if (action === 'faraday-complete') {
        data.completed = true;
        state.stepIndex = Math.max(state.stepIndex, 2);
        toast('法拉第电磁感应实验完成');
      } else {
        return false;
      }
      syncFaraday(data);
      return true;
    }
    if (state.expId === 'electric_field') {
      const data = state.data;
      const charge = selectedElectricCharge(data);
      const probe = data.probe;
      if (action === 'electric-select') {
        const id = Number(payload.id);
        if (data.charges.some((item) => item.id === id)) data.selectedId = id;
      } else if (action === 'electric-set') {
        const key = payload.key;
        const value = Number(payload.value);
        if (!Number.isFinite(value)) return true;
        const onProbe = payload.target === 'probe';
        if (key === 'radius' || key === 'R') {
          data.radius = clamp(value, 1.2, 4.2);
        } else if (onProbe && probe) {
          if (key === 'q0') {
            probe.q0 = Math.sign(probe.q0 || 1) * clamp(Math.abs(value), 0.2, 3);
          } else if (['x', 'y', 'z'].includes(key)) {
            probe[key] = clamp(value, -5, 5);
          } else if (payload.axis) {
            probe[payload.axis] = clamp(value, -5, 5);
          }
        } else if (key === 'q' && charge) {
          charge.q = Math.sign(charge.q || 1) * clamp(Math.abs(value), 0.2, 3);
        } else if (['x', 'y', 'z'].includes(key) && charge) {
          charge[key] = clamp(value, -4.5, 4.5);
        } else if (payload.axis && charge) {
          charge[payload.axis] = clamp(value, -4.5, 4.5);
        }
        syncElectricField(data, payload.live !== true);
        return true;
      } else if (action === 'electric-add') {
        if (data.charges.length >= 12) {
          toast('最多放置 12 个点电荷');
          return true;
        }
        const id = data.nextChargeId++;
        const angle = data.charges.length * 1.9;
        const radius = 1.3;
        data.charges.push({
          id,
          q: Number(payload.sign) < 0 ? -1 : 1,
          x: Math.cos(angle) * radius,
          y: 0.2 * (data.charges.length % 3 - 1),
          z: Math.sin(angle) * radius,
        });
        data.selectedId = id;
      } else if (action === 'electric-delete') {
        if (charge) data.charges = data.charges.filter((item) => item.id !== charge.id);
        data.selectedId = data.charges[0]?.id ?? null;
      } else if (action === 'electric-sign' && charge) {
        charge.q = (Number(payload.sign) < 0 ? -1 : 1) * Math.max(0.2, Math.abs(charge.q));
      } else if (action === 'electric-charge' && charge) {
        const magnitude = clamp(Math.abs(charge.q) + Number(payload.delta || 0), 0.2, 3);
        charge.q = Math.sign(charge.q || 1) * Math.round(magnitude * 10) / 10;
      } else if (action === 'electric-move' && charge) {
        const axis = ['x', 'y', 'z'].includes(payload.axis) ? payload.axis : 'x';
        charge[axis] = clamp(charge[axis] + Number(payload.delta || 0), -4.5, 4.5);
      } else if (action === 'electric-center' && charge) {
        charge.x = 0; charge.y = 0; charge.z = 0;
      } else if (action === 'electric-probe-move') {
        const axis = ['x', 'y', 'z'].includes(payload.axis) ? payload.axis : 'x';
        probe[axis] = clamp(probe[axis] + Number(payload.delta || 0), -5, 5);
      } else if (action === 'electric-probe-charge') {
        const magnitude = clamp(Math.abs(probe.q0) + Number(payload.delta || 0), 0.2, 3);
        probe.q0 = Math.sign(probe.q0 || 1) * Math.round(magnitude * 10) / 10;
      } else if (action === 'electric-probe-sign' || action === 'electric-probe-cycle') {
        if (payload.sign != null && payload.mode !== 'cycle') {
          probe.q0 = (Number(payload.sign) < 0 ? -1 : 1) * Math.max(0.2, Math.abs(probe.q0));
          data.showProbe = true;
        } else {
          // 3-state cycle: 正电荷 (+1.0μC) -> 负电荷 (-1.0μC) -> 隐藏/关闭 -> 正电荷 (+1.0μC)
          const isVisible = data.showProbe !== false;
          const isPositive = Number(probe.q0 ?? 1) >= 0;
          const mag = Math.max(0.2, Math.abs(probe.q0 || 1));
          if (isVisible && isPositive) {
            // 第 1 态 (+) -> 第 2 态 (-)
            data.showProbe = true;
            probe.q0 = -mag;
            toast(`试探电荷已切换为负电荷 (${probe.q0.toFixed(1)}μC)`);
          } else if (isVisible && !isPositive) {
            // 第 2 态 (-) -> 第 3 态 (关闭/隐藏)
            data.showProbe = false;
            if (data.dragTarget === 'probe') data.dragTarget = null;
            toast('试探电荷已隐藏');
          } else {
            // 第 3 态 (隐藏) -> 第 1 态 (+)
            data.showProbe = true;
            probe.q0 = mag;
            toast(`试探电荷已开启（正电荷 +${probe.q0.toFixed(1)}μC）`);
          }
        }
      } else if (action === 'electric-gauss-shape') {
        const shape = String(payload.shape || payload.key || payload.id || 'sphere');
        if (['sphere', 'cube', 'cylinder', 'irregular'].includes(shape)) {
          if (shape === 'irregular') {
            data.gaussSeed = (data.gaussSeed || 0) + 1;
          }
          data.gaussShape = shape;
          data.qEnclosed = gaussEnclosedCharge(data.charges, data.radius, shape, data.gaussSeed || 0);
          data.flux = gaussFlux(data.charges, data.radius, EPSILON_0, shape, data.gaussSeed || 0);
          const labels = { sphere: '球形', cube: '立方体', cylinder: '圆柱体', irregular: '不规则体' };
          toast(`高斯面形状: ${labels[shape] || '球形'}${shape === 'irregular' ? ` (变体 #${data.gaussSeed})` : ''}`);
        }
      } else if (action === 'electric-toggle') {
        if (payload.key === 'equipot') {
          data.showEquipot = !data.showEquipot ? 'flat' : false;
          toast(data.showEquipot ? '等势线已开启' : '等势线已关闭');
        } else {
          const key = {
            lines: 'showLines', arrows: 'showArrows', gauss: 'showGauss', probe: 'showProbe', axes: 'showAxes',
          }[payload.key];
          if (key) data[key] = !data[key];
        }
      } else if (action === 'electric-axis-lock') {
        const axis = String(payload.axis || payload.key || '').toLowerCase();
        if (!['x', 'y', 'z'].includes(axis)) return true;
        if (!data.axisLock || typeof data.axisLock !== 'object') {
          data.axisLock = { x: false, y: false, z: false };
        }
        // Explicit value (desk / tests) or toggle on each click.
        if (payload.locked === true || payload.locked === false) {
          data.axisLock[axis] = payload.locked;
        } else {
          data.axisLock[axis] = !data.axisLock[axis];
        }
        toast(electricAxisLockSummary(data));
      } else if (action === 'electric-formula') {
        data.formulaTab = ['def', 'force', 'point', 'super', 'dipole'].includes(payload.key)
          ? payload.key
          : 'def';
      } else if (action === 'electric-auto') {
        data.autoRotate = !data.autoRotate;
      } else if (action === 'electric-reset-view') {
        data.resetView = (data.resetView || 0) + 1;
      } else if (action === 'electric-reset') {
        Object.assign(data, initData('electric_field'));
      } else if (action === 'electric-complete') {
        data.completed = true;
        toast('静电场探索完成');
      } else {
        return false;
      }
      syncElectricField(data);
      return true;
    }
    if (state.expId === 'hall_carrier_demo') {
      const data = state.data;
      if (action === 'hall-demo-adjust' || action === 'hall-demo-set') {
        const key = payload.key;
        if (action === 'hall-demo-set' && Number.isFinite(Number(payload.value))) {
          const value = Number(payload.value);
          if (key === 'I') data.I = clamp(value, 0, 2);
          if (key === 'B') data.B = clamp(value, -2, 2);
          if (key === 'n') data.n = clamp(value, 0.3, 2.5);
          if (key === 'd') data.d = clamp(value, 0.1, 1.2);
        } else {
          const delta = Number(payload.delta || 0);
          if (key === 'I') data.I = clamp(data.I + delta, 0, 2);
          if (key === 'B') data.B = clamp(data.B + delta, -2, 2);
          if (key === 'n') data.n = clamp(data.n + delta, 0.3, 2.5);
          if (key === 'd') data.d = clamp(data.d + delta, 0.1, 1.2);
        }
        syncHallDemo(data, payload.live !== true);
        return true;
      }
      if (action === 'hall-demo-type') {
        data.nType = payload.nType !== false;
        syncHallDemo(data);
        return true;
      }
      if (action === 'hall-demo-flip') {
        data.B *= -1;
        syncHallDemo(data);
        return true;
      }
      if (action === 'hall-demo-pause') {
        data.paused = !data.paused;
        syncHallDemo(data);
        return true;
      }
      if (action === 'hall-demo-field') {
        if (Math.abs(data.B || 0) > 0.01) {
          data._prevB = data.B;
          data.B = 0;
        } else {
          data.B = data._prevB && Math.abs(data._prevB) > 0.01 ? data._prevB : 1.0;
        }
        syncHallDemo(data);
        return true;
      }
      if (action === 'hall-demo-auto') {
        data.autoCam = !data.autoCam;
        syncHallDemo(data);
        return true;
      }
      if (action === 'hall-demo-reset') {
        Object.assign(data, initData('hall_carrier_demo'));
        syncHallDemo(data);
        return true;
      }
      return false;
    }
    if (state.expId !== 'hall_effect') return false;
    const data = state.data;
    if (action === 'hall-target') {
      const nextTarget = payload.target === 'solenoid' ? 'solenoid' : 'helmholtz';
      if (data.target !== nextTarget) {
        data.target = nextTarget;
        if (data.target === 'helmholtz') {
          if (data.probePos == null || data.probePos > 0.5 || data.probePos < -0.5) {
            data.probePos = 0;
          }
        } else {
          if (data.probePos == null || data.probePos < 1 || data.probePos > 31) {
            data.probePos = 16;
          }
        }
      }
      if (state.stepIndex === 1) advanceStep();
      syncHall(data);
      toast(data.target === 'helmholtz' ? '测量对象：亥姆霍兹线圈' : '测量对象：长螺线管');
      return true;
    }
    if (action === 'hall-identify') {
      // Assist button only confirms the current sequential target (does not skip).
      const next = nextHallPart(data);
      if (!next) {
        toast('器材已全部识别完成');
        return true;
      }
      return identifyHallRole(next);
    }
    if (action === 'hall-adjust' || action === 'hall-set') {
      const key = payload.key;
      if (action === 'hall-set' && Number.isFinite(Number(payload.value))) {
        const value = Number(payload.value);
        if (key === 'Im') data.Im = Math.round(clamp(value, 0, 1) * 1e4) / 1e4;
        if (key === 'Is') data.Is = Math.round(clamp(value > 0.05 ? value / 1000 : value, 0, 0.010) * 1e6) / 1e6;
        if (key === 'probePos') {
          if (data.target === 'solenoid') {
            const raw = clamp(Number(value), 1, 31);
            data.probePos = Math.round(raw / 0.5) * 0.5;
          } else {
            const raw = clamp(Math.abs(value) > 0.5 ? value / 100 : value, -0.25, 0.25);
            data.probePos = Math.round(Math.round(raw / 0.01) * 0.01 * 1e4) / 1e4;
            if (Math.abs(data.probePos) < 1e-6) data.probePos = 0;
          }
        }
        if (key === 'rightCoilPos') {
          const raw = clamp(Math.abs(value) > 0.5 ? value / 100 : value, 0.02, 0.155);
          data.rightCoilPos = Math.round(Math.round(raw / 0.01) * 0.01 * 1e4) / 1e4;
        }
        if (key === 'turns') data.turns = Math.round(clamp(value, 10, 5000) / 10) * 10;
      } else {
        const delta = Number(payload.delta || 0);
        if (key === 'Im') data.Im = Math.round(clamp(data.Im + delta, 0, 1) * 1e4) / 1e4;
        if (key === 'Is') {
          const dIs = Math.abs(delta) > 0.05 ? delta / 1000 : delta;
          data.Is = Math.round(clamp(data.Is + dIs, 0, 0.010) * 1e6) / 1e6;
        }
        if (key === 'probePos') {
          if (data.target === 'solenoid') {
            const dPos = Number(delta || 0);
            const next = clamp(Number(data.probePos ?? 16) + dPos, 1, 31);
            data.probePos = Math.round(next / 0.5) * 0.5;
          } else {
            const dPos = Math.abs(delta) > 0.5 ? delta / 100 : delta;
            const next = clamp(Number(data.probePos ?? 0) + dPos, -0.25, 0.25);
            data.probePos = Math.round(Math.round(next / 0.005) * 0.005 * 1e4) / 1e4;
            if (Math.abs(data.probePos) < 1e-6) data.probePos = 0;
          }
        }
        if (key === 'rightCoilPos') {
          const dCoil = Math.abs(delta) > 0.5 ? delta / 100 : delta;
          const next = clamp(data.rightCoilPos + dCoil, 0.02, 0.155);
          data.rightCoilPos = Math.round(Math.round(next / 0.005) * 0.005 * 1e4) / 1e4;
        }
        if (key === 'turns') data.turns = Math.round(clamp(data.turns + delta, 10, 5000) / 10) * 10;
      }
      if (state.stepIndex <= 2 && data.Im > 0 && data.Is > 0) setStep('scan');
      syncHall(data, payload.live !== true);
      return true;
    }
    if (action === 'hall-direction') {
      toast('请交换 Im 输出端的红黑接线来反转磁场方向');
      return true;
    }
    if (action === 'hall-record') {
      data.vh = calculateHallVoltage(data);
      data.showCurve = false;
      data.tableScrollAuto = true;
      data.tableScrollPx = 0;
      const bTesla = calculateHallField(data);
      const isHelmholtz = data.target === 'helmholtz';
      const rawPos = Number(data.probePos ?? (isHelmholtz ? 0 : 16));
      const posVal = isHelmholtz ? (Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos) : rawPos;
      const cleanPos = Math.abs(posVal) < 1e-6 ? 0 : posVal;
      const rawIs = Number(data.Is || 0);
      const isA = rawIs > 0.05 ? rawIs / 1000 : rawIs;
      const rawCoil = Number(data.rightCoilPos ?? 0.05);
      const coilM = Math.abs(rawCoil) > 0.5 ? rawCoil / 100 : rawCoil;
      const rawLen = Number(data.solenoidLength || 0.30);
      const lenM = rawLen > 1 ? rawLen / 100 : rawLen;
      data.records.push({
        target: data.target,
        coilMode: data.wiring?.coilMode || 'both',
        pos: cleanPos,
        vh: data.vh,
        b: bTesla,
        Im: data.Im,
        Is: isA,
        rightCoilPos: coilM,
        solenoidLength: lenM,
        turns: data.turns,
        direction: data.direction,
        zeroOffset: data.zeroOffset,
        hallK: HALL_K,
      });
      if (data.records.length > 60) data.records.shift();
      if (data.records.length >= 3 && state.stepIndex < 4) setStep('compare');
      data.lastRecordedTime = Date.now();
      data.lastRecordedIndex = data.records.length - 1;
      syncHall(data);

      const count = data.records.length;
      const posText = isHelmholtz ? `${cleanPos.toFixed(3)} m` : `${cleanPos.toFixed(1)} cm`;
      const rawVh = Number(data.vh || 0);
      const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
      const vhText = `${(vhV * 1000).toFixed(2)} mV`;
      const toastMsg = count === 3
        ? `✓ 已记录第 3 组数据 (X=${posText}, VH=${vhText}) · 可拟合曲线`
        : `✓ 已记录第 ${count} 组数据 (X=${posText}, VH=${vhText})`;
      toast(toastMsg);
      return true;
    }
    if (action === 'hall-clear') {
      data.records = [];
      data.showCurve = false;
      data.showFit = false;
      data.tableScrollAuto = true;
      data.tableScrollTop = 0;
      data.tableScrollPx = 0;
      syncHall(data);
      toast('霍尔测量记录已清空');
      return true;
    }
    if (action === 'hall-scroll-table') {
      if (!data.records || !data.records.length || data.showCurve) return false;
      // Prefer layout metrics from the live hit region so fullscreen and 3D
      // panels stay in sync; fall back to a conservative visible-row estimate.
      // NOTE: parameter name is `payload` (see onUiAction signature).
      const maxRows = Number.isFinite(Number(payload?.maxRows))
        ? Math.max(1, Math.round(Number(payload.maxRows)))
        : 8;
      const maxStart = Number.isFinite(Number(payload?.maxStart))
        ? Math.max(0, Math.round(Number(payload.maxStart)))
        : Math.max(0, data.records.length - maxRows);
      if (maxStart <= 0) return false;

      const current = Number.isFinite(data.tableScrollTop) && data.tableScrollTop >= 0 && !data.tableScrollAuto
        ? data.tableScrollTop
        : maxStart;

      // Support both discrete row deltas (wheel notches) and pixel deltas
      // (trackpad / drag). Content follows the finger: drag up → later rows.
      let rowDelta = Number(payload?.delta || 0);
      if (Number.isFinite(Number(payload?.deltaPx))) {
        const rowH = Number.isFinite(Number(payload?.rowH)) && Number(payload.rowH) > 0
          ? Number(payload.rowH)
          : 30;
        data.tableScrollPx = Number(data.tableScrollPx || 0) + Number(payload.deltaPx);
        const steps = Math.trunc(data.tableScrollPx / rowH);
        if (steps !== 0) {
          data.tableScrollPx -= steps * rowH;
          rowDelta += steps;
        }
      }
      if (!rowDelta) return true;

      data.tableScrollAuto = false;
      data.tableScrollTop = Math.max(0, Math.min(maxStart, Math.round(current + rowDelta)));
      syncHall(data);
      return true;
    }
    if (action === 'hall-chart') {
      if (!data.showCurve && data.records.length < 2) {
        toast('至少记录 2 组数据后才能生成曲线');
        return true;
      }
      data.showCurve = !data.showCurve;
      syncHall(data);
      toast(data.showCurve ? '已进入 B–X 磁场分布散点视图' : '已返回实验数据记录');
      return true;
    }
    if (action === 'hall-fit') {
      if (!data.records || data.records.length < 2) {
        toast('至少记录 2 组数据后才能进行曲线拟合');
        return true;
      }
      if (!data.showCurve) {
        data.showCurve = true;
        data.showFit = true;
        syncHall(data);
        toast('已进入曲线视图并拟合 B–X 磁场分布曲线');
        return true;
      }
      data.showFit = !data.showFit;
      syncHall(data);
      toast(data.showFit ? '已拟合生成 B–X 磁场理论分布曲线' : '已隐藏拟合曲线');
      return true;
    }
    if (action === 'hall-export') {
      if (!data.records || data.records.length === 0) {
        toast('暂无记录数据，请先点击「记录当前读数」');
        return true;
      }
      try {
        const res = exportHallDataReport(data);
        if (res && typeof res.then === 'function') {
          res
            .then(() => toast('已打开打印与导出数据页面'))
            .catch((error) => {
              console.error('导出实验数据失败:', error);
              toast('打开导出数据页面失败，请重试');
            });
        } else {
          toast('已打开打印与导出数据页面');
        }
      } catch (error) {
        console.error('导出实验数据失败:', error);
        toast('打开导出数据页面失败，请重试');
      }
      return true;
    }
    if (action === 'hall-complete') {
      data.completed = true;
      state.stepIndex = 5;
      syncHall(data);
      toast('霍尔效应测磁实验完成');
      return true;
    }
    return false;
  }

  function onFocus(target) {
    if (state.expId === 'hall_effect' && currentStep()?.id === 'identify') {
      const role = target?.userData?.role;
      refreshHallIdentifyVisuals(HALL_PART_NAMES[role] ? role : null);
      return;
    }
    if (state.expId === 'electric_field' && state.data) {
      const role = target?.userData?.role;
      if (role !== state.data._lastFocusRole) {
        state.data._lastFocusRole = role;
        if (role === 'electric_charge') {
          const id = resolveChargeId(target);
          const idx = state.data.charges.findIndex((item) => item.id === id);
          if (idx >= 0) toast(`已瞄准场源电荷 q${idx + 1}；按住拖动或滚轮微调`);
        } else if (role === 'electric_probe') {
          toast('已瞄准试探电荷 q₀；按住拖动移动位置');
        }
      }
    }
  }

  function armHallCameraDrag(kind, value) {
    const data = state.data;
    data.hallDragArmed = true;
    data.hallDragging = false;
    data.hallDragMoved = false;
    data.hallHoldAccum = 0;
    data.hallDragKind = kind;
    data.hallDragOffset = null;
    data.hallDragStartValue = Number(value || 0);
    data.hallDragStartMouseX = Number(equipment.electro?.mouseDrag?.movementX || 0);
  }


  function interact(target, _time, step) {
    if (state.expId === 'induced_electric_field') {
      const data = state.data;
      if (target?.userData?.role === 'induced_e_probe') {
        data.dragging = true;
        data.dragStart = {
          x: Number(data.probe?.x || 0),
          z: Number(data.probe?.z || 0),
        };
        data.dragMouseX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        data.dragMouseY = Number(equipment.electro?.mouseDrag?.movementY || 0);
        toast('已抓住试探电荷：在水平面拖动改变 r，观察 E∝r / E∝1/r');
        if (state.stepIndex < 1) setStep('probe');
        syncInducedElectric(data);
        return true;
      }
      if (target?.userData?.role === 'ui_action') return onUiAction('induced-e-complete');
      return false;
    }
    if (state.expId === 'faraday_induction') {
      if (target?.userData?.role === 'faraday_rod') {
        const data = state.data;
        if (data.pendingAnim || data.sliderDragging) return true;
        data.dragging = true;
        data.measureMode = 'motion';
        data.motionStart = {
          t0: data._time,
          x0: data.x,
          B: data.B,
          flux0: faradayFlux(data.B, data.x, data.rodLength, data.xEnd),
        };
        data._prevX = data.x;
        data._dragDirection = 0;
        data._dragReverseDistance = 0;
        data.currentSense = 'none';
        data.dragOffsetSimX = null;
        data.dragMouseX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        data.dragMouseY = Number(equipment.electro?.mouseDrag?.movementY || 0);
        toast('已抓住铜棒：沿导轨拖动，松开后显示动生电动势');
        syncFaraday(data);
        return true;
      }
      if (target?.userData?.role === 'ui_action') return onUiAction('faraday-complete');
      return false;
    }
    if (state.expId === 'electric_field') {
      const data = state.data;
      if (target?.userData?.role === 'electric_charge') {
        const id = resolveChargeId(target);
        if (!data.charges.some((charge) => charge.id === id)) return false;
        data.selectedId = id;
        const charge = selectedElectricCharge(data);
        if (!charge) return false;
        data.dragTarget = 'charge';
        data.dragging = true;
        data.dragStart = { x: charge.x, y: charge.y, z: charge.z };
        data.dragMouseX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        data.dragMouseY = Number(equipment.electro?.mouseDrag?.movementY || 0);
        syncElectricField(data);
        toast(`已选中 q${data.charges.findIndex((item) => item.id === id) + 1}；${electricAxisLockSummary(data)}`);
        return true;
      }
      if (target?.userData?.role === 'electric_probe') {
        data.dragTarget = 'probe';
        data.dragging = true;
        data.dragStart = { ...data.probe };
        data.dragMouseX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        data.dragMouseY = Number(equipment.electro?.mouseDrag?.movementY || 0);
        toast(`已选中试探电荷 q₀；${electricAxisLockSummary(data)}`);
        return true;
      }
      if (target?.userData?.role === 'ui_action') return onUiAction('electric-complete');
      return false;
    }
    if (state.expId === 'gauss_theorem') {
      if (target?.userData?.role === 'gauss_charge') {
        const data = state.data;
        const id = resolveChargeId(target);
        if (data.charges.some((charge) => charge.id === id)) data.selectedId = id;
        const charge = selectedGaussCharge(data);
        if (!charge) return false;
        data.dragArmed = true;
        data.dragging = false;
        data.dragStartX = charge.x;
        data.dragStartY = charge.y;
        data.dragMouseX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        data.dragMouseY = Number(equipment.electro?.mouseDrag?.movementY || 0);
        syncGauss(data);
        toast(`已抓住 Q${data.charges.findIndex((item) => item.id === id) + 1}；拖动改变 X/Y，滚轮微调 Z`);
        return true;
      }
      if (target?.userData?.role === 'gauss_surface') {
        return onUiAction('gauss-radius', { delta: 0.1 });
      }
      if (target?.userData?.role === 'ui_action') return onUiAction('gauss-complete');
      return false;
    }
    if (state.expId === 'hall_carrier_demo') {
      if (target?.userData?.role === 'ui_action') return onUiAction('hall-demo-pause');
      return false;
    }
    const role = target?.userData?.role;
    const terminalKey = HALL_TERMINAL_KEYS[role];
    const portId = target?.userData?.portId;
    if (terminalKey && portId) {
      const data = state.data;
      const existingWire = (data.wires || []).find((pair) => {
        const [a, b] = Array.isArray(pair) ? pair : [pair?.from, pair?.to];
        return a === portId || b === portId;
      });
      if (existingWire) {
        const [a, b] = Array.isArray(existingWire) ? existingWire : [existingWire.from, existingWire.to];
        const fixedEnd = (a === portId) ? b : a;
        data.wires = (data.wires || []).filter((pair) => pair !== existingWire);
        data.terminalDragFrom = fixedEnd;
        data.terminalOriginalFrom = portId;
        data.terminalDragGroup = terminalKey;
        data.terminalSnapPort = null;
        equipment.electro?.startHallWirePreview?.(fixedEnd);
        toast(`已拔出该插头：拖动至新端口接线（松开在原处或空白处取消）`);
        syncHall(data);
        return true;
      }
      data.terminalDragFrom = portId;
      data.terminalOriginalFrom = null;
      data.terminalDragGroup = terminalKey;
      data.terminalSnapPort = null;
      equipment.electro?.startHallWirePreview?.(portId);
      toast('已抓住接线端：按住鼠标，将准星拖到另一个端口后松开');
      return true;
    }
    if (step.id === 'identify') {
      // Any valid apparatus: sequential check inside identifyHallRole (wrong order = tip).
      if (HALL_PART_NAMES[role]) return identifyHallRole(role);
      if (role === 'ui_action') {
        const next = nextHallPart(state.data);
        return next ? identifyHallRole(next) : true;
      }
      return identifyHallWrong(role || 'generic');
    }
    const data = state.data;
    if (role === 'hall_helmholtz') {
      data.target = 'helmholtz';
      if (state.stepIndex === 1) advanceStep();
      armHallCameraDrag('rightCoilPos', data.rightCoilPos);
      syncHall(data);
      toast('已选择亥姆霍兹线圈；按住并转动镜头可移动右线圈');
      return true;
    }
    if (role === 'hall_solenoid') {
      data.target = 'solenoid';
      if (state.stepIndex === 1) advanceStep();
      armHallCameraDrag('turns', data.turns);
      syncHall(data);
      toast('已选择长螺线管；按住并转动镜头可调节匝数');
      return true;
    }
    if (role === 'hall_probe') {
      armHallCameraDrag('probePos', data.probePos);
      toast('已抓住霍尔探头：按住左键并转动视角沿标尺移动');
      return true;
    }
    if (role === 'hall_knob_im') {
      armHallCameraDrag('Im', data.Im);
      toast('已抓住 Im 旋钮：按住并转动镜头连续调节');
      return true;
    }
    if (role === 'hall_knob_is') {
      armHallCameraDrag('Is', data.Is);
      toast('已抓住 Is 旋钮：按住并转动镜头连续调节');
      return true;
    }
    if (role === 'hall_knob_zero') {
      data.zeroOffset -= data.vh;
      syncHall(data);
      toast('霍尔电压已调零');
      return true;
    }
    // The console-wide hit box exists for apparatus recognition only.  Once
    // recognition is complete it must not behave like the record button:
    // otherwise clicking a readout, label, or any empty part of the physical
    // instrument records a measurement.  Recording stays available through
    // the explicit hologram/accessible UI action and the F shortcut.
    if (role === 'ui_action') return onUiAction('hall-record');
    return false;
  }

  function onKey(code) {
    if (state.expId === 'induced_electric_field') {
      if (code === 'KeyP') return onUiAction('induced-e-pause');
      if (code === 'KeyR') return onUiAction('induced-e-reset');
      if (code === 'KeyF') return onUiAction('induced-e-complete');
      if (code === 'KeyB') return onUiAction('induced-e-flip');
      return false;
    }
    if (state.expId === 'faraday_induction') {
      if (code === 'KeyR') return onUiAction('faraday-reset');
      if (code === 'KeyF') return onUiAction('faraday-complete');
      if (code === 'KeyB') return onUiAction('faraday-reverse');
      return false;
    }
    if (state.expId === 'electric_field') {
      if (code === 'KeyR') return onUiAction('electric-reset');
      if (code === 'KeyF') return onUiAction('electric-complete');
      // X / Y / Z toggle axis locks for single-axis mouse drag.
      if (code === 'KeyX') return onUiAction('electric-axis-lock', { axis: 'x' });
      if (code === 'KeyY') return onUiAction('electric-axis-lock', { axis: 'y' });
      if (code === 'KeyZ') return onUiAction('electric-axis-lock', { axis: 'z' });
      return false;
    }
    if (state.expId === 'gauss_theorem') {
      if (code === 'KeyR') return onUiAction('gauss-reset');
      if (code === 'KeyF') return onUiAction('gauss-complete');
      return false;
    }
    if (state.expId === 'hall_carrier_demo') {
      if (code === 'KeyP') return onUiAction('hall-demo-pause');
      if (code === 'KeyR') return onUiAction('hall-demo-reset');
      return false;
    }
    if (state.expId !== 'hall_effect') return false;
    if (code === 'KeyF') return onUiAction('hall-record');
    if (code === 'KeyR') return onUiAction('hall-direction');
    return false;
  }

  function resolveTableScrollPick(target, pick) {
    if (pick?.action === 'hall-scroll-table' || pick?.role === 'scrollable_table') return pick;
    const regions = target?.userData?.hitRegions;
    if (!Array.isArray(regions)) return pick || null;
    return regions.find((h) => h?.action === 'hall-scroll-table' || h?.role === 'scrollable_table') || pick || null;
  }

  function onWheel(delta, target, pick) {
    if (state.expId === 'induced_electric_field') {
      if (target?.userData?.role === 'induced_e_probe') {
        const sign = Number(delta) > 0 ? 1 : -1;
        return onUiAction('induced-e-adjust', { key: 'probeR', delta: sign * 0.12 });
      }
      return false;
    }
    if (state.expId === 'faraday_induction') {
      if (target?.userData?.role === 'faraday_rod') {
        const sign = Number(delta) > 0 ? 1 : -1;
        state.data.x = clamp(state.data.x + sign * 0.08, state.data.xMin, state.data.xMax);
        syncFaraday(state.data);
        return true;
      }
      return false;
    }
    if (state.expId === 'electric_field') {
      // Wheel → world Z when unlocked (X/Y stay on drag).
      if (electricAxisLock(state.data).z) return false;
      const step = delta > 0 ? -0.2 : 0.2;
      const role = target?.userData?.role;
      // Prefer the live drag target, then aim role, then last selection.
      if (state.data.dragging && state.data.dragTarget === 'probe') {
        return onUiAction('electric-probe-move', { axis: 'z', delta: step });
      }
      if (state.data.dragging && state.data.dragTarget === 'charge') {
        return onUiAction('electric-move', { axis: 'z', delta: step });
      }
      if (role === 'electric_probe') {
        return onUiAction('electric-probe-move', { axis: 'z', delta: step });
      }
      const chargeId = Number(target?.userData?.chargeId ?? state.data.selectedId);
      if (state.data.charges.some((charge) => charge.id === chargeId)) {
        state.data.selectedId = chargeId;
        return onUiAction('electric-move', { axis: 'z', delta: step });
      }
      if (state.data.selectedId != null || state.data.dragTarget === 'probe') {
        // Slight aim miss while still focused on last probe/charge.
        if (state.data.dragTarget === 'probe' || role === 'electric_probe') {
          return onUiAction('electric-probe-move', { axis: 'z', delta: step });
        }
      }
      return false;
    }
    if (state.expId === 'gauss_theorem') {
      const chargeId = Number(target?.userData?.chargeId ?? state.data.selectedId);
      if (state.data.charges.some((charge) => charge.id === chargeId)) state.data.selectedId = chargeId;
      return onUiAction('gauss-move', { axis: 'z', delta: delta > 0 ? -0.15 : 0.15 });
    }
    if (state.expId !== 'hall_effect' || currentStep()?.id === 'identify') return false;

    const scrollPick = resolveTableScrollPick(target, pick);
    const onDisplay = target?.userData?.type === 'holo_display'
      || target?.userData?.role === 'holo_display'
      || scrollPick?.action === 'hall-scroll-table'
      || scrollPick?.role === 'scrollable_table';
    // Any wheel over the content display (or the table hit region) owns the
    // data log when the record view is open — equipment knobs only receive
    // the wheel after the table cannot use it.
    if (onDisplay && !state.data.showCurve && state.data.records?.length > 0) {
      const deltaY = Number(delta || 0);
      if (!deltaY) return false;
      // Pixel residual keeps trackpads smooth; a full mouse notch (~100px)
      // advances several rows via the same path as drag scrolling.
      return onUiAction('hall-scroll-table', {
        deltaPx: deltaY,
        rowH: scrollPick?.rowH,
        maxRows: scrollPick?.maxRows,
        maxStart: scrollPick?.maxStart,
      });
    }
    const role = target?.userData?.role;
    const sign = delta > 0 ? -1 : 1;
    if (role === 'hall_probe') return onUiAction('hall-adjust', { key: 'probePos', delta: sign });
    if (role === 'hall_helmholtz') return onUiAction('hall-adjust', { key: 'rightCoilPos', delta: sign * 0.5 });
    if (role === 'hall_solenoid') return onUiAction('hall-adjust', { key: 'turns', delta: sign * 10 });
    if (role === 'hall_knob_im') return onUiAction('hall-adjust', { key: 'Im', delta: sign * 0.05 });
    if (role === 'hall_knob_is') return onUiAction('hall-adjust', { key: 'Is', delta: sign * 0.5 });
    return false;
  }

  function holdInteract(holding, _time, dt, target, raycaster = null) {
    if (state.expId === 'induced_electric_field') {
      const data = state.data;
      // Content-screen sliders: continuous path via cumulative mouse deltas.
      // sliderDragOriginX rebases after absolute UV jumps so relative + absolute
      // never fight (unlocked desktop updates the ray; pointer-lock uses relative).
      if (holding && data.sliderDragging && data.sliderKey) {
        const totalX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        const origin = Number(data.sliderDragOriginX || 0);
        applyInducedSliderRelative(data, totalX - origin);
        return;
      }
      if (!holding && data.sliderDragging) {
        finishInducedSlider(data);
        return;
      }
      if (holding && data.dragging && data.dragStart) {
        if (raycaster && applyInducedProbeDragRaycast(data, raycaster)) {
          return;
        }
        const dx = Number(equipment.electro?.mouseDrag?.movementX || 0) - Number(data.dragMouseX || 0);
        const dy = Number(equipment.electro?.mouseDrag?.movementY || 0) - Number(data.dragMouseY || 0);
        applyInducedProbeDrag(data, dx, dy);
        return;
      }
      if (!holding && data.dragging) {
        data.dragging = false;
        data.dragStart = null;
        syncInducedElectric(data);
      }
      return;
    }
    if (state.expId === 'faraday_induction') {
      const data = state.data;
      if (holding && data.sliderDragging && data.sliderStart) {
        // Only write B here. updateFaraday (same frame) owns the single visual sync.
        const totalX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        applyFaradaySliderRelative(data, totalX);
        return;
      }
      if (!holding && data.sliderDragging) {
        finishFaradaySlider(data);
        syncFaraday(data);
        return;
      }
      if (holding && data.dragging && data.motionStart) {
        if (raycaster && applyFaradayDragRaycast(data, raycaster, { dt })) {
          return;
        }
        const totalX = Number(equipment.electro?.mouseDrag?.movementX || 0) - Number(data.dragMouseX || 0);
        const nextX = clamp(data.motionStart.x0 + totalX * 0.015, data.xMin, data.xMax);
        if (Math.abs(nextX - data.x) > 1e-6) {
          const visualDt = Math.max(Number(dt) || 0, 1 / 60);
          const dx = nextX - data.x;
          data.x = nextX;
          updateFaradayDragCurrent(data, dx, visualDt);
          data._prevX = nextX;
          syncFaraday(data, false, visualDt);
        }
        return;
      }
      if (!holding && data.dragging) {
        finishFaradayMotion(data);
        syncFaraday(data);
      }
      return;
    }
    if (state.expId === 'electric_field') {
      const data = state.data;
      if (holding && data.dragging && data.dragStart) {
        if (raycaster && applyElectricDragRaycast(data, raycaster)) {
          return;
        }
        const { dx, dy } = mouseDragDelta(data);
        data._dragShiftZ = !!equipment.electro?.mouseDrag?.shiftKey;
        // Position only; update() owns the single per-frame visual sync.
        applyElectricDragDelta(data, dx, dy, dt);
        return;
      }
      if (!holding && data.dragging) {
        data.dragging = false;
        data.dragTarget = null;
        data.dragStart = null;
        data._dragShiftZ = false;
        // Release rebuilds field decorations (deferred inside equipment).
        syncElectricField(data);
      }
      return;
    }
    if (state.expId === 'gauss_theorem') {
      const data = state.data;
      if (holding && data.dragArmed) {
        if (raycaster && applyGaussDragRaycast(data, raycaster)) {
          return;
        }
        const { dx, dy } = mouseDragDelta(data);
        // Position only; update() owns the single per-frame visual sync.
        applyGaussDragDelta(data, dx, dy, dt);
        return;
      }
      if (!holding && data.dragArmed) {
        data.dragArmed = false;
        data.dragging = false;
        syncGauss(data);
      }
      return;
    }
    if (state.expId !== 'hall_effect') return;
    const data = state.data;
    if (data.terminalDragFrom) {
      const hoverPortId = target?.userData?.portId || null;
      if (holding) {
        data.terminalSnapPort = equipment.electro?.updateHallWirePreview?.(
          data.terminalDragFrom,
          raycaster || equipment.electro?.getCamera?.(),
          hoverPortId,
        ) || null;
        return;
      }
      const from = data.terminalDragFrom;
      const to = hoverPortId || data.terminalSnapPort;
      const orig = data.terminalOriginalFrom;
      if (to && to !== from) {
        const retained = (data.wires || []).filter((pair) => {
          const [a, b] = Array.isArray(pair) ? pair : [pair?.from, pair?.to];
          return a !== from && b !== from && a !== to && b !== to;
        });
        retained.push([from, to]);
        data.wires = retained;
        applyWiringState(data);
        if (data.wiring.energized) {
          toast(`接线完成：Im 输出已${data.wiring.reversed ? '反向' : '正向'}接入${data.wiring.label}`);
        } else {
          toast('导线已连接，但 Im 输出回路尚未按规则闭合');
        }
      } else if (orig && to === orig) {
        const retained = (data.wires || []).filter((pair) => {
          const [a, b] = Array.isArray(pair) ? pair : [pair?.from, pair?.to];
          return a !== from && b !== from && a !== orig && b !== orig;
        });
        retained.push([from, orig]);
        data.wires = retained;
        applyWiringState(data);
        toast('导线已放回原端口');
      } else {
        const initialLen = (data.wires || []).length;
        const retained = (data.wires || []).filter((pair) => {
          const [a, b] = Array.isArray(pair) ? pair : [pair?.from, pair?.to];
          return a !== from && b !== from;
        });
        if (retained.length < initialLen || orig) {
          data.wires = retained;
          toast('已拔出并移除该导线');
        } else {
          toast('未对准另一个接线口，已取消接线');
        }
      }
      data.terminalDragFrom = null;
      data.terminalOriginalFrom = null;
      data.terminalDragGroup = null;
      data.terminalSnapPort = null;
      equipment.electro?.cancelHallWirePreview?.();
      syncHall(data);
      return;
    }
    if (currentStep()?.id === 'identify') return;
    if (holding && data.hallDragArmed) {
      data.hallHoldAccum = (data.hallHoldAccum || 0) + dt;
      if (!data.hallDragging && data.hallHoldAccum > 0.08) data.hallDragging = true;
      if (!data.hallDragging) return;
      const kind = data.hallDragKind;
      if (raycaster && (kind === 'probePos' || kind === 'rightCoilPos')) {
        const hitX = getHallRayHitX(raycaster, data);
        if (hitX != null) {
          data.hallDragMoved = true;
          if (kind === 'probePos') {
            const targetSolenoid = data?.target === 'solenoid';
            if (targetSolenoid) {
              const hitSimPos = -hitX * 25;
              if (!Number.isFinite(data.hallDragOffset)) {
                const rawProbe = Number(data.probePos ?? 16);
                data.hallDragOffset = rawProbe - hitSimPos;
              }
              const raw = clamp(hitSimPos + (data.hallDragOffset || 0), 1, 31);
              data.probePos = Math.round(raw / 0.5) * 0.5;
            } else {
              const rawCoil = Number(data.rightCoilPos ?? 0.05);
              const coilM = Math.max(0.01, Math.abs(rawCoil) > 0.5 ? rawCoil / 100 : rawCoil);
              const xRightCoil = -0.06 + clamp((coilM - 0.02) / 0.135, 0, 1) * 0.34;
              const scale = (xRightCoil + 0.14) / coilM;
              const hitSimPos = (hitX - (-0.12)) / Math.max(1e-4, scale);
              if (!Number.isFinite(data.hallDragOffset)) {
                const rawProbe = Number(data.probePos ?? 0);
                const probeM = Math.abs(rawProbe) > 0.5 ? rawProbe / 100 : rawProbe;
                data.hallDragOffset = probeM - hitSimPos;
              }
              const raw = clamp(hitSimPos + (data.hallDragOffset || 0), -0.25, 0.25);
              data.probePos = Math.round(Math.round(raw / 0.005) * 0.005 * 1e4) / 1e4;
            }
          } else if (kind === 'rightCoilPos') {
            const hitCoilPos = ((hitX + 0.06) / 0.34) * 0.135 + 0.02;
            if (!Number.isFinite(data.hallDragOffset)) {
              const rawCoil = Number(data.rightCoilPos ?? 0.05);
              const coilM = Math.abs(rawCoil) > 0.5 ? rawCoil / 100 : rawCoil;
              data.hallDragOffset = coilM - hitCoilPos;
            }
            const raw = clamp(hitCoilPos + (data.hallDragOffset || 0), 0.02, 0.155);
            data.rightCoilPos = Math.round(Math.round(raw / 0.005) * 0.005 * 1e4) / 1e4;
          }
          if (state.stepIndex <= 2 && data.Im > 0 && data.Is > 0) setStep('scan');
          syncHall(data, false);
          return;
        }
      }
      const mouseX = Number(equipment.electro?.mouseDrag?.movementX || 0);
      const deltaPx = mouseX - Number(data.hallDragStartMouseX || 0);
      const start = Number(data.hallDragStartValue || 0);
      if (Math.abs(deltaPx) > 2) data.hallDragMoved = true;
      if (kind === 'probePos') {
        const targetSolenoid = data?.target === 'solenoid';
        if (targetSolenoid) {
          const raw = clamp(start - deltaPx * 0.05, 1, 31);
          data.probePos = Math.round(raw / 0.5) * 0.5;
        } else {
          const raw = clamp(start + deltaPx * 0.0005, -0.25, 0.25);
          data.probePos = Math.round(Math.round(raw / 0.005) * 0.005 * 1e4) / 1e4;
        }
      }
      if (kind === 'rightCoilPos') {
        const raw = clamp(start + deltaPx * 0.0002, 0.02, 0.155);
        data.rightCoilPos = Math.round(Math.round(raw / 0.005) * 0.005 * 1e4) / 1e4;
      }
      if (kind === 'turns') data.turns = Math.round(clamp(start + deltaPx, 10, 5000) / 10) * 10;
      if (kind === 'Im') data.Im = clamp(start + deltaPx * 0.0025, 0, 1);
      if (kind === 'Is') data.Is = clamp(start + deltaPx * 0.000025, 0, 0.010);
      if (kind && state.stepIndex <= 2 && data.Im > 0 && data.Is > 0) setStep('scan');
      syncHall(data, false);
      return;
    }
    if (!holding && data.hallDragArmed) {
      const kind = data.hallDragKind;
      data.hallDragArmed = false;
      data.hallDragging = false;
      data.hallHoldAccum = 0;
      data.hallDragKind = null;
      data.hallDragOffset = null;
      syncHall(data);
      const isHelmholtz = data.target === 'helmholtz';
      const rawProbe = Number(data.probePos ?? (isHelmholtz ? 0 : 16));
      const probeVal = isHelmholtz ? (Math.abs(rawProbe) > 0.5 ? rawProbe / 100 : rawProbe) : rawProbe;
      const cleanProbe = Math.abs(probeVal) < 1e-6 ? 0 : probeVal;
      const rawCoil = Number(data.rightCoilPos ?? 0.05);
      const coilM = Math.abs(rawCoil) > 0.5 ? rawCoil / 100 : rawCoil;
      const rawIs = Number(data.Is || 0);
      const isA = rawIs > 0.05 ? rawIs / 1000 : rawIs;
      const labels = {
        probePos: isHelmholtz ? `探头 X = ${cleanProbe.toFixed(3)} m` : `探杆刻度 X = ${cleanProbe.toFixed(1)} cm`,
        rightCoilPos: `右线圈位置 = ${coilM.toFixed(3)} m`,
        turns: `螺线管匝数 N = ${data.turns}`,
        Im: `励磁电流 Im = ${data.Im.toFixed(3)} A`,
        Is: `霍尔电流 Is = ${isA.toFixed(3)} A`,
      };
      toast(labels[kind] || '调节完成');
    }
  }

  function armTableScrollDrag(target, pick) {
    if (state.expId !== 'hall_effect' || !state.data) return false;
    if (state.data.showCurve || !state.data.records?.length) return false;
    const scrollPick = resolveTableScrollPick(target, pick);
    if (!scrollPick || (scrollPick.action !== 'hall-scroll-table' && scrollPick.role !== 'scrollable_table')) {
      return false;
    }
    const maxStart = Number.isFinite(Number(scrollPick.maxStart))
      ? Math.max(0, Math.round(Number(scrollPick.maxStart)))
      : Math.max(0, state.data.records.length - Math.max(1, Number(scrollPick.maxRows) || 8));
    // Nothing to scroll when every row already fits the viewport.
    if (maxStart <= 0 || scrollPick.scrollable === false) return false;

    state.data.tableScrollDrag = {
      armed: true,
      moved: false,
      maxRows: scrollPick.maxRows,
      maxStart: scrollPick.maxStart,
      rowH: scrollPick.rowH,
      screen: target,
    };
    return true;
  }

  function applyTableScrollDrag(context = {}) {
    const drag = state.data?.tableScrollDrag;
    if (!drag?.armed) return false;

    // Prefer live layout metrics from the content screen hit list.
    const live = resolveTableScrollPick(drag.screen || context.target, null) || drag;
    drag.maxRows = live.maxRows ?? drag.maxRows;
    drag.maxStart = live.maxStart ?? drag.maxStart;
    drag.rowH = live.rowH ?? drag.rowH;

    const dy = Number(context.dy || 0);
    if (Math.abs(dy) < 0.35) return true;
    drag.moved = true;
    // Same sign convention as fullscreen pointer drag: hand/cursor up → later rows.
    onUiAction('hall-scroll-table', {
      deltaPx: -dy,
      rowH: drag.rowH,
      maxRows: drag.maxRows,
      maxStart: drag.maxStart,
    });
    return true;
  }

  function clearTableScrollDrag() {
    if (!state.data?.tableScrollDrag) return false;
    state.data.tableScrollDrag = null;
    return true;
  }

  function beginManipulation(target, context = {}) {
    if (state.expId === 'induced_electric_field') {
      let pick = context.pick?.action === 'induced-e-slider' ? context.pick : null;
      if (!pick && context.raycaster && target?.userData?.pickFromRay) {
        const live = target.userData.pickFromRay(context.raycaster);
        if (live?.action === 'induced-e-slider') pick = live;
      }
      if (pick?.action === 'induced-e-slider') {
        const data = state.data;
        data.sliderDragging = true;
        data.sliderKey = pick.key || null;
        data.sliderDragBase = inducedSliderBaseValue(data, pick.key);
        data.sliderDragOriginX = Number(equipment.electro?.mouseDrag?.movementX || 0);
        // Jump thumb to aim when the pick has an absolute canvas x.
        onUiAction('induced-e-slider', { ...pick, live: true });
        // Re-base relative drag after absolute jump so subsequent movementX
        // deltas stay continuous from the new value.
        data.sliderDragBase = inducedSliderBaseValue(data, pick.key);
        return true;
      }
      return interact(target, context.time || 0, currentStep());
    }
    if (state.expId === 'faraday_induction') {
      let pick = context.pick?.action === 'faraday-b-slider' ? context.pick : null;
      // AR / direct ray: resolve slider hit from the content-screen mesh.
      if (!pick && context.raycaster && target?.userData?.pickFromRay) {
        const live = target.userData.pickFromRay(context.raycaster);
        if (live?.action === 'faraday-b-slider') pick = live;
      }
      if (pick?.action === 'faraday-b-slider') {
        if (!beginFaradaySlider(state.data) && !state.data.sliderDragging) return true;
        const value = faradayBFromPick(pick);
        if (value != null) setFaradaySliderAbsolute(state.data, value, 0);
        syncFaraday(state.data);
        return true;
      }
      if (target?.userData?.role === 'faraday_rod') {
        const ok = interact(target, context.time || 0, currentStep());
        if (context.raycaster) {
          const root = resolveElectroApparatusRoot('faraday');
          if (root) {
            if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
            if (root.matrixWorld) {
              _invMat.copy(root.matrixWorld).invert();
              _localRay.copy(context.raycaster.ray).applyMatrix4(_invMat);
            } else {
              _localRay.copy(context.raycaster.ray);
            }
          } else {
            _localRay.copy(context.raycaster.ray);
          }
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(FARADAY_Y * FARADAY_SCALE));
          const hit = new THREE.Vector3();
          if (_localRay.intersectPlane(plane, hit)) {
            const hitSimX = (hit.x - FARADAY_OFFSET_X) / FARADAY_SCALE;
            state.data.dragOffsetSimX = clamp(state.data.x - hitSimX, -0.3, 0.3);
          }
        }
        return ok;
      }
    }
    if (state.expId === 'hall_effect') {
      if (armTableScrollDrag(target, context.pick || null)) return true;
      if (context.raycaster && target?.userData?.pickFromRay) {
        const pick = target.userData.pickFromRay(context.raycaster);
        if (armTableScrollDrag(target, pick)) return true;
      }
      const ok = interact(target, context.time || 0, currentStep());
      const role = target?.userData?.role;
      if (ok && context.raycaster && (role === 'hall_probe' || role === 'hall_helmholtz')) {
        const data = state.data;
        const hitX = getHallRayHitX(context.raycaster, data);
        if (hitX != null) {
          if (role === 'hall_probe') {
            const targetSolenoid = data?.target === 'solenoid';
            if (targetSolenoid) {
              const rawProbe = Number(data.probePos ?? 16);
              const hitSimPos = -hitX * 25;
              data.hallDragOffset = rawProbe - hitSimPos;
            } else {
              const rawCoil = Number(data.rightCoilPos ?? 0.05);
              const coilM = Math.max(0.01, Math.abs(rawCoil) > 0.5 ? rawCoil / 100 : rawCoil);
              const xRightCoil = -0.06 + clamp((coilM - 0.02) / 0.135, 0, 1) * 0.34;
              const scale = (xRightCoil + 0.14) / coilM;
              const hitSimPos = (hitX - (-0.12)) / Math.max(1e-4, scale);
              const rawProbe = Number(data.probePos ?? 0);
              const probeM = Math.abs(rawProbe) > 0.5 ? rawProbe / 100 : rawProbe;
              data.hallDragOffset = probeM - hitSimPos;
            }
          } else if (role === 'hall_helmholtz') {
            const rawCoil = Number(data.rightCoilPos ?? 0.05);
            const coilM = Math.abs(rawCoil) > 0.5 ? rawCoil / 100 : rawCoil;
            const hitCoilPos = ((hitX + 0.06) / 0.34) * 0.135 + 0.02;
            data.hallDragOffset = coilM - hitCoilPos;
          }
        }
      }
      return ok;
    }
    if (armTableScrollDrag(target, context.pick || null)) return true;
    // AR / direct ray: resolve table pick from the ray if the caller only
    // supplied the screen host (common when the hand locks the display mesh).
    if (context.raycaster && target?.userData?.pickFromRay) {
      const pick = target.userData.pickFromRay(context.raycaster);
      if (armTableScrollDrag(target, pick)) return true;
    }
    return interact(target, context.time || 0, currentStep());
  }

  function updateManipulation(_target, context = {}) {
    if (state.expId === 'induced_electric_field') {
      const data = state.data;
      if (data?.sliderDragging) {
        // Prefer absolute UV pick when the ray still hits this slider track
        // (unlocked desktop / AR following the thumb).
        if (context.raycaster && _target?.userData?.pickFromRay) {
          const live = _target.userData.pickFromRay(context.raycaster);
          if (live?.action === 'induced-e-slider'
            && (!data.sliderKey || live.key === data.sliderKey)
            && Number.isFinite(live.px)) {
            onUiAction('induced-e-slider', { ...live, live: true });
            data.sliderDragBase = inducedSliderBaseValue(data, data.sliderKey);
            data.sliderDragOriginX = Number(
              Number.isFinite(context.totalX)
                ? context.totalX
                : (equipment.electro?.mouseDrag?.movementX || 0),
            );
            return true;
          }
        }
        // Relative fallback (pointer-lock totals or when UV leaves the track).
        const totalX = Number.isFinite(context.totalX)
          ? Number(context.totalX)
          : Number(equipment.electro?.mouseDrag?.movementX || 0);
        const origin = Number(data.sliderDragOriginX || 0);
        applyInducedSliderRelative(data, totalX - origin);
        return true;
      }
      if (data?.dragging && data.dragStart) {
        if (context.raycaster && applyInducedProbeDragRaycast(data, context.raycaster)) {
          return true;
        }
        if (
          Number.isFinite(context.totalX)
          || Number.isFinite(context.totalY)
          || Number.isFinite(context.dx)
          || Number.isFinite(context.dy)
        ) {
          const dx = Number.isFinite(context.totalX)
            ? Number(context.totalX) - Number(data.dragMouseX || 0)
            : Number(context.dx || 0);
          const dy = Number.isFinite(context.totalY)
            ? Number(context.totalY) - Number(data.dragMouseY || 0)
            : Number(context.dy || 0);
          applyInducedProbeDrag(data, dx, dy);
          return true;
        }
      }
      holdInteract(true, context.time || 0, context.dt || 0, context.hoverTarget, context.raycaster || null);
      return !!data?.dragging || !!data?.sliderDragging;
    }
    if (state.expId === 'faraday_induction') {
      const data = state.data;
      if (data?.sliderDragging) {
        const totalX = Number.isFinite(context.totalX)
          ? Number(context.totalX)
          : (Number.isFinite(context.dx) ? Number(context.dx) : null);
        // Prefer absolute thumb position from a live content-screen UV pick
        // (AR pinch following the track), then fall back to relative drag.
        // Visuals/HUD are owned by updateFaraday once per animation frame.
        if (context.raycaster && _target?.userData?.pickFromRay) {
          const live = _target.userData.pickFromRay(context.raycaster, 'B');
          const absB = faradayBFromPick(live);
          if (absB != null) {
            setFaradaySliderAbsolute(data, absB, totalX || 0);
            return true;
          }
        }
        if (totalX != null && Number.isFinite(totalX)) {
          applyFaradaySliderRelative(data, totalX);
        }
        return true;
      }
      if (data?.dragging && data.motionStart) {
        if (context.raycaster && applyFaradayDragRaycast(data, context.raycaster, context)) {
          return true;
        }
        if (Number.isFinite(context.totalX) || Number.isFinite(context.dx)) {
          const totalX = Number.isFinite(context.totalX)
            ? Number(context.totalX) - Number(data.dragMouseX || 0)
            : Number(context.dx || 0);
          const nextX = clamp(data.motionStart.x0 + totalX * 0.015, data.xMin, data.xMax);
          if (Math.abs(nextX - data.x) > 1e-6) {
            const visualDt = Math.max(Number(context.dt) || 0, 1 / 60);
            const dx = nextX - data.x;
            data.x = nextX;
            updateFaradayDragCurrent(data, dx, visualDt);
            data._prevX = nextX;
            // Hand-tracking samples are slower than rAF. Sync the rod and current
            // arrows on each sample instead of waiting for a later fixed tick.
            syncFaraday(data, false, visualDt);
          }
          return true;
        }
      }
      holdInteract(true, context.time || 0, context.dt || 0, context.hoverTarget, context.raycaster || null);
      return !!data?.dragging;
    }
    if (state.expId === 'electric_field') {
      const data = state.data;
      // Prefer 3D raycast target tracking when raycaster is present so the charge
      // sticks 1:1 to the crosshair / mouse pointer.
      if (data?.dragging && data.dragStart) {
        if (context.raycaster && applyElectricDragRaycast(data, context.raycaster, context)) {
          return true;
        }
        if (
          Number.isFinite(context.totalX)
          || Number.isFinite(context.totalY)
          || Number.isFinite(context.dx)
          || Number.isFinite(context.dy)
        ) {
          const dx = Number.isFinite(context.totalX)
            ? Number(context.totalX) - Number(data.dragMouseX || 0)
            : Number(context.dx || 0);
          const dy = Number.isFinite(context.totalY)
            ? Number(context.totalY) - Number(data.dragMouseY || 0)
            : Number(context.dy || 0);
          data._dragShiftZ = !!(context.shiftKey || equipment.electro?.mouseDrag?.shiftKey);
          applyElectricDragDelta(data, dx, dy, context.dt || 0);
          return true;
        }
      }
      holdInteract(true, context.time || 0, context.dt || 0, context.hoverTarget, context.raycaster || null);
      return !!data?.dragging;
    }
    if (state.expId === 'gauss_theorem') {
      const data = state.data;
      if (data?.dragArmed) {
        if (context.raycaster && applyGaussDragRaycast(data, context.raycaster)) {
          return true;
        }
        if (
          Number.isFinite(context.totalX)
          || Number.isFinite(context.totalY)
          || Number.isFinite(context.dx)
          || Number.isFinite(context.dy)
        ) {
          const dx = Number.isFinite(context.totalX)
            ? Number(context.totalX) - Number(data.dragMouseX || 0)
            : Number(context.dx || 0);
          const dy = Number.isFinite(context.totalY)
            ? Number(context.totalY) - Number(data.dragMouseY || 0)
            : Number(context.dy || 0);
          applyGaussDragDelta(data, dx, dy, context.dt || 0);
          return true;
        }
      }
      holdInteract(true, context.time || 0, context.dt || 0, context.hoverTarget, context.raycaster || null);
      return !!data?.dragArmed;
    }
    if (state.expId !== 'hall_effect') return false;
    if (state.data.tableScrollDrag?.armed) {
      return applyTableScrollDrag(context);
    }
    if (state.data.terminalDragFrom) {
      holdInteract(
        true,
        context.time || 0,
        context.dt || 0,
        context.hoverTarget,
        context.raycaster || null,
      );
      return true;
    }
    // Camera-drag knobs / probe / coils: apply mouse totals every frame.
    // (Previously returned true without calling holdInteract, so grabs did nothing.)
    if (state.data.hallDragArmed) {
      holdInteract(true, context.time || 0, context.dt || 0, context.hoverTarget, context.raycaster || null);
      return true;
    }
    return false;
  }

  function endManipulation(_target, context = {}) {
    if (state.data) state.data._aimVisible = false;
    if (state.expId === 'induced_electric_field') {
      if (state.data.sliderDragging) {
        finishInducedSlider(state.data);
        return true;
      }
      if (!state.data.dragging) return false;
      holdInteract(false, context.time || 0, 0, context.target);
      return true;
    }
    if (state.expId === 'faraday_induction') {
      if (state.data.sliderDragging) {
        finishFaradaySlider(state.data);
        syncFaraday(state.data);
        return true;
      }
      if (!state.data.dragging) return false;
      holdInteract(false, context.time || 0, 0, context.target);
      return true;
    }
    if (state.expId === 'electric_field') {
      if (!state.data.dragging) return false;
      holdInteract(false, context.time || 0, 0, context.target);
      return true;
    }
    if (state.expId === 'gauss_theorem') {
      if (!state.data.dragArmed) return false;
      holdInteract(false, context.time || 0, 0, context.target);
      return true;
    }
    if (state.expId !== 'hall_effect') return false;
    const data = state.data;
    if (data.tableScrollDrag?.armed) {
      clearTableScrollDrag();
      return true;
    }
    if (context.cancelled && data.terminalDragFrom) {
      if (data.terminalOriginalFrom) {
        const orig = data.terminalOriginalFrom;
        const from = data.terminalDragFrom;
        const retained = (data.wires || []).filter((pair) => {
          const [a, b] = Array.isArray(pair) ? pair : [pair?.from, pair?.to];
          return a !== from && b !== from && a !== orig && b !== orig;
        });
        retained.push([from, orig]);
        data.wires = retained;
        applyWiringState(data);
      }
      data.terminalDragFrom = null;
      data.terminalOriginalFrom = null;
      data.terminalDragGroup = null;
      data.terminalSnapPort = null;
      equipment.electro?.cancelHallWirePreview?.();
      syncHall(data);
      toast('追踪中断，已取消接线');
      return true;
    }
    if (data.terminalDragFrom) {
      holdInteract(false, context.time || 0, 0, context.hoverTarget);
      return true;
    }
    if (data.hallDragArmed) {
      holdInteract(false, context.time || 0, 0, context.target);
      return true;
    }
    return false;
  }

  function update(_time, dt) {
    // Deferred electro sync is scheduled on the frame budget (not here) so
    // field-line rebuilds never hitch the pre-render path.
    if (state.expId === 'induced_electric_field' && state.data) {
      updateInducedElectric(state.data, dt);
      return state.data;
    }
    if (state.expId === 'faraday_induction' && state.data) {
      updateFaraday(state.data, dt);
      return state.data;
    }
    if (state.expId === 'electric_field' && state.data) {
      // Probe E/F every frame (cheap); field-line pack only when dirty.
      syncElectricField(state.data, false, dt);
      if (state.data.dragging) {
        state.data._hudThrottle = (state.data._hudThrottle || 0) + dt;
        if (state.data._hudThrottle > 0.25) {
          state.data._hudThrottle = 0;
          pushHud();
        }
      }
      return state.data;
    }
    if (state.expId === 'gauss_theorem' && state.data) {
      // Continuous metrics via SimBackend while charges/radius may animate.
      stepSimBackend(dt);
      equipment.electro?.updateGauss?.(state.data, dt);
      if (state.data.dragging) {
        state.data._hudThrottle = (state.data._hudThrottle || 0) + dt;
        if (state.data._hudThrottle > 0.3) {
          state.data._hudThrottle = 0;
          pushHud();
        }
      }
      return state.data;
    }
    if (state.expId === 'hall_carrier_demo' && state.data) {
      stepSimBackend(dt);
      if (!Number.isFinite(state.data.vh)) {
        state.data.vh = hallDemoVoltage(state.data);
        state.data.force = hallDemoForce(state.data);
      }
      equipment.electro?.setHallDemoHostParticlesOwned?.(hallHostParticlesLive);
      equipment.electro?.updateHallDemo?.(state.data, dt);
      return state.data;
    }
    if (state.expId !== 'hall_effect' || !state.data) return state.data;
    const data = state.data;
    applyWiringState(data);
    data.vh = calculateHallVoltage(data);
    equipment.electro?.updateHall?.(data);
    data._hudThrottle = (data._hudThrottle || 0) + dt;
    if (data._hudThrottle > 0.35) {
      data._hudThrottle = 0;
      pushHud();
    }
    return data;
  }

  function cleanup(_expId) {
    if (state.data) state.data._awaitElectroSync = null;
    disposeSimBackend();
    equipment.electro?.clearHallIdentifyVisuals?.();
    equipment.electro?.cancelHallWirePreview?.();
    // Idle Hall showcase stays on the table; animators only run while electro is hot.
    try {
      if (typeof equipment.electro?.showcase === 'function') equipment.electro.showcase();
      else if (typeof equipment.electro?.suspend === 'function') equipment.electro.suspend();
      else equipment.electro?.setMode?.('hall');
    } catch { /* ignore */ }
  }

  return {
    initData,
    applyVisualDefaults,
    interact,
    beginManipulation,
    updateManipulation,
    endManipulation,
    onKey,
    onWheel,
    holdInteract,
    onFocus,
    onUiAction,
    cleanup,
    update,
  };
}

export function exportHallDataReport(data) {
  if (!data?.records || data.records.length === 0) return false;
  const records = data.records;
  const lastRec = records[records.length - 1] || records[0];
  const kVal = records[0]?.hallK || 301;

  function getTheoreticalB(r, xPos) {
    const rawX = Number(xPos || 0);
    const Im = Number(r.Im || 0);
    let bTesla = 0;
    if (r.target === 'helmholtz') {
      const xM = Math.abs(rawX) > 0.5 ? rawX / 100 : rawX;
      const fixedX = 0;
      const rawMovingX = Number(r.rightCoilPos ?? 0.05);
      const movingX = Math.abs(rawMovingX) > 0.5 ? rawMovingX / 100 : rawMovingX;
      const fieldAt = (centreX) => (
        HALL_MU0 * HALL_COIL_TURNS * Im * HALL_COIL_RADIUS_M ** 2
        / (2 * Math.pow(HALL_COIL_RADIUS_M ** 2 + (xM - centreX) ** 2, 1.5))
      );
      const coilMode = r.coilMode || data.wiring?.coilMode || 'both';
      if (coilMode === 'fixed') {
        bTesla = fieldAt(fixedX);
      } else if (coilMode === 'moving') {
        bTesla = fieldAt(movingX);
      } else {
        bTesla = fieldAt(fixedX) + fieldAt(movingX);
      }
    } else {
      const rawLen = Number(r.solenoidLength || 0.30);
      const length = (rawLen > 1 ? rawLen / 100 : rawLen) || HALL_SOLENOID_LENGTH_M;
      const halfLength = length / 2;
      const turnsPerMetre = Number(r.turns || 2340) / length;
      const endCos = (z) => z / Math.sqrt(z * z + HALL_SOLENOID_RADIUS_M ** 2);
      const xM = (16.0 - rawX) / 100;
      bTesla = HALL_MU0 * turnsPerMetre * Im * 0.5
        * (endCos(xM + halfLength) - endCos(xM - halfLength));
    }
    return bTesla * Number(r.direction || 1);
  }

  const recordedX = records.map((r) => Number(r.pos || 0));
  const isHelmholtz = lastRec.target === 'helmholtz';
  const xMin = isHelmholtz ? -0.05 : 1;
  const xMax = isHelmholtz ? 0.15 : 31;
  const samples = 160;

  const modeLabels = {
    fixed: '固定线圈 L1',
    moving: '移动线圈 L2',
    both: '双线圈',
  };
  const modeColors = {
    fixed: '#d97706',
    moving: '#059669',
    both: '#0284c7',
  };

  const activeCoilMode = lastRec.coilMode || data.wiring?.coilMode || 'both';
  const targetLabel = isHelmholtz
    ? (activeCoilMode === 'fixed'
      ? '亥姆霍兹线圈 (固定线圈 L1)'
      : activeCoilMode === 'moving'
        ? '亥姆霍兹线圈 (移动线圈 L2)'
        : '亥姆霍兹线圈 (双线圈)')
    : '长螺线管';

  const conditionText = lastRec.target === 'solenoid'
    ? (() => {
      const rawLen = Number(lastRec.solenoidLength || 0.30);
      const lenM = rawLen > 1 ? rawLen / 100 : rawLen;
      const t = Number(lastRec.turns || 2340);
      const nPerM = Math.round(t / lenM);
      return `长 L=${lenM.toFixed(2)}m 匝数 N=${t} (n=${nPerM}匝/米)`;
    })()
    : (() => {
      const rawRight = Number(lastRec.rightCoilPos ?? 0.05);
      const rightM = Math.abs(rawRight) > 0.5 ? rawRight / 100 : rawRight;
      const sep = rightM;
      const isHelm = Math.abs(sep - 0.05) < 0.005;
      if (activeCoilMode === 'fixed') {
        return '单线圈通电 (固定线圈 L1 中心 X=0.000m)';
      }
      if (activeCoilMode === 'moving') {
        return `单线圈通电 (移动线圈 L2 中心 X=${rightM.toFixed(3)}m)`;
      }
      return `双线圈间距 d=${sep.toFixed(3)}m${isHelm ? ' = R (亥姆霍兹状态)' : ''}`;
    })();

  const curvesToDraw = [];
  if (isHelmholtz) {
    const hasFixed = records.some((r) => r.coilMode === 'fixed');
    const hasMoving = records.some((r) => r.coilMode === 'moving');
    const hasBoth = records.some((r) => r.coilMode === 'both' || !r.coilMode);
    const rawRight = Number(lastRec.rightCoilPos ?? 0.05);
    const rightM = Math.abs(rawRight) > 0.5 ? rawRight / 100 : rawRight;
    const sep = rightM;
    const isHelm = Math.abs(sep - 0.05) < 0.005;

    if (hasFixed) {
      curvesToDraw.push({
        key: 'fixed',
        label: (hasMoving || hasBoth) ? '理论线 B₁ (固定线圈 L1 中心 X=0.000m)' : `理论线 (${conditionText})`,
        color: '#d97706',
        points: Array.from({ length: samples + 1 }, (_, i) => {
          const x = xMin + ((xMax - xMin) * i) / samples;
          return { x, b: getTheoreticalB({ ...lastRec, coilMode: 'fixed' }, x) };
        }),
      });
    }
    if (hasMoving) {
      curvesToDraw.push({
        key: 'moving',
        label: (hasFixed || hasBoth) ? `理论线 B₂ (移动线圈 L2 中心 X=${rightM.toFixed(3)}m)` : `理论线 (${conditionText})`,
        color: '#059669',
        points: Array.from({ length: samples + 1 }, (_, i) => {
          const x = xMin + ((xMax - xMin) * i) / samples;
          return { x, b: getTheoreticalB({ ...lastRec, coilMode: 'moving' }, x) };
        }),
      });
    }
    if (hasBoth || (!hasFixed && !hasMoving)) {
      curvesToDraw.push({
        key: 'both',
        label: (hasFixed || hasMoving) ? `理论线 B总 (双线圈间距 d=${sep.toFixed(3)}m${isHelm ? ' = R (亥姆霍兹状态)' : ''})` : `理论线 (${conditionText})`,
        color: '#0284c7',
        points: Array.from({ length: samples + 1 }, (_, i) => {
          const x = xMin + ((xMax - xMin) * i) / samples;
          return { x, b: getTheoreticalB({ ...lastRec, coilMode: 'both' }, x) };
        }),
      });
    }
  } else {
    curvesToDraw.push({
      key: 'solenoid',
      label: `理论线 (${conditionText})`,
      color: '#0284c7',
      points: Array.from({ length: samples + 1 }, (_, i) => {
        const x = xMin + ((xMax - xMin) * i) / samples;
        return { x, b: getTheoreticalB(lastRec, x) };
      }),
    });
  }

  const measuredPoints = records.map((r) => {
    const rawPos = Number(r.pos || 0);
    const posVal = isHelmholtz ? (Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos) : rawPos;
    const cleanPos = Math.abs(posVal) < 1e-6 ? 0 : posVal;
    const rawB = Number(r.b || 0);
    const bT = Math.abs(rawB) > 0.05 ? rawB / 1000 : rawB;
    const rawVh = Number(r.vh || 0);
    const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
    return {
      x: cleanPos,
      b: bT,
      vh: vhV,
      coilMode: r.coilMode || 'both',
    };
  });

  const allCurvePoints = curvesToDraw.flatMap((c) => c.points.map((p) => p.b));
  const allB = allCurvePoints.concat(measuredPoints.map((p) => p.b), [0]);
  const rawMin = Math.min(...allB);
  const rawMax = Math.max(...allB);
  let yMin;
  let yMax;
  if (rawMin >= 0) {
    yMin = 0;
    yMax = Math.max(0.0002, rawMax * 1.12);
  } else if (rawMax <= 0) {
    yMin = Math.min(-0.0002, rawMin * 1.12);
    yMax = 0;
  } else {
    const yPad = Math.max(0.0002, (rawMax - rawMin) * 0.1);
    yMin = rawMin - yPad;
    yMax = rawMax + yPad;
  }

  const svgW = 800;
  const svgH = 380;
  const margin = { top: 45, right: 40, bottom: 50, left: 65 };
  const plotW = svgW - margin.left - margin.right;
  const plotH = svgH - margin.top - margin.bottom;

  const mapX = (x) => margin.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const mapY = (b) => margin.top + plotH - ((b - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;

  let gridLines = '';
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const gx = margin.left + plotW * t;
    const gy = margin.top + plotH * (1 - t);
    const xVal = (xMin + (xMax - xMin) * t).toFixed(isHelmholtz ? 2 : 1);
    const bVal = (yMin + (yMax - yMin) * t).toFixed(4);
    gridLines += `<line x1="${gx}" y1="${margin.top}" x2="${gx}" y2="${margin.top + plotH}" stroke="#e2e8f0" stroke-dasharray="4,4" />
<text x="${gx}" y="${margin.top + plotH + 20}" font-size="12" fill="#64748b" text-anchor="middle">${xVal}</text>`;
    gridLines += `<line x1="${margin.left}" y1="${gy}" x2="${margin.left + plotW}" y2="${gy}" stroke="#e2e8f0" stroke-dasharray="4,4" />
<text x="${margin.left - 10}" y="${gy + 4}" font-size="12" fill="#64748b" text-anchor="end">${bVal}</text>`;
  }

  const polylinesHtml = curvesToDraw.map((c) => {
    const pts = c.points.map((p) => `${mapX(p.x).toFixed(1)},${mapY(p.b).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${c.color}" stroke-width="2.5" stroke-linejoin="round" />`;
  }).join('\n        ');

  const dotsHtml = measuredPoints.map((p, i) => {
    const cx = Number(mapX(p.x).toFixed(1));
    const cy = Number(mapY(p.b).toFixed(1));
    const arm = 4;
    const dotColor = isHelmholtz ? (modeColors[p.coilMode] || '#0284c7') : '#0284c7';
    const modeName = isHelmholtz ? (modeLabels[p.coilMode] || '双线圈') : '螺线管';
    return `<g stroke="${dotColor}" stroke-width="1.3" stroke-linecap="butt">
      <line x1="${(cx - arm).toFixed(1)}" y1="${cy}" x2="${(cx + arm).toFixed(1)}" y2="${cy}" />
      <line x1="${cx}" y1="${(cy - arm).toFixed(1)}" x2="${cx}" y2="${(cy + arm).toFixed(1)}" />
      <title>点 #${i + 1}: [${modeName}] X = ${p.x.toFixed(isHelmholtz ? 3 : 1)} ${isHelmholtz ? 'm' : 'cm'}, B = ${p.b.toFixed(4)} T, Vh = ${(p.vh * 1000).toFixed(2)} mV</title>
    </g>`;
  }).join('\n        ');

  const legendItemsHtml = curvesToDraw.map((c) => (
    `<div class="legend-item"><span class="legend-line" style="background: ${c.color};"></span> ${c.label}</div>`
  )).concat([
    `<div class="legend-item"><span class="legend-marker" style="color: #0284c7; font-weight: 600; font-size: 15px; line-height: 1;">+</span> 实测点 (${records.length} 组)</div>`
  ]).join('\n        ');

  const tableHeaderHtml = `
        <tr>
          <th>序号</th>
          ${isHelmholtz ? '<th>通电状态</th>' : ''}
          <th>${isHelmholtz ? '探头位置 X (m)' : '探杆刻度 X (cm)'}</th>
          <th>霍尔电压 V<sub>H</sub> (mV)</th>
          <th>磁感应强度 B (T)</th>
        </tr>`;

  const rowsHtml = measuredPoints.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      ${isHelmholtz ? `<td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:${p.coilMode === 'fixed' ? '#fef3c7;color:#b45309;' : p.coilMode === 'moving' ? '#d1fae5;color:#047857;' : '#e0f2fe;color:#0369a1;'}">${modeLabels[p.coilMode || 'both']}</span></td>` : ''}
      <td>${p.x.toFixed(isHelmholtz ? 3 : 1)}</td>
      <td>${(p.vh * 1000).toFixed(2)}</td>
      <td>${p.b.toFixed(4)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>霍尔效应测磁实验报告 - B–X 磁场分布图与数据</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      margin: 0;
      padding: 24px;
    }
    .report-card {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      padding: 36px 44px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      border: 1px solid #e2e8f0;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0284c7;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .title { font-size: 24px; font-weight: 700; color: #0f172a; margin: 0; }
    .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px 16px;
      background: #f1f5f9;
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 28px;
      font-size: 14px;
    }
    .meta-item { color: #475569; }
    .meta-item strong { color: #0f172a; font-weight: 600; }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 28px 0 14px 0;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title::before {
      content: "";
      display: inline-block;
      width: 4px;
      height: 16px;
      background: #0284c7;
      border-radius: 2px;
    }
    .chart-legend {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
      color: #475569;
      flex-wrap: wrap;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-line { width: 18px; height: 3px; background: #0284c7; border-radius: 2px; }
    .legend-dot {
      width: 10px; height: 10px; background: #0284c7; border-radius: 50%;
      border: 2px solid #ffffff; box-shadow: 0 0 0 1px #0284c7;
    }
    .legend-marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      font-size: 16px;
      font-weight: 700;
      line-height: 1;
    }
    .chart-box {
      display: flex;
      justify-content: center;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 16px 8px;
      margin-bottom: 28px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: center; margin-bottom: 28px; }
    th { background: #f1f5f9; color: #334155; font-weight: 600; padding: 10px; border: 1px solid #cbd5e1; }
    td { padding: 8px 10px; border: 1px solid #e2e8f0; color: #1e293b; }
    tr:nth-child(even) td { background: #f8fafc; }
    .btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; cursor: pointer; border: none; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; }
    .btn-primary { background: #0284c7; color: #ffffff; }
    .btn-excel { background: #10b981; color: #ffffff; }
    .btn-csv { background: #0f766e; color: #ffffff; }
    .btn-json { background: #6366f1; color: #ffffff; }
    .btn-secondary { background: #e2e8f0; color: #334155; }
    @media print {
      body { background: #fff; padding: 0; }
      .report-card { box-shadow: none; border: none; padding: 0; max-width: 100%; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="report-card">
    <div class="header-bar">
      <div>
        <h1 class="title">霍尔效应测磁实验报告</h1>
        <div class="subtitle">B–X 磁场分布曲线与测量数据</div>
      </div>
      <div class="btn-group no-print">
        <button class="btn btn-primary" type="button" onclick="window.print()">🖨️ 打印 / PDF</button>
        <button class="btn btn-excel" type="button" onclick="exportExcel()">📊 导出 Excel</button>
        <button class="btn btn-csv" type="button" onclick="exportCSV()">📄 导出 CSV</button>
        <button class="btn btn-json" type="button" onclick="exportJSON()">📋 导出 JSON</button>
        <button class="btn btn-secondary" type="button" onclick="window.close()">关闭</button>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item">实验仪器: <strong>HCC-2 型霍尔效应测磁仪</strong></div>
      <div class="meta-item">测量对象: <strong>${targetLabel}</strong></div>
      <div class="meta-item">灵敏度 K: <strong>${kVal} V/(A·T)</strong></div>
      <div class="meta-item">实测点数: <strong>${records.length} 组</strong></div>
      <div class="meta-item">励磁电流 Im: <strong>${Number(lastRec.Im || 0).toFixed(3)} A</strong></div>
      <div class="meta-item">霍尔电流 Is: <strong>${(Number(lastRec.Is || 0) > 0.05 ? Number(lastRec.Is) / 1000 : Number(lastRec.Is || 0)).toFixed(3)} A</strong></div>
    </div>

    <div class="section-header">
      <div class="section-title">实验数据记录表</div>
    </div>
    <table>
      <thead>
        ${tableHeaderHtml}
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="section-header">
      <div class="section-title">B–X 磁场分布曲线</div>
      <div class="chart-legend">
        ${legendItemsHtml}
      </div>
    </div>

    <div class="chart-box">
      <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="max-width: 100%; height: auto;">
        ${gridLines}
        ${yMin < 0 && yMax > 0 ? `<line x1="${margin.left}" y1="${mapY(0)}" x2="${margin.left + plotW}" y2="${mapY(0)}" stroke="#94a3b8" stroke-width="1.5" />` : ''}
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#334155" stroke-width="2" />
        <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#334155" stroke-width="2" />
        <text x="${margin.left + plotW / 2}" y="${svgH - 12}" font-size="13" font-weight="600" fill="#334155" text-anchor="middle">${isHelmholtz ? 'X / m' : 'X / cm'}</text>
        <text x="20" y="${margin.top + plotH / 2}" font-size="13" font-weight="600" fill="#334155" text-anchor="middle" transform="rotate(-90 20 ${margin.top + plotH / 2})">B / T</text>

        <!-- Theoretical Curves -->
        ${polylinesHtml}

        <!-- Measured Points -->
        ${dotsHtml}
      </svg>
    </div>
  </div>

  <script>
    const rawRecords = ${JSON.stringify(records)};
    const kVal = ${JSON.stringify(kVal)};
    const isHelmholtzMode = ${JSON.stringify(isHelmholtz)};

    function downloadFile(filename, content, mimeType) {
      const type = mimeType || 'application/octet-stream';
      try {
        const blob = content instanceof Blob ? content : new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (a.parentNode) document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      } catch (e) {
        const encoded = 'data:' + type + ',' + encodeURIComponent(content);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = encoded;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { if (a.parentNode) document.body.removeChild(a); }, 1000);
      }
    }

    const escapeXml = (value) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    const columnName = (index) => {
      let value = index + 1;
      let name = '';
      while (value > 0) {
        const remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
      }
      return name;
    };
    const crc32 = (bytes) => {
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
          crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    };
    const joinBytes = (arrays) => {
      const total = arrays.reduce((acc, a) => acc + a.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const a of arrays) {
        out.set(a, offset);
        offset += a.length;
      }
      return out;
    };

    const makeXlsx = (matrix) => {
      const textEncoder = new TextEncoder();
      const sheetRows = matrix.map((row, rIdx) => {
        const cells = row.map((val, cIdx) => {
          const ref = columnName(cIdx) + (rIdx + 1);
          if (typeof val === 'number') {
            return '<c r="' + ref + '"><v>' + val + '</v></c>';
          }
          return '<c r="' + ref + '" t="inlineStr"><is><t>' + escapeXml(val ?? '') + '</t></is></c>';
        }).join('');
        return '<row r="' + (rIdx + 1) + '">' + cells + '</row>';
      }).join('');

      const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetData>' + sheetRows + '</sheetData>' +
        '</worksheet>';

      const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>';

      const rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>';

      const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="实验数据" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>';

      const workbookRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>';

      const files = [
        { name: '[Content_Types].xml', data: textEncoder.encode(contentTypesXml) },
        { name: '_rels/.rels', data: textEncoder.encode(rootRelsXml) },
        { name: 'xl/_rels/workbook.xml.rels', data: textEncoder.encode(workbookRelsXml) },
        { name: 'xl/workbook.xml', data: textEncoder.encode(workbookXml) },
        { name: 'xl/worksheets/sheet1.xml', data: textEncoder.encode(sheetXml) },
      ];

      const localParts = [];
      const centralParts = [];
      let offset = 0;
      for (const file of files) {
        const nameBytes = textEncoder.encode(file.name);
        const data = file.data;
        const crc = crc32(data);

        const local = new Uint8Array(30 + nameBytes.length + data.length);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 20, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, data.length, true);
        localView.setUint32(22, data.length, true);
        localView.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);
        localParts.push(local);

        const central = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, data.length, true);
        centralView.setUint32(24, data.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centralParts.push(central);
        offset += local.length;
      }
      const centralDirectory = joinBytes(centralParts);
      const end = new Uint8Array(22);
      const endView = new DataView(end.buffer);
      endView.setUint32(0, 0x06054b50, true);
      endView.setUint16(8, centralParts.length, true);
      endView.setUint16(10, centralParts.length, true);
      endView.setUint32(12, centralDirectory.length, true);
      endView.setUint32(16, offset, true);
      return joinBytes([...localParts, centralDirectory, end]);
    };

    function showToast(msg) {
      let toast = document.getElementById('report-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'report-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.18);z-index:9999;transition:opacity 0.25s ease, transform 0.25s ease;pointer-events:none;';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(8px)';
      }, 2500);
    }

    function exportExcel() {
      try {
        const xCol = isHelmholtzMode ? '探头位置 X (m)' : '探杆刻度 X (cm)';
        const headers = ['序号', xCol, '霍尔电压 VH (mV)', '磁感应强度 B (T)'];
        const rows = rawRecords.map((r, i) => {
          const rawPos = Number(r.pos || 0);
          const posVal = isHelmholtzMode ? (Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos) : rawPos;
          const cleanPos = Math.abs(posVal) < 1e-6 ? 0 : posVal;
          const rawVh = Number(r.vh || 0);
          const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
          const rawB = Number(r.b || 0);
          const bT = Math.abs(rawB) > 0.05 ? rawB / 1000 : rawB;
          return [
            i + 1,
            cleanPos.toFixed(isHelmholtzMode ? 3 : 1),
            (vhV * 1000).toFixed(2),
            bT.toFixed(4)
          ];
        });
        const xlsxBytes = makeXlsx([headers, ...rows]);
        const filename = '霍尔效应测磁实验数据_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        downloadFile(filename, xlsxBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        showToast('✅ 已导出 Excel (.xlsx) 表格');
      } catch (err) {
        console.warn('生成 .xlsx 失败，回退为 XML .xls:', err);
        try {
          const xCol = isHelmholtzMode ? '探头位置 X (m)' : '探杆刻度 X (cm)';
          const headers = ['序号', xCol, '霍尔电压 VH (mV)', '磁感应强度 B (T)'];
          const rows = rawRecords.map((r, i) => {
            const rawPos = Number(r.pos || 0);
            const posVal = isHelmholtzMode ? (Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos) : rawPos;
            const cleanPos = Math.abs(posVal) < 1e-6 ? 0 : posVal;
            const rawVh = Number(r.vh || 0);
            const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
            const rawB = Number(r.b || 0);
            const bT = Math.abs(rawB) > 0.05 ? rawB / 1000 : rawB;
            return [
              i + 1,
              cleanPos.toFixed(isHelmholtzMode ? 3 : 1),
              (vhV * 1000).toFixed(2),
              bT.toFixed(4)
            ];
          });
          let xmlRows = '<Row ss:StyleID="Header">\\n' +
            headers.map(h => '  <Cell><Data ss:Type="String">' + h + '</Data></Cell>').join('\\n') +
            '\\n</Row>\\n';
          rows.forEach(row => {
            xmlRows += '<Row ss:StyleID="Cell">\\n' +
              row.map(val => {
                const isNum = !isNaN(val) && val !== '';
                const type = isNum ? 'Number' : 'String';
                return '  <Cell><Data ss:Type="' + type + '">' + val + '</Data></Cell>';
              }).join('\\n') +
              '\\n</Row>\\n';
          });
          const xml = '<?xml version="1.0" encoding="UTF-8"?>\\n' +
            '<?mso-application progid="Excel.Sheet"?>\\n' +
            '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\\n' +
            ' xmlns:o="urn:schemas-microsoft-com:office:office"\\n' +
            ' xmlns:x="urn:schemas-microsoft-com:office:excel"\\n' +
            ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\\n' +
            ' <Styles>\\n' +
            '  <Style ss:ID="Header">\\n' +
            '   <Font ss:Bold="1" ss:Color="#0F172A"/>\\n' +
            '   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>\\n' +
            '   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>\\n' +
            '  </Style>\\n' +
            '  <Style ss:ID="Cell">\\n' +
            '   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>\\n' +
            '  </Style>\\n' +
            ' </Styles>\\n' +
            ' <Worksheet ss:Name="霍尔测磁实验数据">\\n' +
            '  <Table>\\n' +
            '   <Column ss:Width="60"/>\\n' +
            '   <Column ss:Width="140"/>\\n' +
            '   <Column ss:Width="140"/>\\n' +
            '   <Column ss:Width="150"/>\\n' +
            xmlRows +
            '  </Table>\\n' +
            ' </Worksheet>\\n' +
            '</Workbook>';
          const filename = '霍尔效应测磁实验数据_' + new Date().toISOString().slice(0, 10) + '.xls';
          downloadFile(filename, xml, 'application/vnd.ms-excel');
          showToast('✅ 已导出 Excel (.xls) 表格');
        } catch (e2) {
          console.error('导出 Excel 失败:', e2);
          showToast('❌ 导出 Excel 失败: ' + (e2?.message || e2));
        }
      }
    }

    function exportCSV() {
      try {
        const xCol = isHelmholtzMode ? '探头位置 X (m)' : '探杆刻度 X (cm)';
        const headers = ['序号', xCol, '霍尔电压 VH (mV)', '磁感应强度 B (T)'];
        const rows = rawRecords.map((r, i) => {
          const rawPos = Number(r.pos || 0);
          const posVal = isHelmholtzMode ? (Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos) : rawPos;
          const cleanPos = Math.abs(posVal) < 1e-6 ? 0 : posVal;
          const rawVh = Number(r.vh || 0);
          const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
          const rawB = Number(r.b || 0);
          const bT = Math.abs(rawB) > 0.05 ? rawB / 1000 : rawB;
          return [
            i + 1,
            cleanPos.toFixed(isHelmholtzMode ? 3 : 1),
            (vhV * 1000).toFixed(2),
            bT.toFixed(4)
          ];
        });
        const csvContent = '\\uFEFF' + [headers, ...rows].map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\\r\\n');
        const filename = '霍尔效应测磁实验数据_' + new Date().toISOString().slice(0, 10) + '.csv';
        downloadFile(filename, csvContent, 'text/csv;charset=utf-8;');
        showToast('✅ 已导出 CSV 数据文件');
      } catch (err) {
        console.error('导出 CSV 失败:', err);
        showToast('❌ 导出 CSV 失败: ' + (err?.message || err));
      }
    }

    function exportJSON() {
      try {
        const payload = {
          experiment: "霍尔效应测磁实验",
          instrument: "HCC-2 型霍尔效应测磁仪",
          hallK: kVal,
          exportedAt: new Date().toLocaleString('zh-CN'),
          records: rawRecords
        };
        const jsonContent = JSON.stringify(payload, null, 2);
        const filename = '霍尔效应测磁实验数据_' + new Date().toISOString().slice(0, 10) + '.json';
        downloadFile(filename, jsonContent, 'application/json;charset=utf-8;');
        showToast('✅ 已导出 JSON 数据文件');
      } catch (err) {
        console.error('导出 JSON 失败:', err);
        showToast('❌ 导出 JSON 失败: ' + (err?.message || err));
      }
    }

    window.exportExcel = exportExcel;
    window.exportCSV = exportCSV;
    window.exportJSON = exportJSON;
  </script>
</body>
</html>`;

  return openHtmlReport(html, 'hall_effect_report');
}
