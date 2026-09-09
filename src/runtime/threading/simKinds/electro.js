/**
 * Pure electro simulation kinds (no Three.js).
 */

import { PARTICLE_STRIDE_POS_VEL, SIM_KIND } from '../simTypes.js';

const K_COULOMB = 9.0e9;
const CHARGE_UI_TO_C = 1e-6;
const EPSILON_0 = 1 / (4 * Math.PI * K_COULOMB);
const COULOMB_SCALE = K_COULOMB * CHARGE_UI_TO_C;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function fieldAt(charges, px, py, pz, minR = 0.04) {
  let ex = 0;
  let ey = 0;
  let ez = 0;
  const minR2 = minR * minR;
  for (let i = 0; i < charges.length; i += 1) {
    const c = charges[i];
    const q = Number(c?.q || 0);
    if (Math.abs(q) < 1e-6) continue;
    const dx = px - Number(c.x || 0);
    const dy = py - Number(c.y || 0);
    const dz = pz - Number(c.z || 0);
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 < minR2) continue;
    const inv = (COULOMB_SCALE * q) / (r2 * Math.sqrt(r2));
    ex += dx * inv;
    ey += dy * inv;
    ez += dz * inv;
  }
  return { x: ex, y: ey, z: ez };
}

function nearAnyCharge(charges, px, py, pz, minDist) {
  const minDistSq = minDist * minDist;
  for (let i = 0; i < charges.length; i += 1) {
    const c = charges[i];
    const dx = px - Number(c.x || 0);
    const dy = py - Number(c.y || 0);
    const dz = pz - Number(c.z || 0);
    if (dx * dx + dy * dy + dz * dz < minDistSq) return true;
  }
  return false;
}

function sourceDirs(count) {
  const dirs = [];
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i;
    dirs.push({
      x: Math.cos(theta) * radial,
      y,
      z: Math.sin(theta) * radial,
    });
  }
  return dirs;
}

/**
 * Trace electrostatic field lines from point charges.
 * Packed buffer: [lineCount, n0, x0,y0,z0…, n1, …]
 * @param {{
 *   charges?: Array<{q:number,x:number,y:number,z:number}>,
 * }} [initial]
 */
export function createElectricFieldLinesKind(initial = {}) {
  let charges = (initial.charges || []).map((c) => ({
    q: Number(c.q) || 0,
    x: Number(c.x) || 0,
    y: Number(c.y) || 0,
    z: Number(c.z) || 0,
  }));
  let simTime = 0;
  let generation = 0;
  let packed = new Float32Array(1);
  packed[0] = 0;

  function rebuild() {
    if (!charges.length) {
      packed = new Float32Array([0]);
      return;
    }
    let totalAbs = 0;
    for (let i = 0; i < charges.length; i += 1) totalAbs += Math.abs(charges[i].q);
    const lineCountBudget = Math.min(72, Math.max(12, Math.round(18 + totalAbs * 10)));
    /** @type {number[][]} */
    const lines = [];
    for (let c = 0; c < charges.length; c += 1) {
      const charge = charges[c];
      if (Math.abs(charge.q) < 0.05) continue;
      const sign = charge.q > 0 ? 1 : -1;
      const share = Math.max(
        6,
        Math.round((lineCountBudget * Math.min(Math.abs(charge.q), 2.5)) / Math.max(charges.length, 1)),
      );
      const dirs = sourceDirs(share);
      for (let d = 0; d < dirs.length; d += 1) {
        const direction = dirs[d];
        let px = charge.x + direction.x * 0.26;
        let py = charge.y + direction.y * 0.26;
        let pz = charge.z + direction.z * 0.26;
        const pts = [px, py, pz];
        for (let step = 0; step < 90; step += 1) {
          const f = fieldAt(charges, px, py, pz);
          const mag = Math.hypot(f.x, f.y, f.z);
          if (mag < 1e-5) break;
          px += (f.x * sign * 0.09) / mag;
          py += (f.y * sign * 0.09) / mag;
          pz += (f.z * sign * 0.09) / mag;
          if (Math.hypot(px, py, pz) > 9 || nearAnyCharge(charges, px, py, pz, 0.2)) break;
          pts.push(px, py, pz);
        }
        if (pts.length >= 6) lines.push(pts);
      }
    }
    let floats = 1;
    for (let i = 0; i < lines.length; i += 1) floats += 1 + lines[i].length;
    packed = new Float32Array(floats);
    packed[0] = lines.length;
    let o = 1;
    for (let i = 0; i < lines.length; i += 1) {
      const pts = lines[i];
      const n = pts.length / 3;
      packed[o] = n;
      o += 1;
      for (let j = 0; j < pts.length; j += 1) {
        packed[o] = pts[j];
        o += 1;
      }
    }
  }

  rebuild();

  return {
    kind: SIM_KIND.ELECTRIC_FIELD_LINES,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams' || op === 'setCharges') {
        if (payload.charges) {
          charges = payload.charges.map((c) => ({
            q: Number(c.q) || 0,
            x: Number(c.x) || 0,
            y: Number(c.y) || 0,
            z: Number(c.z) || 0,
          }));
        }
        return true;
      }
      if (op === 'rebuild') {
        rebuild();
        generation += 2;
        return true;
      }
      if (op === 'reset') {
        charges = [];
        packed = new Float32Array([0]);
        simTime = 0;
        generation += 2;
        return true;
      }
      return false;
    },

    step(dt) {
      // On-demand: rebuild once per step when dirty flag set via command rebuild,
      // or always recompute so host can step after charge edits.
      const h = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      simTime += h;
      rebuild();
      generation += 2;
      return this.getSnapshot();
    },

    getSnapshot() {
      return {
        kind: SIM_KIND.ELECTRIC_FIELD_LINES,
        simTime,
        generation,
        steps: 1,
        scalars: {
          chargeCount: charges.length,
          lineCount: packed[0] | 0,
        },
        fields: { fieldLines: new Float32Array(packed) },
      };
    },

    dispose() {
      packed = new Float32Array(0);
      charges = [];
    },
  };
}

