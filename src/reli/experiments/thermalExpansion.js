import * as THREE from 'three';
import { Experiment } from './base.js';
import { chrome, darkMetal, metal, tempToColor } from '../lab/materials.js';
import { makeLabBench } from '../lab/primitives.js';

/** Linear expansion coefficients α (1/K) for common metals */
const MATERIALS = {
  aluminum: { name: '铝', alpha: 23.1e-6, color: 0xc5ced8 },
  copper: { name: '铜', alpha: 16.5e-6, color: 0xc4783a },
  steel: { name: '钢', alpha: 12.0e-6, color: 0x8a94a6 },
  invar: { name: '殷钢', alpha: 1.2e-6, color: 0x6b7588 },
};

/**
 * Solid linear thermal expansion: ΔL = α L₀ ΔT
 *
 * Visual language:
 *  1. Coils heat → mid-span of rod glows
 *  2. Free end slides right past a fixed zero index
 */
export class ThermalExpansionExperiment extends Experiment {
  get meta() {
    return {
      id: 'thermal-expansion',
      name: '固体热膨胀',
      tag: 'LINEAR EXP · αΔT',
      title: '线膨胀系数测量台',
      description:
        '左端固定试样棒，中段电热丝加热。升温后按 ΔL = α L₀ ΔT 伸长，自由端相对零点标尺右移。换材料对比 α（殷钢几乎不动）。',
      formula: 'Δl = α l₀ Δt；l = l₀(1 + αΔt)（α 单位 10⁻⁶ /℃）',
    };
  }

  get controlDefs() {
    return [
      { key: 'temperature', label: '加热温度 T', min: 20, max: 400, step: 5, unit: '°C' },
      { key: 'length0', label: '初始长度 L₀', min: 0.6, max: 1.4, step: 0.05, unit: 'm' },
      {
        key: 'material',
        label: '试样材料',
        type: 'toggle',
        options: [
          { value: 'aluminum', label: '铝' },
          { value: 'copper', label: '铜' },
          { value: 'steel', label: '钢' },
          { value: 'invar', label: '殷钢' },
        ],
      },
    ];
  }

  get readoutDefs() {
    return [
      { key: 'deltaL', label: '伸长量 ΔL', unit: 'mm', tone: 'warm' },
      { key: 'length', label: '当前长度 L', unit: 'mm', tone: 'cool' },
      { key: 'alpha', label: '线胀系数 α', unit: '×10⁻⁶/K', tone: 'ok' },
      { key: 'strain', label: '线应变 ε', unit: '×10⁻³' },
    ];
  }

