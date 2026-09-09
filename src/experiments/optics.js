/**
 * 光学实验台
 *
 * 1) 几何光学（guangxue）：反射 / 折射 / 色散 / 透镜 — 源光具座 + 几何追迹
 * 2) 单缝衍射 · 多缝干涉：Fraunhofer 包络与多缝干涉主极大
 *
 * 衍射学习闭环（与「写入对照 / 核对曲线」对应）：
 * 1. 调参观察 → 屏上条纹与实时 I(x) 同步变化
 * 2. 写入对照 → 把当前配置与可观测量（Δx、包络宽、F）存入对照表
 * 3. 核对曲线 → 在理论 I(x) 上标主极大、包络零点与远场条件
 */

import * as THREE from 'three';
import {
  GEOMETRIC_EXPERIMENTS,
  SHAPE_LABELS,
  getGeometricExperiment,
  getModule,
  getModulesForExperiment,
  isGeometricOpticsExp,
  isReflectionExp,
  moduleIdFromStep,
  resolveExperimentConfig,
  stepIdForModule,
} from '../guangxue/catalog.js';
import { criticalAngleDeg, snellRatio } from '../guangxue/opticsCore.js';
import { isMirrorShape } from '../guangxue/shapes.js';
import { labFrameScheduler } from '../frameBudget.js';
import {
  createSimBackend,
  SIM_KIND,
  preferredWorkerSlot,
} from '../runtime/threading/simBackend.js';

