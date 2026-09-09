import * as THREE from 'three';
import { Experiment } from './base.js';
import { chrome, darkMetal, metal, tempToColor } from '../lab/materials.js';
import { makeLabBench } from '../lab/primitives.js';

const SEGMENTS = 48;
const PARTICLE_COUNT = 55;

/**
 * Thermal conductivity rig: transparent sample tube with heat-carrier particles inside.
 */
export class HeatConductionExperiment extends Experiment {
  get meta() {
    return {
      id: 'heat-conduction',
      name: '热传导实验',
      tag: '傅里叶定律 · 温度场',
      title: '导热系数测量台',
      description:
        '两端恒温浴夹持透明试样管，管内粒子示意热载流子沿温度梯度迁移。调节端温与导热系数；读数见左侧仪器数显。',
      formula: 'Q/t ∝ kA(ΔT/Δx)；稳态时沿棒温度近似线性分布',
    };
  }

  get controlDefs() {
    return [
      { key: 'tHot', label: '热浴温度', min: 200, max: 900, step: 10, unit: 'K' },
      { key: 'tCold', label: '冷浴温度', min: 200, max: 900, step: 10, unit: 'K' },
      { key: 'conductivity', label: '试样导热 k', min: 0.15, max: 3.5, step: 0.05, unit: '' },
      {
        key: 'running',
        label: '数据采集',
        type: 'toggle',
        options: [
          { value: true, label: '运行' },
          { value: false, label: '暂停' },
        ],
      },
    ];
  }

  get readoutDefs() {
    return [
      { key: 'tMid', label: '中点温度', unit: 'K', tone: 'warm' },
      { key: 'heatFlux', label: '热流密度 q', unit: 'W/m²', tone: 'hot' },
      { key: 'deltaT', label: '端温差 ΔT', unit: 'K' },
      { key: 'progress', label: '稳态吻合度', unit: '%', tone: 'ok' },
    ];
  }