  setup() {
    super.setup();
    this.params = { temperature: 80, length0: 1.0, material: 'aluminum' };
    this.t0 = 20;
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
    this._visLen = 0; // smoothed visual length

    this.rodBaseLen = 3.2;
    this.rodR = 0.06;
    this.rodY = 0.78;
    this.leftX = -1.75;
    // Extra length seated inside the fixed clamp so the left edge is not a gap
    this.gripLen = 0.14;
    // Visual amplification of physical ΔL so free-end motion is obvious
    this.expandScale = 70;

    this.camera.position.set(1.6, 2.2, 4.8);
    this.controls.target.set(0.4, 1.05, 0);

    const bench = makeLabBench(6.8, 2.4, 0.88);
    this.scene.add(bench);
    const y0 = bench.userData.topY;

    this.rig = new THREE.Group();
    this.rig.position.y = y0;
    this.scene.add(this.rig);

    const steel = metal(0x8b95a5, { roughness: 0.36 });
    const steelDark = darkMetal(0x2a3140);

    // Rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.08, 0.44), steelDark);
    rail.position.set(0.15, 0.05, 0);
    rail.receiveShadow = true;
    rail.castShadow = true;
    this.rig.add(rail);

    const railTop = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.022, 0.3), steel);
    railTop.position.set(0.15, 0.105, 0);
    this.rig.add(railTop);

    // Fixed end
    this.fixedEnd = this._makeFixedEnd();
    this.fixedEnd.position.set(this.leftX - 0.16, 0, 0);
    this.rig.add(this.fixedEnd);

    // Specimen rod — ONE continuous mesh. No end-cap/sleeve (those look like a broken joint).
    this.rodMat = new THREE.MeshStandardMaterial({
      color: 0xc5ced8,
      metalness: 0.55,
      roughness: 0.38,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    // Unit-length cylinder; length via scale.y (local Y → world X after rot.z)
    this.rod = new THREE.Mesh(
      new THREE.CylinderGeometry(this.rodR, this.rodR, 1, 64, 1, false),
      this.rodMat
    );
    this.rod.rotation.z = Math.PI / 2;
    this.rod.castShadow = true;
    this.rod.receiveShadow = true;
    this.rig.add(this.rod);

    // The right side is split into a low rail scale and one solid moving
    // connection end.  Nothing tall is left floating beside the specimen.
    this.zeroReference = this._makeZeroReference();
    this.rig.add(this.zeroReference);
    this.rightEnd = this._makeRightConnectionEnd();
    this.rig.add(this.rightEnd);

    // Under-rod coil heater
    this.heater = this._makeHeater();
    this.rig.add(this.heater);

    this._visLen = this._targetVisualLength();
    this._applyMaterialLook();
    this._updateGeometry(true);
  }

  _makeFixedEnd() {
    const g = new THREE.Group();
    const steelDark = darkMetal(0x2a3140);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), steelDark);
    base.position.y = 0.15;
    base.castShadow = true;
    g.add(base);

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 0.16), steelDark);
    post.position.set(-0.05, 0.48, 0);
    post.castShadow = true;
    g.add(post);

    // V-block cradle + top jaw clamp the bar so the fixed edge never looks floating
    const cradle = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.1, 0.26),
      metal(0x6b7588, { roughness: 0.4 })
    );
    cradle.position.set(0.1, this.rodY - this.rodR - 0.05, 0);
    cradle.castShadow = true;
    g.add(cradle);

    const jaw = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.08, 0.22),
      metal(0x7a8496, { roughness: 0.38 })
    );
    jaw.position.set(0.1, this.rodY + this.rodR + 0.04, 0);
    jaw.castShadow = true;
    g.add(jaw);

    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.18, 12), chrome());
    screw.position.set(0.1, this.rodY + this.rodR + 0.15, 0);
    g.add(screw);

    return g;
  }

  /**
   * Electric coil heater under the specimen mid-span.
   * Reads immediately as “heating”: ceramic cradle, spiral nichrome coils,
   * heat glow, and a temperature-driven point light.
   */
  _makeHeater() {
    const g = new THREE.Group();
    const steel = metal(0x8b95a5, { roughness: 0.34 });
    const steelDark = darkMetal(0x1e2430);
    const coilLen = 1.05;
    // Keep coils clear of the rod underside so they never cut the bar silhouette
    const coilY = this.rodY - 0.2;

    // Housing base
    const base = new THREE.Mesh(new THREE.BoxGeometry(coilLen + 0.2, 0.12, 0.42), steelDark);
    base.position.y = 0.14;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Raised ceramic bed (white refractory — classic furnace look)
    const ceramic = new THREE.Mesh(
      new THREE.BoxGeometry(coilLen, 0.08, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0xe8dcc8,
        metalness: 0.05,
        roughness: 0.88,
        emissive: 0x3a2010,
        emissiveIntensity: 0.05,
      })
    );
    ceramic.position.y = 0.24;
    ceramic.castShadow = true;
    g.add(ceramic);
    this.heaterCeramic = ceramic;

    // Side rails holding the coil assembly
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(coilLen + 0.06, 0.1, 0.04),
        steelDark
      );
      rail.position.set(0, coilY - 0.02, sz * 0.14);
      g.add(rail);
    }

    // End brackets — stay below rod bottom (rodY - rodR) so they never bisect the bar
    const bracketTop = this.rodY - this.rodR - 0.04;
    for (const sx of [-1, 1]) {
      const bracketH = 0.22;
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, bracketH, 0.34),
        steel
      );
      bracket.position.set(sx * (coilLen * 0.5 + 0.02), bracketTop - bracketH / 2, 0);
      bracket.castShadow = true;
      g.add(bracket);

      // Insulator bushing
      const bush = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.04, 0.05, 16),
        new THREE.MeshStandardMaterial({
          color: 0xd4c4a8,
          metalness: 0.05,
          roughness: 0.7,
        })
      );
      bush.rotation.z = Math.PI / 2;
      bush.position.set(sx * (coilLen * 0.5 + 0.02), coilY, 0);
      g.add(bush);
    }

    // ── Nichrome heating coils (the main “this is a heater” cue) ──
    this.heaterCoils = [];
    const coilMat = new THREE.MeshStandardMaterial({
      color: 0x4a3020,
      emissive: 0x1a0800,
      emissiveIntensity: 0.15,
      metalness: 0.55,
      roughness: 0.4,
    });
    this._coilMat = coilMat;

    // Horizontal spiral-like rings stacked along X under the rod
    // Major radius kept small enough that top of torus stays below rod bottom
    const nCoils = 9;
    const coilMajor = 0.07;
    const coilTube = 0.015;
    for (let i = 0; i < nCoils; i++) {
      const t = i / (nCoils - 1);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(coilMajor, coilTube, 10, 28),
        coilMat
      );
      // Stand rings upright so they wrap under the rod (axis along X)
      ring.rotation.y = Math.PI / 2;
      ring.position.set(-coilLen * 0.4 + t * coilLen * 0.8, coilY, 0);
      g.add(ring);
      this.heaterCoils.push(ring);
    }

    // Longitudinal filament bars nested in the rings (extra glow mass)
    this.heaterBars = [];
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, coilLen * 0.78, 12),
        coilMat.clone()
      );
      bar.rotation.z = Math.PI / 2;
      const z = (i - 1) * 0.045;
      bar.position.set(0, coilY - 0.02 + (i === 1 ? -0.02 : 0), z);
      g.add(bar);
      this.heaterBars.push(bar);
    }

    // Additive heat volume (orange haze around coils)
    this.heaterGlows = [];
    for (let i = 0; i < 3; i++) {
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.16 + i * 0.04, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xff5510,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.position.set((i - 1) * 0.28, coilY + 0.02, 0);
      glow.scale.set(1.4, 0.55, 0.9);
      g.add(glow);
      this.heaterGlows.push(glow);
    }

    // Heat shimmer planes rising toward the rod
    this.heaterShimmer = [];
    for (let i = 0; i < 4; i++) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(coilLen * 0.55, 0.18),
        new THREE.MeshBasicMaterial({
          color: 0xff8030,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, coilY + 0.08 + i * 0.07, 0);
      g.add(plane);
      this.heaterShimmer.push(plane);
    }

    // Real light so surroundings look heated
    this.heaterLight = new THREE.PointLight(0xff6a20, 0, 2.8, 2);
    this.heaterLight.position.set(0, coilY + 0.05, 0);
    g.add(this.heaterLight);

    // Power LED (no floating text)
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x16a34a,
        emissiveIntensity: 0.5,
      })
    );
    led.position.set(0.42, 0.16, 0.18);
    g.add(led);
    this.heaterLed = led;

    return g;
  }

  _makeZeroReference() {
    const g = new THREE.Group();
    const plateMat = darkMetal(0x202938);
    const tickMat = metal(0x8290a5, { roughness: 0.32 });
    const zeroMat = new THREE.MeshStandardMaterial({
      color: 0x00d4aa,
      emissive: 0x00d4aa,
      emissiveIntensity: 0.45,
      metalness: 0.25,
      roughness: 0.35,
    });

    // A horizontal scale belongs on the rail, not suspended beside the rod.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.025, 0.26), plateMat);
    plate.position.set(0.3, 0.132, 0);
    plate.castShadow = true;
    plate.receiveShadow = true;
    g.add(plate);

    for (let i = 0; i <= 7; i++) {
      const major = i === 0 || i === 7;
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.018, major ? 0.22 : 0.14),
        i === 0 ? zeroMat : tickMat
      );
      tick.position.set(i * 0.085, 0.154, 0);
      g.add(tick);
    }

    return g;
  }

  /**
   * One-piece moving bearing block at the free end of the specimen.
   * Every load-bearing part overlaps its neighbour, so no camera angle can
   * reveal a gap between the rod, housing, pillar, and rail foot.
   */
  _makeRightConnectionEnd() {
    const g = new THREE.Group();
    const housingMat = metal(0x7d899c, { roughness: 0.3 });
    const frameMat = darkMetal(0x222b39);
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x00bfa5,
      emissive: 0x006b5d,
      emissiveIntensity: 0.24,
      metalness: 0.5,
      roughness: 0.28,
    });

    // Oversized bearing housing.  The specimen penetrates 0.16 units into it,
    // making the connection read as a captured/sliding end rather than a cap.
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.27, 0.38),
      housingMat
    );
    housing.position.set(0.01, this.rodY, 0);
    housing.castShadow = true;
    housing.receiveShadow = true;
    g.add(housing);

    // Bright coaxial bushing visibly surrounds the rod at the entry face.
    const bushing = new THREE.Mesh(
      new THREE.CylinderGeometry(this.rodR * 1.48, this.rodR * 1.48, 0.07, 32),
      accentMat
    );
    bushing.rotation.z = Math.PI / 2;
    bushing.position.set(-0.16, this.rodY, 0);
    bushing.castShadow = true;
    g.add(bushing);

    // Wide pillar reaches into the housing and down into the foot.  The small
    // overlaps are intentional and eliminate the previous broken-looking seam.
    const pillarBottom = 0.19;
    const housingBottom = this.rodY - 0.135;
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, housingBottom - pillarBottom + 0.05, 0.26),
      frameMat
    );
    pillar.position.set(0.055, (pillarBottom + housingBottom) / 2, 0);
    pillar.castShadow = true;
    g.add(pillar);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.46), frameMat);
    foot.position.set(0.055, 0.15, 0);
    foot.castShadow = true;
    foot.receiveShadow = true;
    g.add(foot);

    // Top keeper closes the bearing block and reinforces the vertical stack.
    const keeper = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.42), frameMat);
    keeper.position.set(0.01, this.rodY + 0.17, 0);
    keeper.castShadow = true;
    g.add(keeper);

    // End screw gives the assembly a clear mechanical termination.
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 16), chrome());
    screw.position.set(0.01, this.rodY + 0.29, 0);
    screw.castShadow = true;
    g.add(screw);

    return g;
  }

  _mat() {
    return MATERIALS[this.params.material] || MATERIALS.aluminum;
  }

  _deltaT() {
    return this.params.temperature - this.t0;
  }

  _deltaL_m() {
    return this._mat().alpha * this.params.length0 * this._deltaT();
  }

  _coldVisualLength() {
    return this.rodBaseLen * this.params.length0;
  }

  _targetVisualLength() {
    return this._coldVisualLength() + this._deltaL_m() * this.expandScale;
  }

  _applyMaterialLook() {
    this._baseRodColor = this._mat().color;
    this.rodMat.color.setHex(this._baseRodColor);
  }

  /**
   * @param {boolean} instant skip smoothing
   */
  _updateGeometry(instant = false) {
    const target = this._targetVisualLength();
    if (instant || !this._visLen) this._visLen = target;
    // smooth toward target so temperature drag feels alive
    this._visLen += (target - this._visLen) * (instant ? 1 : 0.12);

    const len = this._visLen;
    const left = this.leftX;
    const grip = this.gripLen;
    const coldLen = this._coldVisualLength();
    const coldFree = left + coldLen;

    // One continuous bar spanning [left - grip, left + len] — no extra tip mesh
    const visLen = len + grip;
    this.rod.scale.set(1, visLen, 1);
    this.rod.position.set(left - grip + visLen / 2, this.rodY, 0);

    // Rail scale remains fixed at the cold free-end position.
    this.zeroReference.position.set(coldFree, 0, 0);

    // The whole right connection end follows the specimen and overlaps it.
    this.rightEnd.position.set(left + len, 0, 0);

    // Heater under mid cold span
    this.heater.position.set(left + coldLen * 0.5, 0, 0);
  }

  onParamChange(key) {
    if (key === 'material') this._applyMaterialLook();
    if (key === 'length0') {
      // snap visual length when L0 changes
      this._updateGeometry(true);
    }
  }

  reset() {
    super.reset();
    this.params.temperature = 80;
    this.params.length0 = 1.0;
    this.params.material = 'aluminum';
    this._applyMaterialLook();
    this._updateGeometry(true);
  }

  update(dt) {
    super.update(dt);
    this._updateGeometry(false);

    const heat = THREE.MathUtils.clamp(this._deltaT() / 380, 0, 1);
    const T = this.params.temperature + 273;
    const col = tempToColor(T, 280, 750, this._c);

    const t = this.clock.elapsedTime;
    // Pulse when hot so coils feel “alive”
    const pulse = 0.88 + 0.12 * Math.sin(t * (3 + heat * 4));

    // ── Heater coils: cold dark metal → white-hot nichrome ──
    const coilCol = this._c2;
    if (heat < 0.08) {
      coilCol.setRGB(0.28, 0.2, 0.14);
    } else if (heat < 0.45) {
      // dull red
      const v = (heat - 0.08) / 0.37;
      coilCol.setRGB(0.35 + v * 0.55, 0.12 + v * 0.08, 0.04);
    } else {
      // orange → yellow-white
      const v = (heat - 0.45) / 0.55;
      coilCol.setRGB(0.9 + v * 0.1, 0.25 + v * 0.55, 0.06 + v * 0.25);
    }

    const coilEmit = heat * 1.6 * pulse;
    if (this._coilMat) {
      this._coilMat.color.copy(coilCol);
      this._coilMat.emissive.copy(coilCol);
      this._coilMat.emissiveIntensity = 0.12 + coilEmit;
    }
    for (const bar of this.heaterBars || []) {
      bar.material.color.copy(coilCol);
      bar.material.emissive.copy(coilCol);
      bar.material.emissiveIntensity = 0.12 + coilEmit;
    }

    // Ceramic bed warms
    if (this.heaterCeramic) {
      this.heaterCeramic.material.emissive.copy(col).multiplyScalar(0.25);
      this.heaterCeramic.material.emissiveIntensity = 0.05 + heat * 0.55;
      this.heaterCeramic.material.color.setRGB(
        0.88 + heat * 0.08,
        0.82 - heat * 0.25,
        0.72 - heat * 0.4
      );
    }

    // Orange haze + rising shimmer
    for (let i = 0; i < (this.heaterGlows || []).length; i++) {
      const g = this.heaterGlows[i];
      g.material.opacity = heat * (0.22 - i * 0.04) * pulse;
      g.material.color.copy(coilCol);
      g.scale.y = 0.5 + heat * 0.35 + 0.05 * Math.sin(t * 2 + i);
    }
    for (let i = 0; i < (this.heaterShimmer || []).length; i++) {
      const p = this.heaterShimmer[i];
      p.material.opacity = heat * (0.16 - i * 0.03) * (0.7 + 0.3 * Math.sin(t * 5 + i));
      p.material.color.copy(coilCol);
      p.position.x = Math.sin(t * 1.8 + i * 1.3) * 0.06 * heat;
      p.scale.x = 1 + 0.08 * Math.sin(t * 3 + i);
    }

    // Point light: cold = off, hot = warm fill on rod
    if (this.heaterLight) {
      this.heaterLight.intensity = heat * 2.4 * pulse;
      this.heaterLight.color.copy(coilCol);
    }

    if (this.heaterLed?.material) {
      const on = heat > 0.02;
      this.heaterLed.material.color.set(on ? 0xef4444 : 0x22c55e);
      this.heaterLed.material.emissive.set(on ? 0xdc2626 : 0x16a34a);
      this.heaterLed.material.emissiveIntensity = on ? 0.6 + heat * 0.9 : 0.35;
    }

    // Uniform heat tint on the single rod mesh (no segmented mid/end pieces)
    this.rodMat.emissive.copy(col).multiplyScalar(heat * 0.28);
    this.rodMat.emissiveIntensity = heat * 0.65;
    const base = this._baseRodColor ?? this._mat().color;
    const br = ((base >> 16) & 255) / 255;
    const bg = ((base >> 8) & 255) / 255;
    const bb = (base & 255) / 255;
    this.rodMat.color.setRGB(
      br + (col.r - br) * heat * 0.45,
      bg + (col.g - bg) * heat * 0.35,
      bb + (col.b - bb) * heat * 0.2
    );
  }

  getReadouts() {
    const mat = this._mat();
    const dLmm = this._deltaL_m() * 1000;
    const Lmm = (this.params.length0 + this._deltaL_m()) * 1000;
    const strain = (this._deltaL_m() / this.params.length0) * 1000;
    return {
      deltaL: dLmm.toFixed(3),
      length: Lmm.toFixed(2),
      alpha: (mat.alpha * 1e6).toFixed(1),
      strain: strain.toFixed(3),
    };
  }
}
