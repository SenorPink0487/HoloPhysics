/**
 * Pure optics simulation kinds (no Three.js).
 */

import { SIM_KIND } from '../simTypes.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v)));
}

/**
 * Multi-slit Fraunhofer intensity samples along the screen.
 * @param {{
 *   lambdaNm?: number,
 *   slitMm?: number,
 *   pitchMm?: number,
 *   N?: number,
 *   distM?: number,
 *   samples?: number,
 *   halfSpanM?: number,
 * }} [initial]
 */
export function createDiffractionFringeKind(initial = {}) {
  let lambdaNm = Number(initial.lambdaNm) || 550;
  let slitMm = Number(initial.slitMm) || 0.05;
  let pitchMm = Number(initial.pitchMm) || 0.25;
  let N = Math.max(1, Math.round(Number(initial.N) || 2));
  let distM = Number(initial.distM) || 1;
  const samples = Math.max(16, initial.samples | 0 || 256);
  let halfSpanOverride = initial.halfSpanM != null ? Number(initial.halfSpanM) : null;
  let intensity = new Float32Array(samples);
  let simTime = 0;
  let generation = 0;

  function halfSpan() {
    if (halfSpanOverride != null && halfSpanOverride > 0) return halfSpanOverride;
    const lambda = lambdaNm * 1e-9;
    const a = slitMm * 1e-3;
    const d = pitchMm * 1e-3;
    const L = distM;
    const env = (lambda * L / Math.max(1e-12, a)) * 3.2;
    const fringes = (lambda * L / Math.max(1e-12, d)) * Math.min(12, 2 + N * 2);
    return Math.min(0.15, Math.max(0.01, Math.max(env, fringes)));
  }

  function intensityAt(x) {
    const lambda = lambdaNm * 1e-9;
    const a = slitMm * 1e-3;
    const d = pitchMm * 1e-3;
    const L = distM;
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

  function rebuild() {
    const half = halfSpan();
    for (let i = 0; i < samples; i += 1) {
      const u = samples === 1 ? 0 : i / (samples - 1);
      const x = -half + u * 2 * half;
      intensity[i] = intensityAt(x);
    }
  }

  rebuild();

  return {
    kind: SIM_KIND.DIFFRACTION_FRINGE,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.lambdaNm != null) lambdaNm = Number(payload.lambdaNm);
        if (payload.slitMm != null) slitMm = Number(payload.slitMm);
        if (payload.pitchMm != null) pitchMm = Number(payload.pitchMm);
        if (payload.N != null) N = Math.max(1, Math.round(Number(payload.N)));
        if (payload.distM != null) distM = Number(payload.distM);
        if (payload.halfSpanM != null) halfSpanOverride = Number(payload.halfSpanM);
        return true;
      }
      if (op === 'rebuild') {
        rebuild();
        generation += 2;
        return true;
      }
      if (op === 'reset') {
        lambdaNm = 550;
        slitMm = 0.05;
        pitchMm = 0.25;
        N = 2;
        distM = 1;
        halfSpanOverride = null;
        rebuild();
        simTime = 0;
        return true;
      }
      return false;
    },

    step(dt) {
      simTime += Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      rebuild();
      generation += 2;
      return this.getSnapshot();
    },

    getSnapshot() {
      const half = halfSpan();
      const lambda = lambdaNm * 1e-9;
      const a = slitMm * 1e-3;
      const d = pitchMm * 1e-3;
      return {
        kind: SIM_KIND.DIFFRACTION_FRINGE,
        simTime,
        generation,
        steps: 1,
        scalars: {
          lambdaNm,
          slitMm,
          pitchMm,
          N,
          distM,
          halfSpanM: half,
          samples,
          fringeSpacingMm: (lambda * distM / Math.max(1e-12, d)) * 1e3,
          centralWidthMm: (2 * lambda * distM / Math.max(1e-12, a)) * 1e3,
          principalHalfWidthMm: (lambda * distM / (N * Math.max(1e-12, d))) * 1e3,
        },
        fields: { intensity: new Float32Array(intensity) },
      };
    },

    dispose() {
      intensity = new Float32Array(0);
    },
  };
}

/**
 * Analytic geometric optics angles (plane interface / Snell).
 * Mesh raytraces stay on the main-thread progressive path; this kind
 * supplies HUD θ₁/θ₂ without blocking.
 * @param {{
 *   angle?: number,
 *   ior?: number,
 *   airIor?: number,
 *   mode?: 'reflect' | 'refract',
 * }} [initial]
 */
export function createGeometricAnglesKind(initial = {}) {
  let angle = Number(initial.angle) || 35;
  let ior = Number(initial.ior) || 1.5;
  let airIor = Number(initial.airIor) || 1.0;
  let mode = initial.mode === 'reflect' ? 'reflect' : 'refract';
  let simTime = 0;
  let generation = 0;

  function compute() {
    const theta1 = clamp(angle, 0, 89.9);
    const rad1 = (theta1 * Math.PI) / 180;
    // Plane interface with outward normal; reflect θ_r = θ_i.
    const thetaReflect = theta1;
    let thetaRefract = null;
    let tir = false;
    if (mode === 'refract') {
      const sin2 = (airIor / Math.max(1e-6, ior)) * Math.sin(rad1);
      if (Math.abs(sin2) > 1) {
        tir = true;
        thetaRefract = null;
      } else {
        thetaRefract = (Math.asin(sin2) * 180) / Math.PI;
      }
    }
    return {
      theta1,
      theta2: thetaRefract == null ? theta1 : thetaRefract,
      thetaReflect,
      thetaRefract,
      tir,
    };
  }

  return {
    kind: SIM_KIND.GEOMETRIC_ANGLES,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.angle != null) angle = Number(payload.angle);
        if (payload.ior != null) ior = Number(payload.ior);
        if (payload.airIor != null) airIor = Number(payload.airIor);
        if (payload.mode != null) mode = payload.mode === 'reflect' ? 'reflect' : 'refract';
        return true;
      }
      if (op === 'reset') {
        angle = 35;
        ior = 1.5;
        mode = 'refract';
        simTime = 0;
        return true;
      }
      return false;
    },

    step(dt) {
      simTime += Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      generation += 2;
      return this.getSnapshot();
    },

    getSnapshot() {
      const a = compute();
      return {
        kind: SIM_KIND.GEOMETRIC_ANGLES,
        simTime,
        generation,
        steps: 1,
        scalars: {
          angle,
          ior,
          airIor,
          mode,
          ...a,
        },
      };
    },

    dispose() {},
  };
}

/**
 * @param {string} kind
 * @param {object} [options]
 */
export function createOpticsKind(kind, options = {}) {
  switch (kind) {
    case SIM_KIND.DIFFRACTION_FRINGE:
      return createDiffractionFringeKind(options);
    case SIM_KIND.GEOMETRIC_ANGLES:
      return createGeometricAnglesKind(options);
    default:
      throw new Error(`Unknown optics sim kind: ${kind}`);
  }
}

export { SIM_KIND };