/**
 * Gauss theorem surface metrics (Q_enc, Φ, mean |E|).
 * @param {{
 *   charges?: Array<{q:number,x:number,y:number,z:number}>,
 *   radius?: number,
 * }} [initial]
 */
export function createGaussMetricsKind(initial = {}) {
  let charges = (initial.charges || []).map((c) => ({
    q: Number(c.q) || 0,
    x: Number(c.x) || 0,
    y: Number(c.y) || 0,
    z: Number(c.z) || 0,
  }));
  let radius = Number(initial.radius) || 2.4;
  let simTime = 0;
  let generation = 0;

  function enclosed() {
    let q = 0;
    const r2 = radius * radius;
    for (let i = 0; i < charges.length; i += 1) {
      const c = charges[i];
      const d2 = c.x * c.x + c.y * c.y + c.z * c.z;
      if (d2 <= r2) q += c.q;
    }
    return q;
  }

  function meanField() {
    const r = Math.max(1e-6, radius);
    if (charges.length === 1) {
      const c = charges[0];
      const dist = Math.hypot(c.x, c.y, c.z);
      if (dist < 0.12 && dist < r && Math.abs(c.q) > 0.01) {
        return (K_COULOMB * Math.abs(c.q * CHARGE_UI_TO_C)) / (r * r);
      }
    }
    const sampleCount = 40;
    let sum = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const y = 1 - (i / Math.max(sampleCount - 1, 1)) * 2;
      const radial = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN * i;
      const f = fieldAt(
        charges,
        Math.cos(theta) * radial * r,
        y * r,
        Math.sin(theta) * radial * r,
      );
      sum += Math.hypot(f.x, f.y, f.z);
    }
    return sum / sampleCount;
  }

  return {
    kind: SIM_KIND.GAUSS_METRICS,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.charges) {
          charges = payload.charges.map((c) => ({
            q: Number(c.q) || 0,
            x: Number(c.x) || 0,
            y: Number(c.y) || 0,
            z: Number(c.z) || 0,
          }));
        }
        if (payload.radius != null) radius = Number(payload.radius);
        return true;
      }
      if (op === 'reset') {
        charges = [];
        radius = 2.4;
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
      const qEnc = enclosed();
      return {
        kind: SIM_KIND.GAUSS_METRICS,
        simTime,
        generation,
        steps: 1,
        scalars: {
          radius,
          qEnclosed: qEnc,
          flux: (qEnc * CHARGE_UI_TO_C) / EPSILON_0,
          meanField: meanField(),
        },
      };
    },

    dispose() {
      charges = [];
    },
  };
}

const HALL_SAMPLE = Object.freeze({ L: 4.4, W: 1.7, H: 0.5 });
const HALL_DRIFT = 1.55;

/**
 * Hall carrier particle teaching model (positions only for paint).
 * @param {{
 *   count?: number,
 *   I?: number,
 *   B?: number,
 *   n?: number,
 *   d?: number,
 *   nType?: boolean,
 *   paused?: boolean,
 *   seed?: number,
 * }} [initial]
 */