  setup() {
    super.setup();
    this.params = { tHot: 700, tCold: 280, conductivity: 1.2, running: true };
    this.temps = new Float32Array(SEGMENTS).fill(300);
    this.nextTemps = new Float32Array(SEGMENTS);
    this._c = new THREE.Color();

    this.rodY = 0.88;
    this.rodLen = 4.6;
    this.rodR = 0.16; // outer glass radius
    this.innerR = 0.13; // particle confinement

    this.camera.position.set(0.8, 2.8, 6.5);
    this.controls.target.set(0, 1.1, 0);

    const bench = makeLabBench(7.5, 2.8, 0.88);
    this.scene.add(bench);
    const y0 = bench.userData.topY;

    this.rig = new THREE.Group();
    this.rig.position.y = y0;
    this.scene.add(this.rig);

    const steel = metal(0x8b95a5, { roughness: 0.36, metalness: 0.76 });
    const steelDark = darkMetal(0x2a3140);
    const half = this.rodLen / 2;

    // —— Base rail ——
    const rail = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.1, 0.48), steelDark);
    rail.position.set(0, 0.05, 0);
    rail.receiveShadow = true;
    rail.castShadow = true;
    this.rig.add(rail);

    const railTop = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.03, 0.36), steel);
    railTop.position.set(0, 0.115, 0);
    this.rig.add(railTop);

    // —— End baths ——
    this.hotBath = this._makeBath(true);
    this.hotBath.position.set(-half - 0.55, 0, 0);
    this.rig.add(this.hotBath);

    this.coldBath = this._makeBath(false);
    this.coldBath.position.set(half + 0.55, 0, 0);
    this.rig.add(this.coldBath);

    // —— Transparent tube (open cylinder) ——
    this.tube = new THREE.Mesh(
      new THREE.CylinderGeometry(this.rodR, this.rodR, this.rodLen, 48, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xc8e4f8,
        transparent: true,
        opacity: 0.28,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        roughness: 0.05,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.tube.rotation.z = Math.PI / 2;
    this.tube.position.set(0, this.rodY, 0);
    this.rig.add(this.tube);

    // Subtle temperature-tint shell segments (inside glass, low opacity)
    this.rodGroup = new THREE.Group();
    this.rig.add(this.rodGroup);
    const segLen = this.rodLen / SEGMENTS;
    this.segMeshes = [];
    const segGeo = new THREE.CylinderGeometry(this.innerR * 0.92, this.innerR * 0.92, segLen * 1.01, 20);
    segGeo.rotateZ(Math.PI / 2);

    for (let i = 0; i < SEGMENTS; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8899aa,
        transparent: true,
        opacity: 0.22,
        metalness: 0.15,
        roughness: 0.45,
        emissive: 0x000000,
        depthWrite: false,
      });
      const m = new THREE.Mesh(segGeo, mat);
      m.position.set(-half + segLen * (i + 0.5), this.rodY, 0);
      this.rodGroup.add(m);
      this.segMeshes.push(m);
    }

    // End collars
    [-half + 0.04, half - 0.04].forEach((x) => {
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(this.rodR + 0.035, this.rodR + 0.045, 0.14, 24),
        chrome()
      );
      collar.rotation.z = Math.PI / 2;
      collar.position.set(x, this.rodY, 0);
      this.rig.add(collar);
    });

    // —— Supports ——
    [-1.35, 1.35].forEach((x) => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.4), steelDark);
      block.position.set(x, 0.22, 0);
      block.castShadow = true;
      this.rig.add(block);

      const cradle = new THREE.Mesh(
        new THREE.CylinderGeometry(this.rodR + 0.02, this.rodR + 0.02, 0.3, 20, 1, false, 0, Math.PI),
        steel
      );
      cradle.rotation.z = Math.PI / 2;
      cradle.rotation.x = Math.PI;
      cradle.position.set(x, this.rodY - 0.01, 0);
      this.rig.add(cradle);

      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.05, this.rodY - 0.28, 12),
        chrome()
      );
      post.position.set(x, 0.33 + (this.rodY - 0.28) / 2 - 0.05, 0);
      this.rig.add(post);
    });

    // —— Particles INSIDE the tube ——
    this.flowParticles = [];
    const pGeo = new THREE.SphereGeometry(0.032, 12, 12);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0x442200,
        emissiveIntensity: 0.55,
        metalness: 0.1,
        roughness: 0.35,
        transparent: true,
        opacity: 0.9,
      });
      const m = new THREE.Mesh(pGeo, mat);
      this.rig.add(m);
      // Random radial offset inside tube cross-section
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * this.innerR * 0.75;
      this.flowParticles.push({
        mesh: m,
        t: Math.random(),
        offY: Math.cos(a) * rr,
        offZ: Math.sin(a) * rr,
        spin: 0.5 + Math.random() * 1.5,
      });
    }

    this.temps[0] = this.params.tHot;
    this.temps[SEGMENTS - 1] = this.params.tCold;
    this._applyColors();
  }

  _makeBath(isHot) {
    const g = new THREE.Group();
    const bodyR = 0.48;
    const bodyH = 1.05;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyR, bodyR * 1.05, bodyH, 40),
      metal(0x6b7588, { roughness: 0.38 })
    );
    body.position.y = bodyH / 2 + 0.08;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyR + 0.12, bodyR + 0.14, 0.1, 40),
      darkMetal(0x2a3140)
    );
    base.position.y = 0.05;
    g.add(base);

    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyR + 0.02, bodyR + 0.02, 0.08, 40),
      darkMetal(0x343c4c)
    );
    lid.position.y = bodyH + 0.1;
    g.add(lid);

    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.06, 16), chrome());
    knob.position.y = bodyH + 0.17;
    g.add(knob);

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyR + 0.015, bodyR + 0.015, 0.28, 40),
      new THREE.MeshStandardMaterial({
        color: isHot ? 0xef4444 : 0x3b82f6,
        emissive: isHot ? 0xef4444 : 0x3b82f6,
        emissiveIntensity: 0.45,
        metalness: 0.25,
        roughness: 0.4,
      })
    );
    band.position.y = this.rodY;
    g.add(band);
    g.userData.band = band;

    const portDir = isHot ? 1 : -1;
    const port = new THREE.Mesh(
      new THREE.CylinderGeometry(this.rodR + 0.04, this.rodR + 0.06, 0.22, 20),
      chrome()
    );
    port.rotation.z = Math.PI / 2;
    port.position.set(portDir * (bodyR + 0.05), this.rodY, 0);
    g.add(port);

    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 12, 12),
      new THREE.MeshStandardMaterial({
        color: isHot ? 0xef4444 : 0x3b82f6,
        emissive: isHot ? 0xef4444 : 0x3b82f6,
        emissiveIntensity: 0.85,
      })
    );
    led.position.set(0.2, bodyH + 0.16, 0.28);
    g.add(led);
    g.userData.led = led;

    return g;
  }

  _applyColors() {
    for (let i = 0; i < SEGMENTS; i++) {
      const c = tempToColor(this.temps[i], 220, 850, this._c);
      const m = this.segMeshes[i].material;
      m.color.copy(c);
      m.emissive.copy(c).multiplyScalar(0.25);
      m.opacity = 0.14 + Math.min(0.28, (this.temps[i] - 220) / 2000);
    }

    const ch = tempToColor(this.params.tHot, 220, 900);
    this.hotBath.userData.band.material.color.copy(ch);
    this.hotBath.userData.band.material.emissive.copy(ch);
    this.hotBath.userData.led.material.color.copy(ch);
    this.hotBath.userData.led.material.emissive.copy(ch);

    const cc = tempToColor(this.params.tCold, 200, 500);
    this.coldBath.userData.band.material.color.copy(cc);
    this.coldBath.userData.band.material.emissive.copy(cc);
    this.coldBath.userData.led.material.color.copy(cc);
    this.coldBath.userData.led.material.emissive.copy(cc);
  }

  onParamChange(key) {
    if (key === 'tHot') this.temps[0] = this.params.tHot;
    if (key === 'tCold') this.temps[SEGMENTS - 1] = this.params.tCold;
  }

  reset() {
    super.reset();
    this.params.tHot = 700;
    this.params.tCold = 280;
    this.params.conductivity = 1.2;
    this.params.running = true;
    this.temps.fill(300);
    this.temps[0] = this.params.tHot;
    this.temps[SEGMENTS - 1] = this.params.tCold;
    this._applyColors();
  }

  update(dt) {
    super.update(dt);

    // When hosted by the lab shell, the host manager owns the finite-difference
    // temperature field. Integrating here as well made the rod evolve ~2× fast
    // and desynced HUD mid-temperature from the painted segments.
    if (this.params.running && !this._hostFieldOwned) {
      const alpha = this.params.conductivity * 0.35;
      const steps = Math.min(10, Math.ceil(dt * 60));
      const h = Math.min(dt / steps, 0.02);
      for (let s = 0; s < steps; s++) {
        this.nextTemps[0] = this.params.tHot;
        this.nextTemps[SEGMENTS - 1] = this.params.tCold;
        for (let i = 1; i < SEGMENTS - 1; i++) {
          const lap = this.temps[i - 1] - 2 * this.temps[i] + this.temps[i + 1];
          this.nextTemps[i] = this.temps[i] + alpha * h * lap;
        }
        this.temps.set(this.nextTemps);
      }
    }

    this._applyColors();

    // Particles move inside the transparent tube
    // Speed strongly tracks heat flux q ∝ k·ΔT so slider changes are obvious
    const half = this.rodLen / 2;
    const margin = 0.12;
    const dT = Math.abs(this.params.tHot - this.params.tCold);
    const kNorm = this.params.conductivity / 1.2; // 1 at default k
    // Between previous "too fast" and "too slow" — default ΔT ~1 pass / ~2.5s
    const speed = 0.08 + (dT / 420) * kNorm * 0.58;
    const dir = this.params.tHot >= this.params.tCold ? 1 : -1;
    const t = this.clock.elapsedTime;

    for (const fp of this.flowParticles) {
      if (this.params.running && dT > 1) {
        fp.t += dt * speed * fp.spin * 0.42;
        if (fp.t > 1) fp.t -= 1;
      }

      const u = dir > 0 ? fp.t : 1 - fp.t;
      const x = -half + margin + u * (this.rodLen - margin * 2);

      // slight motion inside tube cross-section
      const wobble = 0.01 * Math.sin(t * fp.spin * (0.8 + speed * 0.4) + fp.t * 10);
      fp.mesh.position.set(
        x,
        this.rodY + fp.offY + wobble,
        fp.offZ + wobble * 0.6
      );

      const idx = Math.min(SEGMENTS - 1, Math.max(0, Math.floor(u * (SEGMENTS - 1))));
      const c = tempToColor(this.temps[idx], 220, 850);
      fp.mesh.material.color.copy(c);
      fp.mesh.material.emissive.copy(c).multiplyScalar(0.35 + Math.min(0.35, speed * 0.15));
      // brighter / slightly larger when flux is high
      const s = 0.85 + Math.min(0.55, speed * 0.25);
      fp.mesh.scale.setScalar(s);
      fp.mesh.material.opacity = 0.7 + Math.min(0.28, speed * 0.12);
      fp.mesh.visible = true;
    }
  }

  getReadouts() {
    const mid = this.temps[Math.floor(SEGMENTS / 2)];
    const dT = this.params.tHot - this.params.tCold;
    const q = this.params.conductivity * Math.abs(dT) * 85;
    let err = 0;
    for (let i = 0; i < SEGMENTS; i++) {
      const linear =
        this.params.tHot + (this.params.tCold - this.params.tHot) * (i / (SEGMENTS - 1));
      err += Math.abs(this.temps[i] - linear);
    }
    const progress = Math.max(0, 100 - (err / SEGMENTS / Math.max(1, Math.abs(dT))) * 100);
    return {
      tMid: mid.toFixed(1),
      heatFlux: q.toFixed(0),
      deltaT: dT.toFixed(0),
      progress: progress.toFixed(0),
    };
  }
}
