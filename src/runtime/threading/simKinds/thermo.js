/**
 * Pure thermo simulation kinds (no Three.js).
 * Used by main SimBackend and sim.worker.js.
 */

import {
  PARTICLE_STRIDE_POS_VEL,
  PARTICLE_STRIDE_POS_VEL_TEMP,
  SIM_KIND,
} from '../simTypes.js';

// ── Calorimetry mix clock ────────────────────────────────────────────────

/**
 * @param {{
 *   mixProgress?: number,
 *   tCurrent?: number,
 *   mHot?: number, mCold?: number,
 *   tHot?: number, tCold?: number,
 *   cupHot?: boolean, cupCold?: boolean,
 *   pouring?: boolean,
 * }} [initial]
 */
export function createCalorimetryMixKind(initial = {}) {
  let mixProgress = Number(initial.mixProgress) || 0;
  let tCurrent = Number(initial.tCurrent) || Number(initial.tCold) || 293;
  let mHot = Number(initial.mHot) || 0.2;
  let mCold = Number(initial.mCold) || 0.2;
  let tHot = Number(initial.tHot) || 353;
  let tCold = Number(initial.tCold) || 293;
  let cupHot = !!initial.cupHot;
  let cupCold = !!initial.cupCold;
  let pouring = !!initial.pouring;
  let simTime = 0;
  let generation = 0;
  let mixJustCompleted = false;

  function teq() {
    return (mHot * tHot + mCold * tCold) / (mHot + mCold);
  }

  function tau() {
    return Math.max(1.1, Math.min(6.5, 2.8 * (60 / Math.max(8, Math.abs(tHot - tCold)))));
  }

  return {
    kind: SIM_KIND.CALORIMETRY_MIX,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.mHot != null) mHot = Number(payload.mHot);
        if (payload.mCold != null) mCold = Number(payload.mCold);
        if (payload.tHot != null) tHot = Number(payload.tHot);
        if (payload.tCold != null) tCold = Number(payload.tCold);
        if (payload.cupHot != null) cupHot = !!payload.cupHot;
        if (payload.cupCold != null) cupCold = !!payload.cupCold;
        if (payload.pouring != null) pouring = !!payload.pouring;
        if (payload.mixProgress != null) mixProgress = Number(payload.mixProgress);
        if (payload.tCurrent != null) tCurrent = Number(payload.tCurrent);
        return true;
      }
      if (op === 'reset') {
        mixProgress = 0;
        tCurrent = tCold;
        mixJustCompleted = false;
        simTime = 0;
        return true;
      }
      return false;
    },

    step(dt) {
      mixJustCompleted = false;
      const h = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      simTime += h;
      generation += 2; // even = complete
      if (cupHot && cupCold && !pouring) {
        const previous = mixProgress;
        const t = tau();
        mixProgress = Math.min(1, mixProgress + h / t);
        const eq = teq();
        tCurrent = tCold + (eq - tCold) * (1 - Math.exp(-mixProgress * 4));
        mixJustCompleted = previous < 1 && mixProgress >= 1;
      }
      return this.getSnapshot();
    },

    getSnapshot() {
      return {
        kind: SIM_KIND.CALORIMETRY_MIX,
        simTime,
        generation,
        steps: 1,
        scalars: {
          mixProgress,
          tCurrent,
          teq: teq(),
          mixJustCompleted,
          cupHot,
          cupCold,
          pouring,
        },
      };
    },

    dispose() {},
  };
}

// ── Heat conduction 1D FD ────────────────────────────────────────────────

/**
 * @param {{
 *   segments?: number,
 *   temps?: ArrayLike<number>,
 *   tHot?: number,
 *   tCold?: number,
 *   conductivity?: number,
 *   running?: boolean,
 * }} [initial]
 */