export function createHallCarriersKind(initial = {}) {
  const count = Math.max(8, initial.count | 0 || 240);
  const stride = PARTICLE_STRIDE_POS_VEL;
  let I = Number(initial.I) || 1;
  let B = Number(initial.B) || 1;
  let n = Math.max(0.3, Number(initial.n) || 1);
  let d = Number(initial.d) || 0.5;
  let nType = initial.nType !== false;
  let paused = !!initial.paused;
  let particles = new Float32Array(count * stride);
  const baseCoords = new Float32Array(count * 2);
  const massVariance = new Float32Array(count);
  const phases = new Float32Array(count);
  let smoothTilt = 0;
  let simTime = 0;
  let generation = 0;
  let seed = (initial.seed | 0) || 11;

  function rand() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  function initParticles() {
    for (let i = 0; i < count; i += 1) {
      const o = i * stride;
      const x = (rand() - 0.5) * HALL_SAMPLE.L * 0.92;
      const y = (rand() - 0.5) * HALL_SAMPLE.W * 0.76;
      const z = (rand() - 0.5) * HALL_SAMPLE.H * 0.88;
      baseCoords[i * 2] = y;
      baseCoords[i * 2 + 1] = z;
      particles[o] = x;
      particles[o + 1] = y;
      particles[o + 2] = z;
      particles[o + 3] = 0;
      particles[o + 4] = 0;
      particles[o + 5] = 0;
      massVariance[i] = 0.86 + rand() * 0.28;
      phases[i] = rand() * Math.PI * 2;
    }
    smoothTilt = 0;
  }

  initParticles();

  return {
    kind: SIM_KIND.HALL_CARRIERS,
    particleStride: stride,
    particleCount: count,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.I != null) I = Number(payload.I);
        if (payload.B != null) B = Number(payload.B);
        if (payload.n != null) n = Math.max(0.3, Number(payload.n));
        if (payload.d != null) d = Number(payload.d);
        if (payload.nType != null) nType = !!payload.nType;
        if (payload.paused != null) paused = !!payload.paused;
        return true;
      }
      if (op === 'reinit' || op === 'reset') {
        if (payload.I != null) I = Number(payload.I);
        if (payload.B != null) B = Number(payload.B);
        initParticles();
        simTime = 0;
        return true;
      }
      return false;
    },

    step(dt) {
      const h = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      simTime += h;
      generation += 2;
      if (paused || h <= 0) return this.getSnapshot();

      const carrierSign = nType ? -1 : 1;
      const flowDirection = nType ? -1 : 1;
      const halfW = HALL_SAMPLE.W / 2 - 0.08;
      const halfH = Math.max(0.02, d / 2 - 0.04);
      const halfL = HALL_SAMPLE.L / 2;
      const tau = 0.18;
      const v0 = (HALL_DRIFT * Math.max(0, I) / n) * flowDirection;
      const qOverM = carrierSign * 3.6;
      const thermalStep = Math.sqrt(2 * 0.003 * h);
      const FmagY = -carrierSign * v0 * B;
      const targetTilt = Math.sign(FmagY || 0) * (0.38 * Math.abs(B) * Math.min(1.5, Math.max(0, I)));
      const lerpAlpha = Math.min(1.0, 12.0 * Math.max(0.001, h));
      smoothTilt += (targetTilt - smoothTilt) * lerpAlpha;
      const tiltScale = smoothTilt;
      const wallK = 32;
      const wallDamp = 0.5;
      const filmScale = d / 0.5;

      for (let i = 0; i < count; i += 1) {
        const o = i * stride;
        let x = particles[o];
        let y = particles[o + 1];
        let z = particles[o + 2];
        let vx = particles[o + 3];
        let vy = particles[o + 4];
        let vz = particles[o + 5];
        const mass = massVariance[i];
        const yBase = baseCoords[i * 2];
        const zBase = baseCoords[i * 2 + 1];

        const progress = flowDirection < 0
          ? Math.max(0, Math.min(1, (halfL - x) / HALL_SAMPLE.L))
          : Math.max(0, Math.min(1, (x + halfL) / HALL_SAMPLE.L));
        const ramp = 0.3;
        let sCurve = 1.0;
        if (progress < ramp) {
          const u = progress / ramp;
          sCurve = u * u * (3 - 2 * u);
        } else if (progress > 1 - ramp) {
          const u = (1 - progress) / ramp;
          sCurve = u * u * (3 - 2 * u);
        }
        const yDeflected = yBase * (1 - 0.4 * sCurve) + tiltScale * sCurve * 1.5;
        const yTarget = Math.max(-halfW * 0.95, Math.min(halfW * 0.95, yDeflected));
        const zTarget = Math.max(-halfH * 0.88, Math.min(halfH * 0.88, zBase * filmScale));
        const vCrossBx = vy * B;

        let ax = (v0 - vx) / (tau * mass) + qOverM * vCrossBx;
        let ay = (0 - vy) / (tau * mass) + (yTarget - y) * (20.0 / mass);
        let az = (0 - vz) / (tau * mass) + (zTarget - z) * (20.0 / mass);

        if (y > halfW * 0.88) ay -= ((y - halfW * 0.88) * wallK) / mass;
        else if (y < -halfW * 0.88) ay -= ((y + halfW * 0.88) * wallK) / mass;
        if (z > halfH * 0.85) az -= ((z - halfH * 0.85) * wallK) / mass;
        else if (z < -halfH * 0.85) az -= ((z + halfH * 0.85) * wallK) / mass;

        phases[i] += h * 8;
        const jitter = thermalStep / Math.sqrt(mass);
        vx += ax * h + (Math.sin(phases[i] * 1.3 + i) * 0.05) * jitter;
        vy += ay * h + (Math.cos(phases[i] * 1.7 + i) * 0.15 + Math.cos(phases[i] * 0.9) * 0.3) * jitter * 0.4;
        vz += az * h + (Math.sin(phases[i] * 2.1 + i) * 0.15) * jitter * 0.4;

        const speed2 = vx * vx + vy * vy + vz * vz;
        const maxSpeed = 4.5 + 2.5 * Math.abs(v0);
        if (speed2 > maxSpeed * maxSpeed) {
          const s = maxSpeed / Math.sqrt(speed2);
          vx *= s;
          vy *= s;
          vz *= s;
        }

        x += vx * h;
        y += vy * h;
        z += vz * h;

        if (y > halfW) {
          y = halfW;
          if (vy > 0) vy = -vy * wallDamp;
        } else if (y < -halfW) {
          y = -halfW;
          if (vy < 0) vy = -vy * wallDamp;
        }
        if (z > halfH) {
          z = halfH;
          if (vz > 0) vz = -vz * wallDamp;
        } else if (z < -halfH) {
          z = -halfH;
          if (vz < 0) vz = -vz * wallDamp;
        }

        let wrapped = false;
        if (x < -halfL - 0.08) {
          x = halfL + 0.08;
          wrapped = true;
        } else if (x > halfL + 0.08) {
          x = -halfL - 0.08;
          wrapped = true;
        }
        if (wrapped) {
          y = Math.max(-halfW * 0.92, Math.min(halfW * 0.92, yBase));
          z = Math.max(-halfH * 0.88, Math.min(halfH * 0.88, zBase * filmScale));
          vx = v0 * (0.85 + (Math.sin(phases[i]) * 0.5 + 0.5) * 0.3);
          vy = Math.sin(phases[i] * 1.1) * 0.01;
          vz = Math.cos(phases[i] * 0.8) * 0.01;
        }

        particles[o] = x;
        particles[o + 1] = y;
        particles[o + 2] = z;
        particles[o + 3] = vx;
        particles[o + 4] = vy;
        particles[o + 5] = vz;
      }

      return this.getSnapshot();
    },

    getSnapshot() {
      const carrierSign = nType ? -1 : 1;
      const thicknessNorm = Math.max(0.05, d / 0.5);
      const numerator = I * B;
      const vh = numerator === 0
        ? 0
        : (numerator * carrierSign) / (n * thicknessNorm);
      return {
        kind: SIM_KIND.HALL_CARRIERS,
        simTime,
        generation,
        steps: 1,
        scalars: {
          I,
          B,
          n,
          d,
          nType,
          paused,
          vh,
          force: Math.abs(I * B),
          particleCount: count,
          particleStride: stride,
          smoothTilt,
        },
        particles: new Float32Array(particles),
      };
    },

    dispose() {
      particles = new Float32Array(0);
    },
  };
}

/**
 * @param {string} kind
 * @param {object} [options]
 */
export function createElectroKind(kind, options = {}) {
  switch (kind) {
    case SIM_KIND.ELECTRIC_FIELD_LINES:
      return createElectricFieldLinesKind(options);
    case SIM_KIND.GAUSS_METRICS:
      return createGaussMetricsKind(options);
    case SIM_KIND.HALL_CARRIERS:
      return createHallCarriersKind(options);
    default:
      throw new Error(`Unknown electro sim kind: ${kind}`);
  }
}

export { SIM_KIND };