export const station = {
  id: 'optics',
  title: '光学实验台',
  accent: '#f59e0b',
  experiments: [
    ...GEOMETRIC_EXPERIMENTS.map(({ id, name, goal, theory, steps }) => ({
      id, name, goal, theory, steps,
    })),
    {
      id: 'multi_slit_diffraction',
      name: '单缝衍射 · 多缝干涉',
      goal: '调节波长、缝宽、缝距、缝数和屏距，用对照表与标注曲线归纳条纹规律',
      theory: '单缝衍射中央亮纹宽度 ∝ λL/a；多缝干涉条纹间距 Δx = λL/d',
      steps: [
        {
          id: 'setup',
          text: '点亮激光器并选择单缝、双缝或多缝预设',
          hint: '在全息屏选择预设；也可瞄准激光器点击开关光束',
        },
        {
          id: 'observe',
          text: '改变 λ、a、d、N、L，观察屏上条纹与强度曲线同步变化',
          hint: '用全息屏精调；滚轮对准激光器、光阑或观察屏可直接调参',
        },
        {
          id: 'measure',
          text: '写入对照：保存当前配置的 Δx、包络宽与菲涅耳数，改参后再写一组',
          hint: '对照表用于横向比较不同配置，不是独立仪器实测',
        },
        {
          id: 'curve',
          text: '核对曲线：在理论 I(x) 上核对主极大间距、包络零点与远场条件',
          hint: '标注来自同一 Fraunhofer 模型；主极大间距 ≈ Δx = λL/d',
        },
        {
          id: 'result',
          text: '对照表中比较多组，总结 N、a、d、λ、L 对条纹的影响后完成',
          hint: '至少写入一组对照后即可结束实验',
        },
      ],
    },
  ],
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

const DIFF_PRESETS = {
  single: { lambdaNm: 550, slitMm: 0.1, pitchMm: 0.25, N: 1, distM: 1 },
  double: { lambdaNm: 550, slitMm: 0.05, pitchMm: 0.25, N: 2, distM: 1 },
  triple: { lambdaNm: 550, slitMm: 0.04, pitchMm: 0.2, N: 3, distM: 1 },
  multi: { lambdaNm: 532, slitMm: 0.03, pitchMm: 0.15, N: 6, distM: 1.2 },
  grating: { lambdaNm: 632.8, slitMm: 0.02, pitchMm: 0.1, N: 10, distM: 1 },
  hene2: { lambdaNm: 632.8, slitMm: 0.05, pitchMm: 0.3, N: 2, distM: 1 },
};

export function diffractionIntensity(x, data) {
  const lambda = Number(data.lambdaNm) * 1e-9;
  const a = Number(data.slitMm) * 1e-3;
  const d = Number(data.pitchMm) * 1e-3;
  const N = Math.max(1, Math.round(Number(data.N)));
  const L = Number(data.distM);
  const sinTheta = x / Math.hypot(x, L);
  const beta = (Math.PI * a * sinTheta) / lambda;
  const gamma = (Math.PI * d * sinTheta) / lambda;
  const env = Math.abs(beta) < 1e-10 ? 1 : (Math.sin(beta) / beta) ** 2;
  if (N <= 1) return env;
  const den = Math.sin(gamma);
  const interference = Math.abs(gamma) < 1e-10 || Math.abs(den) < 1e-14
    ? 1
    : (Math.sin(N * gamma) / (N * den)) ** 2;
  return env * interference;
}

export function diffractionHalfSpan(data) {
  const lambda = Number(data.lambdaNm) * 1e-9;
  const a = Number(data.slitMm) * 1e-3;
  const d = Number(data.pitchMm) * 1e-3;
  const L = Number(data.distM);
  const N = Math.max(1, Math.round(Number(data.N)));
  const env = (lambda * L / a) * 3.2;
  const fringes = (lambda * L / d) * Math.min(12, 2 + N * 2);
  return Math.min(0.15, Math.max(0.01, Math.max(env, fringes)));
}

/**
 * Envelope zeros of single-slit factor: sinβ=0 (β≠0) → sinθ = m λ/a.
 * Screen coordinate uses paraxial x ≈ L·sinθ (consistent with intensity model).
 * Returns positive-side positions in metres (plot both ±x).
 */
export function diffractionEnvelopeZeros(data, halfSpanM) {
  const lambda = Number(data.lambdaNm) * 1e-9;
  const a = Math.max(1e-12, Number(data.slitMm) * 1e-3);
  const L = Math.max(1e-9, Number(data.distM));
  const half = Number(halfSpanM);
  const span = Number.isFinite(half) && half > 0 ? half : diffractionHalfSpan(data);
  const out = [];
  for (let m = 1; m <= 8; m++) {
    const x = (m * lambda * L) / a;
    if (x > span * 1.02) break;
    out.push({ m, x });
  }
  return out;
}

/**
 * Multi-slit principal maxima: γ = pπ → sinθ = p λ/d.
 * For N=1 there is no multi-slit interference structure (empty list).
 * Returns signed positions in metres within ±halfSpan.
 */
export function diffractionPrincipalMaxima(data, halfSpanM) {
  const N = Math.max(1, Math.round(Number(data.N)));
  if (N <= 1) return [];
  const lambda = Number(data.lambdaNm) * 1e-9;
  const d = Math.max(1e-12, Number(data.pitchMm) * 1e-3);
  const L = Math.max(1e-9, Number(data.distM));
  const half = Number(halfSpanM);
  const span = Number.isFinite(half) && half > 0 ? half : diffractionHalfSpan(data);
  const out = [{ p: 0, x: 0 }];
  for (let p = 1; p <= 24; p++) {
    const x = (p * lambda * L) / d;
    if (x > span * 1.02) break;
    out.push({ p, x });
    out.push({ p: -p, x: -x });
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

/** Columns for the optics comparison table (model-derived observables). */
export function opticsRecordColumns() {
  return [
    { key: '#', label: '#', width: 0.06 },
    { key: 'N', label: 'N', width: 0.07 },
    { key: 'lambdaNm', label: 'λ/nm', width: 0.12 },
    { key: 'slitMm', label: 'a/mm', width: 0.12 },
    { key: 'pitchMm', label: 'd/mm', width: 0.12 },
    { key: 'distM', label: 'L/m', width: 0.10 },
    { key: 'fringeSpacingMm', label: 'Δx/mm', width: 0.14 },
    { key: 'centralWidthMm', label: '包络/mm', width: 0.14 },
    { key: 'farField', label: '远场', width: 0.13 },
  ];
}

export function formatOpticsRecordCell(row, key, index = 0) {
  if (key === '#') return String(index + 1);
  if (key === 'N') return String(Math.round(Number(row.N || 1)));
  if (key === 'lambdaNm') return Number(row.lambdaNm || 0).toFixed(0);
  if (key === 'slitMm') return Number(row.slitMm || 0).toFixed(3);
  if (key === 'pitchMm') return Number(row.pitchMm || 0).toFixed(3);
  if (key === 'distM') return Number(row.distM || 0).toFixed(2);
  if (key === 'fringeSpacingMm') return Number(row.fringeSpacingMm || 0).toFixed(3);
  if (key === 'centralWidthMm') return Number(row.centralWidthMm || 0).toFixed(2);
  if (key === 'farField') return row.farField ? '是' : '近场';
  if (key === 'fresnel') return Number(row.fresnel || 0).toExponential(1);
  // Geometric optics records
  if (key === 'shape') return row.shapeLabel || SHAPE_LABELS[row.shape] || String(row.shape || '—');
  if (key === 'theta1') return row.theta1 == null ? '—' : Number(row.theta1).toFixed(1);
  if (key === 'theta2') {
    if (row.theta2 == null) return row.tir ? 'TIR' : '—';
    return Number(row.theta2).toFixed(1);
  }
  if (key === 'deltaTheta') return row.deltaTheta == null ? '—' : Number(row.deltaTheta).toFixed(3);
  if (key === 'ior') return Number(row.ior || 0).toFixed(3);
  if (key === 'ratio') return row.ratio == null ? '—' : String(row.ratio);
  if (key === 'note') return row.note || '—';
  if (key === 'rotate') return Number(row.rotate || 0).toFixed(0);
  return '—';
}

/** Columns for geometric optics data table (mirror vs dielectric). */
export function geoOpticsRecordColumns(expId) {
  if (isReflectionExp(expId)) {
    return [
      { key: '#', label: '#', width: 0.06 },
      { key: 'shape', label: '元件', width: 0.16 },
      { key: 'theta1', label: 'θᵢ/°', width: 0.14 },
      { key: 'theta2', label: 'θᵣ/°', width: 0.14 },
      { key: 'deltaTheta', label: '|Δθ|', width: 0.14 },
      { key: 'ratio', label: '验证', width: 0.18 },
      { key: 'note', label: '备注', width: 0.18 },
    ];
  }
  return [
    { key: '#', label: '#', width: 0.06 },
    { key: 'shape', label: '元件', width: 0.14 },
    { key: 'ior', label: 'n', width: 0.12 },
    { key: 'theta1', label: 'θ₁/°', width: 0.14 },
    { key: 'theta2', label: 'θ₂/°', width: 0.14 },
    { key: 'ratio', label: 'sinθ₁/sinθ₂', width: 0.20 },
    { key: 'note', label: '备注', width: 0.20 },
  ];
}

export {
  isGeometricOpticsExp,
  isReflectionExp,
  SHAPE_LABELS,
  getGeometricExperiment,
  getModulesForExperiment,
  getModule,
};

export function createHandlers(ctx) {
  const {
    state, equipment, toast, pushHud, setStep, currentStep,
  } = ctx;
  let directManipulation = null;

  /** ExperimentSimBackend for fringe samples / geometric HUD angles. */
  let simBackend = null;
  let simBackendExpId = null;
  let lastAppliedGeneration = -1;

  function disposeSimBackend() {
    try { simBackend?.dispose?.(); } catch { /* ignore */ }
    simBackend = null;
    simBackendExpId = null;
    lastAppliedGeneration = -1;
  }

  function simKindForExp(expId) {
    if (expId === 'multi_slit_diffraction') return SIM_KIND.DIFFRACTION_FRINGE;
    if (isGeometricOpticsExp(expId)) return SIM_KIND.GEOMETRIC_ANGLES;
    return null;
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
      if (expId === 'multi_slit_diffraction') {
        options = {
          lambdaNm: Number(d.lambdaNm) || 550,
          slitMm: Number(d.slitMm) || 0.05,
          pitchMm: Number(d.pitchMm) || 0.25,
          N: Math.max(1, Math.round(Number(d.N) || 2)),
          distM: Number(d.distM) || 1,
          samples: 256,
        };
      } else {
        options = {
          angle: Number(d.angle) || 35,
          ior: Number(d.ior) || 1.5,
          airIor: 1.0,
          mode: d.opticsMode === 'mirror' ? 'reflect' : 'refract',
        };
      }
      simBackend = createSimBackend({
        kind,
        workerSlot: preferredWorkerSlot(kind),
        options,
      });
      simBackendExpId = expId;
      lastAppliedGeneration = -1;
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.warn('[optics] SimBackend init failed', error);
      }
      simBackend = null;
      simBackendExpId = null;
    }
    return simBackend;
  }

  function syncSimParams(d = state.data) {
    if (!simBackend || !d || simBackendExpId !== state.expId) return;
    if (state.expId === 'multi_slit_diffraction') {
      simBackend.command('setParams', {
        lambdaNm: d.lambdaNm,
        slitMm: d.slitMm,
        pitchMm: d.pitchMm,
        N: d.N,
        distM: d.distM,
      });
    } else if (isGeometricOpticsExp(state.expId)) {
      simBackend.command('setParams', {
        angle: d.angle,
        ior: d.ior,
        mode: d.opticsMode === 'mirror' ? 'reflect' : 'refract',
      });
    }
  }

  function applySimSnapshot(snap, d) {
    if (!snap || !d || snap.skipped) return false;
    const gen = snap.generation | 0;
    if (gen === lastAppliedGeneration && gen !== 0) return false;
    if (gen > 0 && (gen & 1) === 1) return false;
    lastAppliedGeneration = gen;
    const s = snap.scalars || {};

    if (state.expId === 'multi_slit_diffraction') {
      if (Number.isFinite(s.fringeSpacingMm)) d.fringeSpacingMm = s.fringeSpacingMm;
      if (Number.isFinite(s.centralWidthMm)) d.centralWidthMm = s.centralWidthMm;
      if (Number.isFinite(s.principalHalfWidthMm)) d.principalHalfWidthMm = s.principalHalfWidthMm;
      if (Number.isFinite(s.halfSpanM)) d.halfSpanMm = s.halfSpanM * 1e3;
      const intensity = snap.fields?.intensity;
      if (intensity?.length) {
        d._simIntensity = intensity instanceof Float32Array
          ? intensity
          : Float32Array.from(intensity);
        d._simHalfSpanM = Number(s.halfSpanM) || (d.halfSpanMm * 1e-3);
        // Bump paint signature so the screen rebuilds when samples arrive
        // (worker deferred path may land after the first syncDiffraction).
        d._simIntensityGen = (d._simIntensityGen | 0) + 1;
      }
      return true;
    }

    if (isGeometricOpticsExp(state.expId)) {
      if (Number.isFinite(s.theta1)) d.theta1 = s.theta1;
      if (s.thetaReflect != null) d.thetaReflect = s.thetaReflect;
      if (s.thetaRefract !== undefined) d.thetaRefract = s.thetaRefract;
      if (s.theta2 !== undefined) d.theta2 = s.theta2;
      if (s.tir != null) d.tir = !!s.tir;
      return true;
    }
    return false;
  }

  function initData(expId) {
    directManipulation = null;
    if (expId === 'multi_slit_diffraction') {
      return {
        mode: 'diffraction',
        lightOn: true,
        preset: 'double',
        ...DIFF_PRESETS.double,
        showBeam: true,
        showWave: true,
        demoOn: false,
        demoPhase: 0,
        demoElapsed: 0,
        chartOpen: false,
        recordsPanelOpen: false,
        tableScrollTop: 0,
        tableScrollAuto: true,
        records: [],
        completed: false,
        _hudThrottle: 0,
        dragArmed: false,
      };
    }
    if (isGeometricOpticsExp(expId)) {
      const exp = getGeometricExperiment(expId);
      const moduleId = exp?.defaultModule || null;
      const cfg = resolveExperimentConfig(expId, moduleId) || exp?.config || {};
      const shape = cfg.shape || 'mirror';
      const opticsMode = cfg.mode || (isMirrorShape(shape) ? 'mirror' : 'dielectric');
      return {
        mode: 'geometric',
        expId,
        moduleId,
        moduleCode: moduleId ? (getModule(expId, moduleId)?.code || null) : null,
        shape,
        opticsMode,
        angle: cfg.angle ?? 35,
        height: cfg.height ?? 0,
        rayCount: cfg.rayCount ?? 1,
        ior: cfg.ior ?? 1.52,
        dispersion: !!cfg.dispersion,
        dispersionStrength: cfg.dispersionStrength ?? 0.6,
        rotate: cfg.rotate ?? 0,
        showReflect: cfg.showReflect !== false,
        theta1: cfg.angle ?? 35,
        theta2: opticsMode === 'mirror' ? (cfg.angle ?? 35) : null,
        thetaReflect: opticsMode === 'mirror' ? (cfg.angle ?? 35) : null,
        thetaRefract: null,
        recordsPanelOpen: false,
        tableScrollTop: 0,
        tableScrollAuto: true,
        records: [],
        completed: false,
        _hudThrottle: 0,
        dragArmed: false,
        dragKind: null,
      };
    }
    return {};
  }

  function syncDiffraction(data, refresh = true, opts = {}) {
    data.lambdaNm = clamp(Number(data.lambdaNm || 550), 380, 780);
    data.slitMm = clamp(Number(data.slitMm || 0.05), 0.01, 0.4);
    data.pitchMm = clamp(Number(data.pitchMm || 0.25), 0.02, 1);
    data.N = clamp(Math.round(Number(data.N || 2)), 1, 12);
    data.distM = clamp(Number(data.distM || 1), 0.4, 2);
    if (data.pitchMm <= data.slitMm) {
      data.pitchMm = Math.min(1, data.slitMm + 0.01);
    }
    // Offload fringe spacing / intensity samples via SimBackend when available.
    ensureSimBackend('multi_slit_diffraction', data);
    if (simBackend && simBackendExpId === 'multi_slit_diffraction') {
      syncSimParams(data);
      const snap = simBackend.step(0);
      applySimSnapshot(snap, data);
      if (snap?.deferred) applySimSnapshot(simBackend.getSnapshot?.() || snap, data);
    }
    // Always keep analytic fallbacks so HUD never blanks on first frame.
    const lambda = data.lambdaNm * 1e-9;
    const a = data.slitMm * 1e-3;
    const d = data.pitchMm * 1e-3;
    if (!Number.isFinite(data.fringeSpacingMm)) {
      data.fringeSpacingMm = (lambda * data.distM / d) * 1e3;
    }
    if (!Number.isFinite(data.centralWidthMm)) {
      data.centralWidthMm = (2 * lambda * data.distM / a) * 1e3;
    }
    if (!Number.isFinite(data.principalHalfWidthMm)) {
      data.principalHalfWidthMm = (lambda * data.distM / (data.N * d)) * 1e3;
    }
    const aperture = Math.max(a, (data.N - 1) * d + a);
    data.fresnel = (aperture * aperture) / (lambda * data.distM);
    data.farField = data.fresnel < 0.15;
    if (!Number.isFinite(data.halfSpanMm)) {
      data.halfSpanMm = diffractionHalfSpan(data) * 1e3;
    }
    // Fringe canvas is painted immediately so 3D receiver screen never stays black.
    equipment.optics?.updateOptics?.(data, { syncPaint: true, ...opts });
    data._opticsDirty = false;
    if (refresh) pushHud();
  }

  function applyAnalyticAngles(data) {
    data.theta1 = data.angle;
    if (data.opticsMode === 'mirror') {
      data.theta2 = data.angle;
      data.thetaReflect = data.angle;
      data.thetaRefract = null;
    } else {
      const s = (1 / data.ior) * Math.sin((data.angle * Math.PI) / 180);
      data.thetaRefract = Math.abs(s) <= 1 ? (Math.asin(s) * 180) / Math.PI : null;
      data.theta2 = data.thetaRefract;
      data.thetaReflect = data.angle;
    }
  }

  function applyVerifyFields(data) {
    if (data.opticsMode === 'mirror') {
      data.deltaTheta = (data.theta1 != null && data.theta2 != null)
        ? Math.abs(data.theta1 - data.theta2)
        : null;
      data.verifyOk = data.deltaTheta != null && data.deltaTheta < 0.5;
      data.snellRatio = null;
      data.criticalDeg = null;
      data.tir = false;
    } else {
      data.deltaTheta = null;
      data.tir = data.theta2 == null || data.thetaRefract == null;
      data.snellRatio = snellRatio(data.theta1, data.theta2);
      data.criticalDeg = criticalAngleDeg(data.ior, 1);
      data.verifyOk = data.snellRatio != null
        && Math.abs(data.snellRatio - data.ior) < 0.08;
    }
  }

  /**
   * @param {object} data
   * @param {boolean} [refresh]
   * @param {{ defer?: boolean, force?: boolean, keepRays?: boolean }} [opts]
   *   defer: experiment switch — no full raytrace on the click frame
   *   keepRays: live drag — keep previous beams while progressive rebuild runs
   */
  function syncGeometric(data, refresh = true, opts = {}) {
    data.mode = 'geometric';
    data.angle = clamp(Number(data.angle ?? 35), 0, 75);
    data.height = clamp(Number(data.height ?? 0), -0.6, 0.6);
    data.rayCount = clamp(Math.round(Number(data.rayCount ?? 1)), 1, 12);
    data.ior = clamp(Number(data.ior ?? 1.52), 1.0, 2.6);
    data.dispersionStrength = clamp(Number(data.dispersionStrength ?? 0.6), 0, 1.5);
    data.rotate = clamp(Number(data.rotate ?? 0), -90, 90);
    data.dispersion = !!data.dispersion;
    data.showReflect = data.showReflect !== false;
    if (isMirrorShape(data.shape)) {
      data.opticsMode = 'mirror';
    } else if (data.opticsMode === 'mirror' || !data.opticsMode) {
      data.opticsMode = 'dielectric';
    }

    const equipOpts = {
      force: !!opts.force,
      defer: !!opts.defer,
      deferRays: !!opts.defer,
      keepRays: !!opts.keepRays,
    };
    // Analytic HUD angles via SimBackend (cheap; mesh raytrace stays progressive).
    ensureSimBackend(state.expId, data);
    if (simBackend && isGeometricOpticsExp(state.expId)) {
      syncSimParams(data);
      const angleSnap = simBackend.step(0);
      applySimSnapshot(angleSnap, data);
      if (angleSnap?.deferred) applySimSnapshot(simBackend.getSnapshot?.() || angleSnap, data);
    }

    const snap = equipment.optics?.updateGeometric?.(data, equipOpts)
      || equipment.optics?.updateOptics?.({ ...data, mode: 'geometric', expId: state.expId }, equipOpts);
    if (snap && !opts.defer) {
      // Prefer mesh-traced angles when available; keep sim angles as HUD seed.
      if (snap.theta1 != null) data.theta1 = snap.theta1;
      if (snap.theta2 != null) data.theta2 = snap.theta2;
      if (snap.thetaReflect != null) data.thetaReflect = snap.thetaReflect;
      if (snap.thetaRefract !== undefined) data.thetaRefract = snap.thetaRefract;
    } else if (!Number.isFinite(data.theta1)) {
      // Deferred rebuild or missing mesh snap — analytic / sim angles already applied.
      applyAnalyticAngles(data);
    }

    applyVerifyFields(data);
    data._opticsDirty = false;
    if (refresh) pushHud();
    return data;
  }

  function applyVisualDefaults(expId) {
    if (!equipment.optics) return;
    equipment.optics.clearIdentifyVisuals?.();
    // Drop any in-flight drag so re-entry never inherits a half-dragged slider.
    directManipulation = null;
    if (state.data) {
      state.data.dragArmed = false;
      state.data.dragging = false;
      state.data.dragKind = null;
      state.data._opticsDirty = false;
    }
    if (isGeometricOpticsExp(expId)) {
      // Non-blocking open:
      // 1) HUD + toast immediately (screen keeps moving)
      // 2) Island parented but HIDDEN while compileAsync runs
      // 3) Reveal only when shaders are ready → no whole-tab sync compile hitch
      // 4) Progressive rays after reveal
      equipment.optics.cancelDeferred?.();
      equipment.optics.setMode?.('geometric', { gpuReady: false });
      state.data._awaitRayFlush = false;
      state.data._gpuWarming = true;
      applyAnalyticAngles(state.data);
      applyVerifyFields(state.data);
      toast('正在准备光学器材…画面可继续操作');
      pushHud();

      // Do NOT beginSoftSwitch — that freezes interaction and feels like a stuck screen.
      const runAfterGpu = () => {
        if (!state.running || state.expId !== expId || !state.data) return;
        state.data._gpuWarming = false;
        try {
          syncGeometric(state.data, false, { defer: true });
          applyAnalyticAngles(state.data);
          applyVerifyFields(state.data);
        } catch { /* ignore */ }
        pushHud();
        // soft:false — open path must not pin camera-only soft-switch.
        labFrameScheduler.scheduleCoop?.('optics:rays', () => {
          if (!state.running || state.expId !== expId) return false;
          const more = equipment.optics?.stepDeferredGeometry?.();
          if (more === true) return true;
          const snap = equipment.optics?.snapshotGeometric?.();
          if (snap && state.data) {
            state.data.theta1 = snap.theta1;
            state.data.theta2 = snap.theta2;
            state.data.thetaReflect = snap.thetaReflect;
            state.data.thetaRefract = snap.thetaRefract;
            applyVerifyFields(state.data);
          }
          return false;
        }, { priority: 36, sliceMs: 3, restFrames: 0, maxPulses: 32, soft: false });
        labFrameScheduler.schedule?.('optics:open-hud', () => {
          if (!state.running || state.expId !== expId) return;
          pushHud();
        }, { priority: 30 });
      };

      try {
        const p = equipment.optics?.ensureGeometricReady?.({ onReady: runAfterGpu });
        // If already ready, onReady runs sync; if promise, onReady also fires.
        if (p && typeof p.then === 'function') {
          p.catch?.(() => runAfterGpu());
        }
      } catch {
        runAfterGpu();
      }
      return;
    }
    equipment.optics.setMode?.('diffraction');
    if (expId === 'multi_slit_diffraction') {
      equipment.optics.cancelDeferred?.();
      state.data._awaitDiffFlush = false;
      // No long soft-switch — keep the lab interactive while fringes paint.
      toast('正在绘制衍射图样…');
      pushHud();
      labFrameScheduler.scheduleChain?.('optics:open-diff', [
        () => {
          if (!state.running || state.expId !== expId || !state.data) return;
          syncDiffraction(state.data, false, { force: false });
          pushHud();
        },
        () => {
          if (!state.running || state.expId !== expId) return;
          labFrameScheduler.scheduleCoop?.('optics:fringe', () => {
            if (!state.running || state.expId !== expId) return false;
            return equipment.optics?.stepDiffractionPaint?.() === true;
          }, { priority: 36, sliceMs: 3, restFrames: 0, maxPulses: 40, soft: false });
        },
        () => {
          if (!state.running || state.expId !== expId) return;
          pushHud();
        },
      ], { priority: 42, restFrames: 0, soft: false });
    }
  }

  function armDrag(kind, value) {
    const data = state.data;
    data.dragArmed = true;
    data.dragging = false;
    data.holdAccum = 0;
    data.dragKind = kind;
    data.dragStartValue = Number(value || 0);
    data.dragStartMouseX = Number(equipment.optics?.mouseDrag?.movementX || 0);
  }

  function onUiAction(action, payload = {}) {
    const eid = state.expId;
    const data = state.data;

    // ── Geometric optics (guangxue) ──
    if (isGeometricOpticsExp(eid)) {
      if (action === 'optics-geo-module') {
        const modules = getModulesForExperiment(eid);
        if (!modules) return false;
        const mid = payload.module || payload.id || modules[0].id;
        const mod = getModule(eid, mid);
        if (!mod) return false;
        const cfg = mod.config;
        data.moduleId = mod.id;
        data.moduleCode = mod.code;
        data.shape = cfg.shape;
        data.angle = cfg.angle ?? data.angle;
        data.height = cfg.height ?? 0;
        data.rayCount = cfg.rayCount ?? 1;
        data.ior = cfg.ior ?? data.ior;
        data.dispersion = !!cfg.dispersion;
        data.dispersionStrength = cfg.dispersionStrength ?? data.dispersionStrength;
        data.rotate = cfg.rotate ?? 0;
        data.showReflect = cfg.showReflect !== false;
        data.opticsMode = cfg.mode || (isMirrorShape(cfg.shape) ? 'mirror' : 'dielectric');
        const stepId = stepIdForModule(eid, mod.id);
        if (stepId) setStep(stepId);
        toast(`${mod.code} ${mod.title}`);
        syncGeometric(data);
        return true;
      }
      if (action === 'optics-geo-set' || action === 'optics-geo-param') {
        const key = payload.key;
        const ranges = {
          angle: [0, 75],
          height: [-0.6, 0.6],
          rayCount: [1, 12],
          ior: [1.0, 2.6],
          rotate: [-90, 90],
          dispersionStrength: [0, 1.5],
        };
        if (key === 'shape') {
          data.shape = payload.value;
          if (isMirrorShape(data.shape)) data.opticsMode = 'mirror';
          else data.opticsMode = 'dielectric';
          if (currentStep()?.id === 'setup') setStep('observe');
          syncGeometric(data);
          toast(`元件：${SHAPE_LABELS[data.shape] || data.shape}`);
          return true;
        }
        if (key === 'dispersion' || key === 'showReflect') {
          data[key] = payload.value != null ? !!payload.value : !data[key];
          syncGeometric(data);
          return true;
        }
        if (!ranges[key]) return false;
        const next = payload.value != null && Number.isFinite(Number(payload.value))
          ? Number(payload.value)
          : Number(data[key]) + Number(payload.delta || 0);
        data[key] = clamp(key === 'rayCount' ? Math.round(next) : next, ...ranges[key]);
        if (currentStep()?.id === 'setup') setStep('observe');
        // Continuous live drag must not full-trace on the pointer event stack —
        // mark dirty and let update() rebuild under the frame budget.
        if (payload.live === true) {
          applyAnalyticAngles(data);
          applyVerifyFields(data);
          data._opticsDirty = true;
          return true;
        }
        syncGeometric(data, true);
        return true;
      }
      if (action === 'optics-geo-preset-ior') {
        data.ior = clamp(Number(payload.ior || 1.52), 1.0, 2.6);
        if (currentStep()?.id === 'setup') setStep('observe');
        toast(`介质 n=${data.ior.toFixed(2)}`);
        syncGeometric(data);
        return true;
      }
      if (action === 'optics-geo-toggle') {
        const key = payload.key;
        if (key === 'dispersion' || key === 'showReflect') {
          data[key] = !data[key];
          syncGeometric(data);
          toast(key === 'dispersion'
            ? (data.dispersion ? '色散已开启' : '色散已关闭')
            : (data.showReflect ? '反射线已显示' : '反射线已隐藏'));
          return true;
        }
        return false;
      }
      if (action === 'optics-geo-record') {
        syncGeometric(data, false);
        const reflection = data.opticsMode === 'mirror';
        const theta1 = data.theta1 ?? data.angle;
        const theta2 = reflection ? data.thetaReflect : data.thetaRefract;
        let ratio = '—';
        if (reflection) {
          if (theta2 != null) {
            ratio = Math.abs(theta1 - theta2) < 0.5 ? 'θᵢ≈θᵣ ✓' : '偏差较大';
          }
        } else if (theta2 != null && theta2 > 0.05) {
          ratio = snellRatio(theta1, theta2)?.toFixed(3) || '—';
        } else if (theta2 == null) {
          ratio = 'TIR';
        }
        const mod = data.moduleId ? getModule(eid, data.moduleId) : null;
        const record = {
          shape: data.shape,
          shapeLabel: SHAPE_LABELS[data.shape] || data.shape,
          ior: data.ior,
          theta1,
          theta2,
          deltaTheta: reflection && theta2 != null ? Math.abs(theta1 - theta2) : null,
          ratio,
          note: mod ? `${mod.code} ${mod.shortNote}` : (getGeometricExperiment(eid)?.name || eid),
          moduleId: data.moduleId || null,
          moduleCode: data.moduleCode || null,
          rotate: data.rotate,
          rayCount: data.rayCount,
          dispersion: data.dispersion,
          opticsMode: data.opticsMode,
          tir: !reflection && theta2 == null,
        };
        data.records = [...(data.records || []), record].slice(-24);
        data.tableScrollAuto = true;
        setStep('record');
        toast(reflection
          ? `记录 #${data.records.length}：θᵢ=${Number(theta1).toFixed(1)}° θᵣ=${theta2 == null ? '—' : `${Number(theta2).toFixed(1)}°`}`
          : `记录 #${data.records.length}：θ₁=${Number(theta1).toFixed(1)}° θ₂=${theta2 == null ? 'TIR' : `${Number(theta2).toFixed(1)}°`}`);
        syncGeometric(data);
        return true;
      }
      if (action === 'optics-geo-clear') {
        data.records = [];
        data.recordsPanelOpen = false;
        data.tableScrollTop = 0;
        data.tableScrollAuto = true;
        toast('数据表已清空');
        syncGeometric(data);
        return true;
      }
      if (action === 'optics-geo-records-panel') {
        if (payload.open === true) data.recordsPanelOpen = true;
        else if (payload.open === false) data.recordsPanelOpen = false;
        else data.recordsPanelOpen = !data.recordsPanelOpen;
        syncGeometric(data);
        return true;
      }
      if (action === 'hall-scroll-table') {
        if (!data.records?.length || !data.recordsPanelOpen) return false;
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
        let rowDelta = Number(payload?.delta || 0);
        if (Number.isFinite(Number(payload?.deltaPx))) {
          const rowH = Number.isFinite(Number(payload?.rowH)) && Number(payload.rowH) > 0
            ? Number(payload.rowH)
            : 26;
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
        syncGeometric(data);
        return true;
      }
      if (action === 'optics-geo-complete') {
        if (!data.records?.length) {
          toast('请先记录至少一组数据后再完成');
          return true;
        }
        data.completed = true;
        data.recordsPanelOpen = false;
        state.stepIndex = Math.max(0, (currentStep() ? 3 : 3));
        const exp = getGeometricExperiment(eid);
        const last = exp?.steps?.length ? exp.steps.length - 1 : 3;
        state.stepIndex = last;
        toast(`实验完成：已记录 ${data.records.length} 组`);
        syncGeometric(data);
        return true;
      }
      if (action === 'optics-geo-reset') {
        const fresh = initData(eid);
        Object.keys(data).forEach((k) => { delete data[k]; });
        Object.assign(data, fresh);
        toast('已重置为实验默认配置');
        syncGeometric(data);
        return true;
      }
      return false;
    }

    if (eid !== 'multi_slit_diffraction') return false;

    if (action === 'optics-diff-power') {
      data.lightOn = !data.lightOn;
      if (data.lightOn && currentStep()?.id === 'setup') setStep('observe');
      toast(data.lightOn ? '激光器已打开' : '激光器已关闭');
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-preset') {
      const key = payload.preset || 'double';
      const preset = DIFF_PRESETS[key] || DIFF_PRESETS.double;
      Object.assign(data, preset, { preset: key, lightOn: true, chartOpen: false, demoOn: false });
      setStep('observe');
      toast(`已切换：${{ single: '单缝', double: '双缝', triple: '三缝', multi: '六缝', grating: '十缝光栅', hene2: 'He-Ne 双缝' }[key] || key}`);
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-param' || action === 'optics-diff-set') {
      const key = payload.key;
      const ranges = {
        lambdaNm: [380, 780], slitMm: [0.01, 0.4], pitchMm: [0.02, 1], N: [1, 12], distM: [0.4, 2],
      };
      if (!ranges[key]) return false;
      const next = payload.value != null && Number.isFinite(Number(payload.value))
        ? Number(payload.value)
        : Number(data[key]) + Number(payload.delta || 0);
      data[key] = clamp(key === 'N' ? Math.round(next) : next, ...ranges[key]);
      data.preset = 'custom';
      data.demoOn = false;
      if (currentStep()?.id === 'setup') setStep('observe');
      syncDiffraction(data, payload.live !== true);
      return true;
    }
    if (action === 'optics-diff-toggle') {
      const key = payload.key;
      if (key === 'showBeam' || key === 'showWave') data[key] = !data[key];
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-demo') {
      data.demoOn = !data.demoOn;
      data.demoElapsed = 0;
      toast(data.demoOn ? '自动扫频：430–680 nm' : '自动扫频已停止');
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-record') {
      syncDiffraction(data, false);
      const record = {
        lambdaNm: data.lambdaNm,
        slitMm: data.slitMm,
        pitchMm: data.pitchMm,
        N: data.N,
        distM: data.distM,
        fringeSpacingMm: data.fringeSpacingMm,
        centralWidthMm: data.centralWidthMm,
        principalHalfWidthMm: data.principalHalfWidthMm,
        fresnel: data.fresnel,
        farField: !!data.farField,
      };
      data.records = [...(data.records || []), record].slice(-24);
      data.tableScrollAuto = true;
      // Keep the main controls visible; open「对照表」only when the user asks.
      setStep('measure');
      toast(
        `对照 #${data.records.length}：Δx=${data.fringeSpacingMm.toFixed(3)} mm · `
        + `包络=${data.centralWidthMm.toFixed(2)} mm · 改参后再写，点「对照表」查看`,
      );
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-clear') {
      data.records = [];
      data.chartOpen = false;
      data.recordsPanelOpen = false;
      data.tableScrollTop = 0;
      data.tableScrollAuto = true;
      toast('对照表已清空');
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-chart') {
      data.chartOpen = !data.chartOpen;
      if (data.chartOpen) {
        data.recordsPanelOpen = false;
        setStep('curve');
        toast(
          data.N <= 1
            ? '核对：包络零点 ≈ ±m λL/a · 远场要求 F≪1'
            : '核对：主极大间距 Δx=λL/d · 包络零点 ±m λL/a · 远场 F≪1',
        );
      } else {
        toast('已关闭曲线标注');
      }
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-records-panel') {
      if (payload.open === true) data.recordsPanelOpen = true;
      else if (payload.open === false) data.recordsPanelOpen = false;
      else data.recordsPanelOpen = !data.recordsPanelOpen;
      if (data.recordsPanelOpen) {
        data.chartOpen = false;
        if ((data.records || []).length) setStep('measure');
      }
      syncDiffraction(data);
      return true;
    }
    // Shared scroll action name used by hologram hit regions (hall / thermo / optics).
    if (action === 'hall-scroll-table') {
      if (!data.records?.length || !data.recordsPanelOpen) return false;
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
      let rowDelta = Number(payload?.delta || 0);
      if (Number.isFinite(Number(payload?.deltaPx))) {
        const rowH = Number.isFinite(Number(payload?.rowH)) && Number(payload.rowH) > 0
          ? Number(payload.rowH)
          : 26;
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
      syncDiffraction(data);
      return true;
    }
    if (action === 'optics-diff-complete') {
      if (!data.records.length) {
        toast('请先写入至少一组对照（保存 Δx / 包络宽后再完成）');
        return true;
      }
      data.completed = true;
      data.recordsPanelOpen = false;
      data.chartOpen = false;
      state.stepIndex = 4;
      toast(`实验完成：对照表中有 ${data.records.length} 组配置，可回顾 Δx 与包络如何随参变化`);
      syncDiffraction(data);
      return true;
    }
    return false;
  }

  function interact(target, _t, step) {
    if (!step) return false;
    const role = target?.userData?.role;
    const data = state.data;

    if (isGeometricOpticsExp(state.expId)) {
      if (role === 'geo_source' || role === 'geo_optic') {
        armDrag('angle', data.angle);
        toast('拖动调节入射角 θ');
        return true;
      }
      if (role === 'geo_sample') {
        armDrag('rotate', data.rotate);
        toast('拖动样品台：调节台面转角');
        return true;
      }
      if (role === 'geo_slit') {
        armDrag('rayCount', data.rayCount);
        toast('拖动/滚轮调节光束条数');
        return true;
      }
      if (role === 'geo_screen') {
        toast('观察屏：折射/色散光斑投影于此');
        return true;
      }
      if (role === 'ui_action' || role === 'generic') {
        if (step.id === 'record' || step.id === 'measure') return onUiAction('optics-geo-record');
        if (step.id === 'result') return onUiAction('optics-geo-complete');
        return onUiAction('optics-geo-record');
      }
      return false;
    }

    if (state.expId !== 'multi_slit_diffraction') return false;

    if (role === 'diff_source') return onUiAction('optics-diff-power');
    if (role === 'diff_screen') {
      armDrag('distM', data.distM);
      toast('拖动观察屏：调节缝屏距 L');
      return true;
    }
    if (role === 'diff_slit') {
      toast('滚轮调节缝宽 a；在全息屏可调缝数与缝距');
      return true;
    }
    if (role === 'ui_action' || role === 'generic') {
      if (step.id === 'setup') return onUiAction('optics-diff-power');
      if (step.id === 'curve') return onUiAction('optics-diff-chart', {});
      if (step.id === 'result') return onUiAction('optics-diff-complete');
      if (step.id === 'measure') return onUiAction('optics-diff-record');
      return onUiAction('optics-diff-record');
    }
    return false;
  }

  function onKey(code) {
    if (isGeometricOpticsExp(state.expId)) {
      if (code === 'KeyR' || code === 'KeyF') return onUiAction('optics-geo-record');
      if (code === 'KeyC') return onUiAction('optics-geo-complete');
      return false;
    }
    if (state.expId !== 'multi_slit_diffraction') return false;
    if (code === 'KeyL') return onUiAction('optics-diff-power');
    if (code === 'KeyR' || code === 'KeyF') return onUiAction('optics-diff-record');
    if (code === 'KeyC') return onUiAction('optics-diff-chart');
    return false;
  }

  function onWheel(delta, target) {
    const sign = delta > 0 ? -1 : 1;
    if (isGeometricOpticsExp(state.expId)) {
      const role = target?.userData?.role;
      if (role === 'geo_source' || role === 'geo_optic') {
        return onUiAction('optics-geo-param', { key: 'angle', delta: sign * 1 });
      }
      if (role === 'geo_sample') {
        return onUiAction('optics-geo-param', { key: 'rotate', delta: sign * 2 });
      }
      if (role === 'geo_slit') {
        return onUiAction('optics-geo-param', { key: 'rayCount', delta: sign * 1 });
      }
      return onUiAction('optics-geo-param', { key: 'angle', delta: sign * 1 });
    }
    if (state.expId !== 'multi_slit_diffraction') return false;
    const role = target?.userData?.role;
    if (role === 'diff_source') {
      return onUiAction('optics-diff-param', { key: 'lambdaNm', delta: sign * 2 });
    }
    if (role === 'diff_screen') {
      return onUiAction('optics-diff-param', { key: 'distM', delta: sign * 0.02 });
    }
    if (role === 'diff_slit') {
      return onUiAction('optics-diff-param', { key: 'slitMm', delta: sign * 0.002 });
    }
    return onUiAction('optics-diff-param', { key: 'pitchMm', delta: sign * 0.005 });
  }

  function holdInteract(holding, _t, dt) {
    const data = state.data;
    if (!data?.dragArmed) return;

    if (isGeometricOpticsExp(state.expId)) {
      if (holding) {
        data.holdAccum = (data.holdAccum || 0) + dt;
        if (!data.dragging && data.holdAccum > 0.08) data.dragging = true;
        if (!data.dragging) return;
        const mouseX = Number(equipment.optics?.mouseDrag?.movementX || 0);
        const deltaPx = mouseX - Number(data.dragStartMouseX || 0);
        const kind = data.dragKind;
        const start = Number(data.dragStartValue || 0);
        if (kind === 'angle') {
          data.angle = clamp(start + deltaPx * 0.12, 0, 75);
          syncGeometric(data, false);
        } else if (kind === 'rotate') {
          data.rotate = clamp(start + deltaPx * 0.2, -90, 90);
          syncGeometric(data, false);
        } else if (kind === 'rayCount') {
          data.rayCount = clamp(Math.round(start + deltaPx * 0.04), 1, 12);
          syncGeometric(data, false);
        } else if (kind === 'ior') {
          data.ior = clamp(start + deltaPx * 0.004, 1.0, 2.6);
          syncGeometric(data, false);
        }
        return;
      }
      const moved = !!data.dragging;
      data.dragArmed = false;
      data.dragging = false;
      data.holdAccum = 0;
      const kind = data.dragKind;
      data.dragKind = null;
      if (!moved) return;
      syncGeometric(data);
      if (kind === 'angle') toast(`入射角 θ=${data.angle.toFixed(1)}°`);
      else if (kind === 'rotate') toast(`台面转角 ${data.rotate.toFixed(0)}°`);
      else if (kind === 'rayCount') toast(`光束数 N=${data.rayCount}`);
      return;
    }

    if (state.expId !== 'multi_slit_diffraction') return;
    if (holding) {
      data.holdAccum = (data.holdAccum || 0) + dt;
      if (!data.dragging && data.holdAccum > 0.08) data.dragging = true;
      if (!data.dragging) return;
      const mouseX = Number(equipment.optics?.mouseDrag?.movementX || 0);
      const deltaPx = mouseX - Number(data.dragStartMouseX || 0);
      const kind = data.dragKind;
      const start = Number(data.dragStartValue || 0);
      if (kind === 'distM') {
        data.distM = clamp(start + deltaPx * 0.003, 0.4, 2);
        data.preset = 'custom';
        syncDiffraction(data, false);
      }
      return;
    }
    const moved = !!data.dragging;
    data.dragArmed = false;
    data.dragging = false;
    data.holdAccum = 0;
    data.dragKind = null;
    if (!moved) return;
    syncDiffraction(data);
    toast(`缝屏距 L=${data.distM.toFixed(2)} m`);
  }

  function beginManipulation(target, context = {}) {
    if (isGeometricOpticsExp(state.expId)) {
      const role = target?.userData?.role;
      const keyByRole = {
        geo_source: 'angle',
        geo_optic: 'angle',
        geo_sample: 'rotate',
        geo_slit: 'rayCount',
      };
      const key = keyByRole[role];
      if (!key) return interact(target, context.time || 0, currentStep());
      directManipulation = {
        role,
        key,
        start: Number(state.data[key]),
        dragged: false,
      };
      if (key === 'angle') toast('水平拖动调节入射角');
      if (key === 'rotate') toast('水平拖动调节台面转角');
      if (key === 'rayCount') toast('水平拖动调节光束条数');
      return true;
    }
    if (state.expId !== 'multi_slit_diffraction') return false;
    const role = target?.userData?.role;
    const keyByRole = {
      diff_source: 'lambdaNm',
      diff_screen: 'distM',
      diff_slit: 'slitMm',
    };
    const key = keyByRole[role];
    if (!key) return interact(target, context.time || 0, currentStep());
    directManipulation = {
      role,
      key,
      start: Number(state.data[key]),
      dragged: false,
    };
    if (role === 'diff_source') toast('短捏合开关激光；水平拖动调节波长');
    if (role === 'diff_screen') toast('水平拖动观察屏，调节缝屏距 L');
    if (role === 'diff_slit') toast('水平拖动狭缝，调节缝宽 a');
    return true;
  }

  const _invMat = new THREE.Matrix4();
  const _localRay = new THREE.Ray();

  function resolveOpticsApparatusRoot(mode) {
    if (!equipment.optics) return null;
    return equipment.optics.getRuntimeRoot?.(mode)
      || (mode === 'multi_slit_diffraction' || mode === 'diffraction' ? equipment.optics.opticsGroup : equipment.optics.geoRig)
      || equipment.optics.getRoot?.()
      || equipment.optics.root
      || (equipment.optics.isObject3D ? equipment.optics : null);
  }

  function updateManipulation(_target, context = {}) {
    if (!directManipulation) return false;
    directManipulation.dragged = true;
    const role = directManipulation.role;
    const key = directManipulation.key;

    // ── 3D Crosshair / Raycast direct tracking ("指哪打哪",跟手) ──
    if (context.raycaster?.ray) {
      if (state.expId === 'multi_slit_diffraction' && role === 'diff_screen') {
        const root = resolveOpticsApparatusRoot('multi_slit_diffraction');
        if (root) {
          if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
          if (root.matrixWorld) {
            _invMat.copy(root.matrixWorld).invert();
            _localRay.copy(context.raycaster.ray).applyMatrix4(_invMat);
          } else {
            _localRay.copy(context.raycaster.ray);
          }
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.39);
          const hit = new THREE.Vector3();
          if (_localRay.intersectPlane(plane, hit)) {
            // slitX is -0.32, screenX = slitX + 0.34 + ((distM - 0.4) / 1.6) * 0.9
            const slitX = -0.32;
            const targetDistM = THREE.MathUtils.clamp(
              0.4 + ((hit.x - (slitX + 0.34)) / 0.9) * 1.6,
              0.4,
              2.0,
            );
            return onUiAction('optics-diff-param', {
              key: 'distM',
              value: targetDistM,
            });
          }
        }
      }

      if (isGeometricOpticsExp(state.expId) && (key === 'angle' || key === 'rotate')) {
        const root = resolveOpticsApparatusRoot('geometric');
        if (root) {
          if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
          if (root.matrixWorld) {
            _invMat.copy(root.matrixWorld).invert();
            _localRay.copy(context.raycaster.ray).applyMatrix4(_invMat);
          } else {
            _localRay.copy(context.raycaster.ray);
          }
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.38);
          const hit = new THREE.Vector3();
          if (_localRay.intersectPlane(plane, hit)) {
            if (key === 'angle') {
              const angDeg = THREE.MathUtils.clamp(
                Math.abs(Math.atan2(hit.z, -hit.x) * (180 / Math.PI)),
                0,
                85,
              );
              return onUiAction('optics-geo-param', {
                key: 'angle',
                value: angDeg,
                live: true,
              });
            }
            if (key === 'rotate') {
              const rotDeg = Math.atan2(hit.z, hit.x) * (180 / Math.PI);
              return onUiAction('optics-geo-param', {
                key: 'rotate',
                value: rotDeg,
                live: true,
              });
            }
          }
        }
      }
    }

    // ── Fallback relative delta drag ──
    const totalX = Number(context.totalX || 0);
    if (isGeometricOpticsExp(state.expId)) {
      const sensitivities = { angle: 0.12, rotate: 0.2, rayCount: 0.04, ior: 0.004 };
      return onUiAction('optics-geo-param', {
        key: directManipulation.key,
        value: directManipulation.start + totalX * (sensitivities[directManipulation.key] || 0.1),
        live: true,
      });
    }
    const sensitivities = { lambdaNm: 0.4, distM: 0.003, slitMm: 0.0005 };
    return onUiAction('optics-diff-param', {
      key: directManipulation.key,
      value: directManipulation.start + totalX * sensitivities[directManipulation.key],
    });
  }

  function endManipulation(target, context = {}) {
    if (!directManipulation) return false;
    const direct = directManipulation;
    directManipulation = null;
    if (context.cancelled) return true;
    if (isGeometricOpticsExp(state.expId)) {
      if (!context.dragged) return true;
      syncGeometric(state.data);
      const labels = {
        angle: `入射角 θ=${state.data.angle.toFixed(1)}°`,
        rotate: `台面转角 ${state.data.rotate.toFixed(0)}°`,
        rayCount: `光束数 N=${state.data.rayCount}`,
        ior: `折射率 n=${state.data.ior.toFixed(2)}`,
      };
      toast(labels[direct.key] || '调节完成');
      return true;
    }
    if (!context.dragged && direct.role === 'diff_source') {
      return onUiAction('optics-diff-power');
    }
    if (!context.dragged) return true;
    const labels = {
      lambdaNm: `波长 λ=${state.data.lambdaNm.toFixed(0)} nm`,
      distM: `缝屏距 L=${state.data.distM.toFixed(2)} m`,
      slitMm: `缝宽 a=${state.data.slitMm.toFixed(3)} mm`,
    };
    syncDiffraction(state.data);
    toast(labels[direct.key] || '调节完成');
    return true;
  }

  function onFocus() {
    /* 光学不以「识别框」为主 */
  }

  function update(_t, dt) {
    if (!state.data) return state.data;
    if (isGeometricOpticsExp(state.expId)) {
      const data = state.data;
      // Heavy ray rebuild / dirty re-trace → frame budget (never pre-render hitch).
      if (data._awaitRayFlush) {
        data._awaitRayFlush = false;
        const expId = state.expId;
        labFrameScheduler.rest?.(1);
        labFrameScheduler.schedule('optics:ray-flush', () => {
          if (!state.running || state.expId !== expId || !state.data) return;
          const snap = equipment.optics?.flushDeferredGeometry?.()
            || equipment.optics?.snapshotGeometric?.();
          if (snap) {
            state.data.theta1 = snap.theta1;
            state.data.theta2 = snap.theta2;
            state.data.thetaReflect = snap.thetaReflect;
            state.data.thetaRefract = snap.thetaRefract;
            applyVerifyFields(state.data);
            pushHud();
          }
          labFrameScheduler.rest?.(1);
        }, { priority: 40 });
      }
      if (data._opticsDirty) {
        data._opticsDirty = false;
        const expId = state.expId;
        // Progressive rebuild: mesh params now, one beam per coop slice.
        labFrameScheduler.rest?.(1);
        labFrameScheduler.schedule('optics:dirty-geo', () => {
          if (!state.running || state.expId !== expId || !state.data) return;
          syncGeometric(state.data, false, { defer: true, keepRays: true });
          labFrameScheduler.scheduleCoop?.('optics:rays', () => {
            if (!state.running || state.expId !== expId) return false;
            const more = equipment.optics?.stepDeferredGeometry?.();
            if (more === true) return true;
            const snap = equipment.optics?.snapshotGeometric?.();
            if (snap && state.data) {
              state.data.theta1 = snap.theta1;
              state.data.theta2 = snap.theta2;
              state.data.thetaReflect = snap.thetaReflect;
              state.data.thetaRefract = snap.thetaRefract;
              applyVerifyFields(state.data);
              pushHud();
            }
            return false;
          }, { priority: 34, sliceMs: 3, restFrames: 0, maxPulses: 24, soft: false });
        }, { priority: 38 });
      }
      data._hudThrottle = (data._hudThrottle || 0) + dt;
      // No HUD work while the station menu/panel is closed (avoids thrash after ×).
      if (state.menuOpen && data._hudThrottle > 0.35) {
        data._hudThrottle = 0;
        pushHud();
      }
      return data;
    }
    if (state.expId !== 'multi_slit_diffraction') return state.data;
    const data = state.data;
    // Pull any deferred worker fringe samples that completed after last sync.
    if (simBackend && simBackendExpId === 'multi_slit_diffraction') {
      const prevGen = data._simIntensityGen | 0;
      applySimSnapshot(simBackend.getSnapshot?.(), data);
      if ((data._simIntensityGen | 0) !== prevGen) {
        // Host samples landed — re-paint screen from _simIntensity.
        equipment.optics?.updateOptics?.(data, { force: false });
      }
    }
    // Only schedule fringe flush when switch path left work pending.
    if (data._awaitDiffFlush) {
      data._awaitDiffFlush = false;
      labFrameScheduler.rest?.(1);
      labFrameScheduler.schedule('optics:diff-flush', () => {
        if (!state.running || state.expId !== 'multi_slit_diffraction') return;
        equipment.optics?.flushDeferredDiffraction?.();
        labFrameScheduler.rest?.(1);
      }, { priority: 40 });
    }
    if (data._opticsDirty) {
      data._opticsDirty = false;
      labFrameScheduler.rest?.(1);
      labFrameScheduler.schedule('optics:dirty-diff', () => {
        if (!state.running || state.expId !== 'multi_slit_diffraction' || !state.data) return;
        syncDiffraction(state.data, false);
        labFrameScheduler.rest?.(1);
      }, { priority: 38 });
    }
    // Demo / dirty HUD only while the station panel is open.
    if (!state.menuOpen) return data;
    if (data.demoOn) {
      data.demoElapsed = (data.demoElapsed || 0) + dt;
      if (data.demoElapsed >= 0.08) {
        data.demoElapsed = 0;
        data.demoPhase = (data.demoPhase || 0) + 0.06;
        data.lambdaNm = Math.round(555 + 125 * Math.sin(data.demoPhase));
        data.preset = 'custom';
        labFrameScheduler.schedule('optics:demo-diff', () => {
          if (!state.running || state.expId !== 'multi_slit_diffraction' || !state.data) return;
          syncDiffraction(state.data, false);
        }, { priority: 30 });
      }
    }
    data._hudThrottle = (data._hudThrottle || 0) + dt;
    if (data._hudThrottle > 0.4) {
      data._hudThrottle = 0;
      pushHud();
    }
    return data;
  }

  function cleanup() {
    directManipulation = null;
    disposeSimBackend();
    if (state.data) {
      state.data._awaitRayFlush = false;
      state.data._awaitDiffFlush = false;
      state.data._opticsDirty = false;
      state.data.demoOn = false;
      state.data.dragArmed = false;
      state.data.dragging = false;
      state.data._simIntensity = null;
      state.data._simHalfSpanM = null;
      state.data._simIntensityGen = 0;
    }
    // Abort multi-frame open / dirty / freeze chains so they cannot flush into idle
    // or keep soft-switch sessions alive after × close.
    [
      'optics:open-geo',
      'optics:open-diff',
      'optics:rays',
      'optics:fringe',
      'optics:ray-flush',
      'optics:diff-flush',
      'optics:dirty-geo',
      'optics:dirty-diff',
      'optics:demo-diff',
      'optics:freeze',
      'optics:unfreeze',
    ].forEach((id) => labFrameScheduler.cancel?.(id));
    // Return to idle diffraction showcase on the table (not an empty bench).
    try {
      equipment.optics?.clearIdentifyVisuals?.();
      equipment.optics?.cancelDeferred?.();
      if (typeof equipment.optics?.showcase === 'function') {
        equipment.optics.showcase();
      } else if (typeof equipment.optics?.suspend === 'function') {
        equipment.optics.suspend();
      } else {
        equipment.optics?.setMode?.('idle');
      }
    } catch { /* ignore */ }
    // Release camera-only soft window left by open/close chains.
    labFrameScheduler.endSoftSwitch?.();
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