export function createHeatConductionKind(initial = {}) {
  const segments = Math.max(4, initial.segments | 0 || initial.temps?.length || 24);
  let temps = new Float32Array(segments);
  let next = new Float32Array(segments);
  if (initial.temps?.length) {
    const n = Math.min(segments, initial.temps.length);
    for (let i = 0; i < n; i += 1) temps[i] = Number(initial.temps[i]) || 300;
  } else {
    temps.fill(300);
  }
  let tHot = Number(initial.tHot) || 600;
  let tCold = Number(initial.tCold) || 280;
  let conductivity = Number(initial.conductivity) || 1.2;
  let running = initial.running !== false;
  let simTime = 0;
  let generation = 0;

  temps[0] = tHot;
  temps[segments - 1] = tCold;

  return {
    kind: SIM_KIND.HEAT_CONDUCTION,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.tHot != null) {
          tHot = Number(payload.tHot);
          temps[0] = tHot;
        }
        if (payload.tCold != null) {
          tCold = Number(payload.tCold);
          temps[segments - 1] = tCold;
        }
        if (payload.conductivity != null) conductivity = Number(payload.conductivity);
        if (payload.running != null) running = !!payload.running;
        if (payload.temps?.length) {
          const n = Math.min(segments, payload.temps.length);
          for (let i = 0; i < n; i += 1) temps[i] = Number(payload.temps[i]);
          temps[0] = tHot;
          temps[segments - 1] = tCold;
        }
        return true;
      }
      if (op === 'reset') {
        temps.fill(300);
        temps[0] = tHot;
        temps[segments - 1] = tCold;
        simTime = 0;
        return true;
      }
      return false;
    },

    step(dt) {
      const frameDt = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      simTime += frameDt;
      generation += 2;
      if (running) {
        const alpha = conductivity * 0.35;
        const steps = Math.min(4, Math.max(1, Math.ceil(frameDt * 60)));
        const h = Math.min(frameDt / steps, 0.02);
        let a = temps;
        let b = next;
        for (let s = 0; s < steps; s += 1) {
          b[0] = tHot;
          b[b.length - 1] = tCold;
          for (let i = 1; i < a.length - 1; i += 1) {
            b[i] = a[i] + alpha * h * (a[i - 1] - 2 * a[i] + a[i + 1]);
          }
          const tmp = a;
          a = b;
          b = tmp;
        }
        temps = a;
        next = b;
      }
      return this.getSnapshot();
    },

    getSnapshot() {
      // Copy field so transfer/SAB consumers cannot mutate internal state.
      const field = new Float32Array(temps);
      return {
        kind: SIM_KIND.HEAT_CONDUCTION,
        simTime,
        generation,
        steps: 1,
        scalars: {
          tHot,
          tCold,
          conductivity,
          running,
          midTemp: field[field.length >> 1],
        },
        fields: { temps: field },
      };
    },

    dispose() {
      temps = new Float32Array(0);
      next = new Float32Array(0);
    },
  };
}

// ── Ideal gas particles ──────────────────────────────────────────────────

/**
 * @param {{
 *   count?: number,
 *   temperature?: number,
 *   volume?: number,
 *   chamberR?: number,
 *   floorY?: number,
 *   baseH?: number,
 *   seed?: number,
 * }} [initial]
 */
export function createIdealGasKind(initial = {}) {
  const count = Math.max(1, initial.count | 0 || 200);
  const stride = PARTICLE_STRIDE_POS_VEL;
  let temperature = Number(initial.temperature) || 300;
  let volume = Number(initial.volume) || 1;
  const chamberR = Number(initial.chamberR) || 0.9;
  const floorY = Number(initial.floorY) || 0.22;
  const baseH = Number(initial.baseH) || 1.35;
  let particles = new Float32Array(count * stride);
  let collisionCount = 0;
  let collisionWindow = 0;
  let collisionsPerSec = 0;
  let simTime = 0;
  let generation = 0;
  let seed = (initial.seed | 0) || 1;

  function rand() {
    // xorshift32 — deterministic enough for lab particles
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296);
  }

  function height() {
    return baseH * volume;
  }

  function initParticles() {
    const h = height();
    const r = chamberR - 0.08;
    const speedScale = Math.sqrt(temperature / 300) * 2.2;
    const y0 = floorY + 0.06;
    for (let i = 0; i < count; i += 1) {
      const o = i * stride;
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * r * 0.92;
      let vx = rand() - 0.5;
      let vy = rand() - 0.5;
      let vz = rand() - 0.5;
      const len = Math.hypot(vx, vy, vz) || 1;
      const speed = speedScale * (0.65 + rand() * 0.7);
      particles[o] = Math.cos(a) * rr;
      particles[o + 1] = y0 + rand() * Math.max(0.15, h - 0.15);
      particles[o + 2] = Math.sin(a) * rr;
      particles[o + 3] = (vx / len) * speed;
      particles[o + 4] = (vy / len) * speed;
      particles[o + 5] = (vz / len) * speed;
    }
    collisionCount = 0;
    collisionWindow = 0;
    collisionsPerSec = 0;
  }

  function rescaleVelocities(prevT, nextT) {
    if (!(prevT > 0) || !(nextT > 0) || prevT === nextT) return;
    const factor = Math.sqrt(nextT / prevT);
    for (let i = 0; i < count; i += 1) {
      const o = i * stride;
      particles[o + 3] *= factor;
      particles[o + 4] *= factor;
      particles[o + 5] *= factor;
    }
  }

  initParticles();

  return {
    kind: SIM_KIND.IDEAL_GAS,
    particleStride: stride,
    particleCount: count,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.temperature != null) {
          const nextT = Number(payload.temperature);
          rescaleVelocities(temperature, nextT);
          temperature = nextT;
        }
        if (payload.volume != null) {
          volume = Number(payload.volume);
        }
        return true;
      }
      if (op === 'reinit' || op === 'reset') {
        if (payload.temperature != null) temperature = Number(payload.temperature);
        if (payload.volume != null) volume = Number(payload.volume);
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
      const gasH = height();
      const rMax = chamberR - 0.07;
      const yMin = floorY + 0.05;
      const yMax = floorY + gasH - 0.04;
      let coll = 0;

      for (let i = 0; i < count; i += 1) {
        const o = i * stride;
        let px = particles[o] + particles[o + 3] * h;
        let py = particles[o + 1] + particles[o + 4] * h;
        let pz = particles[o + 2] + particles[o + 5] * h;
        let vx = particles[o + 3];
        let vy = particles[o + 4];
        let vz = particles[o + 5];

        const rr = Math.hypot(px, pz);
        if (rr > rMax) {
          const nx = px / rr;
          const nz = pz / rr;
          const vn = vx * nx + vz * nz;
          if (vn > 0) {
            vx -= 2 * vn * nx;
            vz -= 2 * vn * nz;
          }
          px = nx * rMax * 0.98;
          pz = nz * rMax * 0.98;
          coll += 1;
        }
        if (py > yMax || py < yMin) {
          vy *= -1;
          py = Math.min(yMax, Math.max(yMin, py));
          coll += 1;
        }

        particles[o] = px;
        particles[o + 1] = py;
        particles[o + 2] = pz;
        particles[o + 3] = vx;
        particles[o + 4] = vy;
        particles[o + 5] = vz;
      }

      collisionCount += coll;
      collisionWindow += h;
      if (collisionWindow >= 0.45) {
        collisionsPerSec = Math.round(collisionCount / collisionWindow);
        collisionCount = 0;
        collisionWindow = 0;
      }

      return this.getSnapshot();
    },

    getSnapshot() {
      const copy = new Float32Array(particles);
      return {
        kind: SIM_KIND.IDEAL_GAS,
        simTime,
        generation,
        steps: 1,
        scalars: {
          temperature,
          volume,
          collisionsPerSec,
          particleCount: count,
          particleStride: stride,
        },
        particles: copy,
      };
    },

    dispose() {
      particles = new Float32Array(0);
    },
  };
}

// ── Natural convection plume particles ───────────────────────────────────

/**
 * Buoyancy-driven smoke tracers (pure, no Three.js).
 * Stride 7: px, py, pz, vx, vy, vz, temp.
 * @param {{
 *   count?: number,
 *   tPlate?: number,
 *   tAir?: number,
 *   area?: number,
 *   running?: boolean,
 *   chamberW?: number,
 *   chamberD?: number,
 *   airBot?: number,
 *   airTop?: number,
 *   plateY?: number,
 *   seed?: number,
 * }} [initial]
 */
export function createConvectionKind(initial = {}) {
  const count = Math.max(16, initial.count | 0 || 1800);
  const stride = PARTICLE_STRIDE_POS_VEL_TEMP;
  let tPlate = Number(initial.tPlate) || 650;
  let tAir = Number(initial.tAir) || 300;
  let area = Number(initial.area) || 0.12;
  let running = initial.running !== false;
  const chamberW = Number(initial.chamberW) || 2.2;
  const chamberD = Number(initial.chamberD) || 1.25;
  const airBot = Number(initial.airBot) || 0.38;
  const airTop = Number(initial.airTop) || 2.43;
  const plateY = Number(initial.plateY) || 0.28;
  let particles = new Float32Array(count * stride);
  let simTime = 0;
  let generation = 0;
  let seed = (initial.seed | 0) || 7;

  function rand() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  function deltaT() {
    return Math.max(0, tPlate - tAir);
  }

  function plateHalf() {
    const sc = Math.sqrt(area / 0.12);
    return { hx: 0.675 * sc, hz: 0.425 * sc };
  }

  function spawn(i, mode = 'mixed') {
    const o = i * stride;
    const { hx, hz } = plateHalf();
    const dT = deltaT();
    const r = rand();
    let modeUse = mode;
    if (mode === 'mixed') {
      modeUse = r < 0.68 ? 'nearPlate' : r < 0.84 ? 'wall' : 'volume';
    }
    if (modeUse === 'nearPlate') {
      particles[o] = (rand() - 0.5) * hx * 1.5;
      particles[o + 2] = (rand() - 0.5) * hz * 1.5;
      particles[o + 1] = airBot + rand() * 0.18;
      particles[o + 6] = tAir + dT * (0.65 + rand() * 0.35);
    } else if (modeUse === 'wall') {
      const side = rand() < 0.5 ? -1 : 1;
      particles[o] = side * (chamberW * 0.38 + rand() * 0.12);
      particles[o + 2] = (rand() - 0.5) * chamberD * 0.7;
      particles[o + 1] = airBot + 0.3 + rand() * Math.max(0.2, airTop - airBot - 0.4);
      particles[o + 6] = tAir + dT * rand() * 0.12;
    } else {
      particles[o] = (rand() - 0.5) * chamberW * 0.85;
      particles[o + 2] = (rand() - 0.5) * chamberD * 0.8;
      particles[o + 1] = airBot + rand() * Math.max(0.2, airTop - airBot);
      particles[o + 6] = tAir + dT * rand() * 0.25;
    }
    particles[o + 3] = (rand() - 0.5) * 0.05;
    particles[o + 4] = (rand() - 0.5) * 0.02;
    particles[o + 5] = (rand() - 0.5) * 0.05;
  }

  for (let i = 0; i < count; i += 1) spawn(i, 'mixed');

  function metrics() {
    const dT = deltaT();
    const L = Math.sqrt(Math.max(1e-6, area));
    const ra = 1e8 * dT * L ** 3;
    const nu = 0.15 * Math.pow(Math.max(ra, 1), 1 / 3);
    const h = dT < 1 ? 2 : Math.max(3, (nu * 0.028) / L);
    return { deltaT: dT, ra, nu, h, q: h * area * dT };
  }

  function noise(x, y, z, t) {
    const s = Math.sin(x * 1.7 + t * 0.7) * Math.cos(y * 2.1 - t * 0.55) * Math.sin(z * 1.9 + t * 0.4);
    return s + Math.sin(x * 3.3 - y * 2.4 + t * 1.1) * 0.5;
  }

  return {
    kind: SIM_KIND.CONVECTION,
    particleStride: stride,
    particleCount: count,

    command(op, payload = {}) {
      if (op === 'setState' || op === 'setParams') {
        if (payload.tPlate != null) tPlate = Number(payload.tPlate);
        if (payload.tAir != null) tAir = Number(payload.tAir);
        if (payload.area != null) area = Number(payload.area);
        if (payload.running != null) running = !!payload.running;
        return true;
      }
      if (op === 'reinit' || op === 'reset') {
        if (payload.tPlate != null) tPlate = Number(payload.tPlate);
        if (payload.tAir != null) tAir = Number(payload.tAir);
        if (payload.area != null) area = Number(payload.area);
        for (let i = 0; i < count; i += 1) spawn(i, 'mixed');
        simTime = 0;
        return true;
      }
      return false;
    },

    step(dt) {
      const h = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      simTime += h;
      generation += 2;
      const dT = deltaT();
      const heat = Math.min(1, Math.max(0, dT / 520));
      const active = running && dT > 3;
      if (!active) return this.getSnapshot();

      const { hx, hz } = plateHalf();
      const buoy = 1.35 * Math.sqrt(dT / 200);
      const coolRate = 0.55 + (1 - heat) * 0.35;
      const heatRate = 2.8 + heat * 3.5;
      const drag = 1.6;
      const xMax = chamberW * 0.46;
      const zMax = chamberD * 0.42;
      const yMin = airBot;
      const yMax = airTop;
      const t = simTime;
      const damp = Math.exp(-drag * h);
      const maxSp = 1.1 + buoy * 0.9;

      for (let i = 0; i < count; i += 1) {
        const o = i * stride;
        let px = particles[o];
        let py = particles[o + 1];
        let pz = particles[o + 2];
        let vx = particles[o + 3];
        let vy = particles[o + 4];
        let vz = particles[o + 5];
        let temp = particles[o + 6];

        const nx = px / Math.max(hx * 1.05, 0.05);
        const nz = pz / Math.max(hz * 1.05, 0.05);
        const rPlate2 = nx * nx + nz * nz;
        const abovePlate = rPlate2 < 1.35 && py < yMin + 0.55;
        const heightAbove = Math.max(0, py - plateY);

        if (abovePlate && heightAbove < 0.55) {
          const proximity = Math.exp(-rPlate2 * 1.8) * Math.exp(-heightAbove * 3.2);
          temp += (tPlate - temp) * heatRate * proximity * h;
        }
        let cool = coolRate;
        if (py > yMax - 0.45) cool += 1.2;
        const wallDist = Math.min(xMax - Math.abs(px), zMax - Math.abs(pz));
        if (wallDist < 0.22) cool += 0.9;
        temp += (tAir - temp) * cool * h;
        temp = Math.min(tPlate + 10, Math.max(tAir - 5, temp));

        const dens = (temp - tAir) / Math.max(dT, 1);
        vy += buoy * dens * h * 2.4;
        vy -= (0.35 + (1 - dens) * 1.1) * h;

        const rise = Math.min(1, Math.max(0, (py - yMin) / Math.max(1e-6, yMax - yMin)));
        if (dens > 0.25 && rise < 0.7) {
          const spread = 0.15 + rise * 0.55;
          vx += px * spread * dens * h * 0.35;
          vz += pz * spread * dens * h * 0.35;
        }
        if (dens < 0.35) {
          if (Math.abs(px) > hx * 0.9) {
            vx += -Math.sign(px || 1) * (0.15 + (1 - dens)) * h * 0.8;
            vy -= 0.6 * h;
          }
          if (rise < 0.25) {
            vx += -px * 1.4 * h;
            vz += -pz * 1.1 * h;
          } else {
            vx += Math.sign(px || 1) * (0.4 + rise * 0.3) * (1 - dens) * h * 0.15;
          }
        }

        const roll = Math.sin(px * 1.4) * Math.cos(py * 0.9 + t * 0.2);
        vx += roll * 0.25 * heat * h;
        vy += Math.cos(px * 1.4) * 0.12 * heat * h;
        const turb = 0.35 + heat * 0.55;
        vx += noise(px * 2.2, py * 1.8, pz * 2.0, t) * turb * h;
        vy += noise(px * 1.5 + 10, py * 2.4, pz * 1.7 + 4, t * 1.1) * turb * 0.55 * h;
        vz += noise(pz * 2.0, px * 1.9, py * 2.1, t * 0.9) * turb * h;

        vx *= damp;
        vy *= damp;
        vz *= damp;
        const sp = Math.hypot(vx, vy, vz);
        if (sp > maxSp) {
          const s = maxSp / sp;
          vx *= s;
          vy *= s;
          vz *= s;
        }

        px += vx * h;
        py += vy * h;
        pz += vz * h;

        if (px > xMax) { px = xMax; vx *= -0.35; }
        else if (px < -xMax) { px = -xMax; vx *= -0.35; }
        if (pz > zMax) { pz = zMax; vz *= -0.35; }
        else if (pz < -zMax) { pz = -zMax; vz *= -0.35; }
        if (py > yMax) {
          py = yMax;
          vy *= -0.2;
          temp = tAir + (temp - tAir) * 0.5;
        } else if (py < yMin) {
          py = yMin + 0.01;
          vy = Math.abs(vy) * 0.3;
        }

        particles[o] = px;
        particles[o + 1] = py;
        particles[o + 2] = pz;
        particles[o + 3] = vx;
        particles[o + 4] = vy;
        particles[o + 5] = vz;
        particles[o + 6] = temp;

        // Soft recycle when parcel is very cool near ceiling
        if (dens < 0.05 && rise > 0.92 && rand() < 0.02) spawn(i, dens > 0.4 ? 'nearPlate' : 'mixed');
      }

      return this.getSnapshot();
    },

    getSnapshot() {
      const m = metrics();
      return {
        kind: SIM_KIND.CONVECTION,
        simTime,
        generation,
        steps: 1,
        scalars: {
          tPlate,
          tAir,
          area,
          running,
          particleCount: count,
          particleStride: stride,
          ...m,
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
 * Factory for thermo kinds by id.
 * @param {string} kind
 * @param {object} [options]
 */
export function createThermoKind(kind, options = {}) {
  switch (kind) {
    case SIM_KIND.CALORIMETRY_MIX:
      return createCalorimetryMixKind(options);
    case SIM_KIND.HEAT_CONDUCTION:
      return createHeatConductionKind(options);
    case SIM_KIND.IDEAL_GAS:
      return createIdealGasKind(options);
    case SIM_KIND.CONVECTION:
      return createConvectionKind(options);
    default:
      throw new Error(`Unknown thermo sim kind: ${kind}`);
  }
}

export { PARTICLE_STRIDE_POS_VEL, PARTICLE_STRIDE_POS_VEL_TEMP, SIM_KIND };
