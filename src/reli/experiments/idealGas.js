import * as THREE from 'three';
import { Experiment } from './base.js';
import { chrome, darkMetal, glass, metal, plastic, tempToColor } from '../lab/materials.js';
import { makeLabBench } from '../lab/primitives.js';

const R = 8.314;
const PARTICLE_COUNT = 200;

/**
 * Clean fixed-cylinder vacuum cell with sliding piston.
 * Glass tube height is fixed; volume changes by piston position only.
 */
export class IdealGasExperiment extends Experiment {
  get meta() {
    return {
      id: 'ideal-gas',
      name: '理想气体定律',
      tag: 'PV = nRT · 分子动理论',
      title: '真空气室 · 分子动理论',
      description:
        '固定高度的视窗气缸，活塞在腔内上下移动改变体积。调节温度观察分子热运动，读数见左侧仪器数显。',
      formula: 'pV = nRT；分子平均动能 Ē_k = (3/2)kT',
    };
  }

  get controlDefs() {
    return [
      { key: 'temperature', label: '温度设定 T', min: 150, max: 600, step: 5, unit: 'K' },
      { key: 'volume', label: '活塞行程 / 体积', min: 0.4, max: 1.25, step: 0.01, unit: '×' },
    ];
  }

  get readoutDefs() {
    return [
      { key: 'pressure', label: '腔压 P', unit: 'kPa', tone: 'warm' },
      { key: 'n', label: '物质的量 n', unit: 'mol' },
      { key: 'avgSpeed', label: '均方根速率', unit: 'm/s', tone: 'cool' },
      { key: 'collisions', label: '壁面碰撞率', unit: 'Hz', tone: 'ok' },
    ];
  }

  setup() {
    super.setup();
    this.params = { temperature: 300, volume: 1.0 };
    this.n = 0.04;
    this.collisionCount = 0;
    this.collisionWindow = 0;
    this.collisionsPerSec = 0;

    // Chamber geometry — fixed glass tube, piston slides inside
    this.chamberR = 0.9;
    this.glassBottom = 0.28; // bottom of glass tube
    this.cylH = 2.2; // fixed glass height
    this.glassTop = this.glassBottom + this.cylH;
    this.floorY = 0.22; // gas floor inside
    this.pistonT = 0.1;
    this.baseH = 1.35; // gas column height when volume = 1

    this.camera.position.set(5.0, 3.2, 5.2);
    this.controls.target.set(0, 1.6, 0);

    const bench = makeLabBench(5.5, 3.2, 0.85);
    this.scene.add(bench);
    const y0 = bench.userData.topY;

    this.rig = new THREE.Group();
    this.rig.position.y = y0;
    this.scene.add(this.rig);

    const r = this.chamberR;
    const steel = metal(0x8b95a5, { roughness: 0.34, metalness: 0.78 });
    const steelDark = darkMetal(0x2c3340);
    const steelBright = chrome(0xc8d0dc);

    // —— Round base on bench ——
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(r + 0.28, r + 0.34, 0.1, 48),
      steelDark
    );
    plinth.position.y = 0.05;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    this.rig.add(plinth);

    // Bottom flange under glass
    const botFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(r + 0.12, r + 0.14, 0.09, 48),
      steel
    );
    botFlange.position.y = this.glassBottom - 0.02;
    botFlange.castShadow = true;
    this.rig.add(botFlange);
    this._addBolts(botFlange, r + 0.07, 8, 0.05);

    // Inner floor
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(r - 0.03, r - 0.03, 0.035, 48),
      metal(0x4a5568, { roughness: 0.5 })
    );
    floor.position.y = this.floorY;
    floor.receiveShadow = true;
    this.rig.add(floor);

    // —— Fixed glass tube (open top) ——
    this.viewport = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, this.cylH, 64, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xc5e4f7,
        transparent: true,
        opacity: 0.28,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        roughness: 0.04,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.viewport.position.y = this.glassBottom + this.cylH / 2;
    this.rig.add(this.viewport);

    // One mid reinforcement band
    const midBand = new THREE.Mesh(
      new THREE.TorusGeometry(r + 0.012, 0.02, 10, 64),
      steelBright
    );
    midBand.rotation.x = Math.PI / 2;
    midBand.position.y = this.glassBottom + this.cylH * 0.45;
    this.rig.add(midBand);

    // Open top lip (ring only — not a solid lid)
    const topLip = new THREE.Mesh(
      new THREE.TorusGeometry(r + 0.02, 0.035, 12, 48),
      steel
    );
    topLip.rotation.x = Math.PI / 2;
    topLip.position.y = this.glassTop;
    this.rig.add(topLip);

    // —— Portal frame: columns LEFT / RIGHT, beam OVER center ——
    // Actuator sits on the beam at (0, frameTop, 0) — same axis as piston rod
    const colX = r + 0.42;
    const colH = this.glassTop + 0.85;
    const beamY = colH;
    this.actuatorY = beamY - 0.08; // rod connects under actuator

    [-colX, colX].forEach((x) => {
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, colH, 0.12),
        steelDark
      );
      col.position.set(x, colH / 2, 0);
      col.castShadow = true;
      this.rig.add(col);

      // Foot pad
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.06, 0.22),
        steel
      );
      foot.position.set(x, 0.03, 0);
      this.rig.add(foot);
    });

    // Crossbeam through cylinder axis
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(colX * 2 + 0.2, 0.14, 0.16),
      steel
    );
    beam.position.set(0, beamY, 0);
    beam.castShadow = true;
    this.rig.add(beam);

    // Linear actuator housing — centered above chamber
    const actBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.32, 0.36),
      steelDark
    );
    actBody.position.set(0, this.actuatorY + 0.12, 0);
    actBody.castShadow = true;
    this.rig.add(actBody);

    // Guide bushing under actuator (rod passes through)
    const bushing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.12, 20),
      steelBright
    );
    bushing.position.set(0, this.actuatorY - 0.02, 0);
    this.rig.add(bushing);

    // —— Piston (inside glass) ——
    this.piston = new THREE.Group();
    this.rig.add(this.piston);

    const pistonBody = new THREE.Mesh(
      new THREE.CylinderGeometry(r - 0.05, r - 0.05, this.pistonT, 48),
      metal(0x9aa3b2, { metalness: 0.82, roughness: 0.28 })
    );
    pistonBody.castShadow = true;
    this.piston.add(pistonBody);

    // Top face detail (slightly inset)
    const pistonFace = new THREE.Mesh(
      new THREE.CylinderGeometry(r - 0.12, r - 0.12, 0.02, 32),
      metal(0x6b7588, { roughness: 0.4 })
    );
    pistonFace.position.y = this.pistonT / 2 - 0.005;
    this.piston.add(pistonFace);

    const seal = new THREE.Mesh(
      new THREE.TorusGeometry(r - 0.055, 0.016, 8, 40),
      plastic(0x1a1a1a)
    );
    seal.rotation.x = Math.PI / 2;
    this.piston.add(seal);

    // Piston rod — unit height 1, scaled to reach actuator
    this.rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 1.0, 20),
      steelBright
    );
    this.rod.position.y = 0.5;
    this.piston.add(this.rod);

    // Temperature indicator ring at base
    this.thermalBand = new THREE.Mesh(
      new THREE.TorusGeometry(r + 0.05, 0.03, 10, 48),
      new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        emissive: 0x1e40af,
        emissiveIntensity: 0.55,
        metalness: 0.35,
        roughness: 0.4,
      })
    );
    this.thermalBand.rotation.x = Math.PI / 2;
    this.thermalBand.position.y = this.glassBottom + 0.06;
    this.rig.add(this.thermalBand);

    // Pressure port on glass side
    const port = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.14, 14),
      steel
    );
    port.rotation.z = Math.PI / 2;
    port.position.set(r + 0.07, this.glassBottom + 0.35, 0);
    this.rig.add(port);

    // Particles
    const pGeo = new THREE.SphereGeometry(0.03, 10, 10);
    const pMat = new THREE.MeshStandardMaterial({
      color: 0x5eead4,
      emissive: 0x0a3a32,
      metalness: 0.15,
      roughness: 0.4,
    });
    this.particlesMesh = new THREE.InstancedMesh(pGeo, pMat, PARTICLE_COUNT);
    this.particlesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 200 instanced spheres casting soft shadows dominates the host shadow pass.
    this.particlesMesh.castShadow = false;
    this.particlesMesh.receiveShadow = false;
    this.rig.add(this.particlesMesh);
    this.dummy = new THREE.Object3D();
    this.particles = [];

    // Rod top connection height (under bushing)
    this.frameTopY = this.actuatorY - 0.06;

    this._initParticles();
    this._updatePistonGeometry();
  }

  _addBolts(parent, radius, count, y) {
    const geo = new THREE.CylinderGeometry(0.028, 0.028, 0.035, 8);
    const mat = darkMetal(0x3a4250);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const b = new THREE.Mesh(geo, mat);
      b.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
      parent.add(b);
    }
  }

  /** Gas region height under piston (proportional to volume param). */
  _height() {
    return this.baseH * this.params.volume;
  }

  _pistonCenterY() {
    return this.floorY + this._height() + this.pistonT / 2;
  }

  _initParticles() {
    this.particles = [];
    const h = this._height();
    const r = this.chamberR - 0.08;
    const speedScale = Math.sqrt(this.params.temperature / 300) * 2.2;
    const y0 = this.floorY + 0.06;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r * 0.92;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      )
        .normalize()
        .multiplyScalar(speedScale * (0.65 + Math.random() * 0.7));

      this.particles.push({
        pos: new THREE.Vector3(
          Math.cos(a) * rr,
          y0 + Math.random() * Math.max(0.15, h - 0.15),
          Math.sin(a) * rr
        ),
        vel,
      });
    }
  }

  _updatePistonGeometry() {
    const py = this._pistonCenterY();
    this.piston.position.y = py;

    // Rod from piston top face up to actuator bushing (same XZ axis)
    const rodTop = this.frameTopY;
    const rodBottom = this.pistonT / 2;
    const rodLen = Math.max(0.25, rodTop - py - rodBottom);
    this.rod.scale.y = rodLen; // base geometry height = 1
    this.rod.position.y = rodBottom + rodLen / 2;
  }

  _rescaleSpeeds() {
    const target = Math.sqrt(this.params.temperature / 300) * 2.2;
    let sum = 0;
    for (const p of this.particles) sum += p.vel.length();
    const avg = sum / this.particles.length || 1;
    const factor = target / avg;
    for (const p of this.particles) p.vel.multiplyScalar(factor);
  }

  onParamChange(key) {
    if (key === 'temperature') this._rescaleSpeeds();
    if (key === 'volume') {
      this._updatePistonGeometry();
      const yMax = this.floorY + this._height() - 0.05;
      for (const p of this.particles) {
        if (p.pos.y > yMax) p.pos.y = yMax;
      }
    }
  }

  reset() {
    super.reset();
    this.params.temperature = 300;
    this.params.volume = 1.0;
    this.collisionCount = 0;
    this.collisionWindow = 0;
    this.collisionsPerSec = 0;
    this._updatePistonGeometry();
    this._initParticles();
  }

  update(dt) {
    super.update(dt);
    const h = this._height();
    const rMax = this.chamberR - 0.07;
    const yMin = this.floorY + 0.05;
    const yMax = this.floorY + h - 0.04;

    const col = tempToColor(this.params.temperature, 150, 600);
    this.particlesMesh.material.color.copy(col);
    this.particlesMesh.material.emissive.copy(col).multiplyScalar(0.28);
    this.thermalBand.material.color.copy(col);
    this.thermalBand.material.emissive.copy(col).multiplyScalar(0.45);

    // When hosted by the lab shell, ExperimentSimBackend owns particle
    // integrate + wall collisions (latest-complete-wins). Source only paints
    // instance matrices from already-written pos/vel — never double-step.
    if (!this._hostParticlesOwned) {
      let coll = 0;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        p.pos.addScaledVector(p.vel, dt);

        const rr = Math.hypot(p.pos.x, p.pos.z);
        if (rr > rMax) {
          const nx = p.pos.x / rr;
          const nz = p.pos.z / rr;
          const vn = p.vel.x * nx + p.vel.z * nz;
          if (vn > 0) {
            p.vel.x -= 2 * vn * nx;
            p.vel.z -= 2 * vn * nz;
          }
          p.pos.x = nx * rMax * 0.98;
          p.pos.z = nz * rMax * 0.98;
          coll++;
        }
        if (p.pos.y > yMax || p.pos.y < yMin) {
          p.vel.y *= -1;
          p.pos.y = THREE.MathUtils.clamp(p.pos.y, yMin, yMax);
          coll++;
        }

        this.dummy.position.copy(p.pos);
        this.dummy.updateMatrix();
        this.particlesMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.particlesMesh.instanceMatrix.needsUpdate = true;

      this.collisionCount += coll;
      this.collisionWindow += dt;
      if (this.collisionWindow >= 0.45) {
        this.collisionsPerSec = Math.round(this.collisionCount / this.collisionWindow);
        this.collisionCount = 0;
        this.collisionWindow = 0;
      }
    } else {
      // Host already wrote pos/vel; only refresh instance matrices + colors.
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        this.dummy.position.copy(p.pos);
        this.dummy.updateMatrix();
        this.particlesMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.particlesMesh.instanceMatrix.needsUpdate = true;
    }

    // Keep piston synced with tiny pressure jitter; rod stays coaxial with actuator
    const P = (this.n * R * this.params.temperature) / this.params.volume;
    const baseY = this._pistonCenterY();
    this.piston.position.y =
      baseY + Math.sin(this.clock.elapsedTime * 22) * 0.0015 * Math.min(2, P / 80);

    const py = this.piston.position.y;
    const rodBottom = this.pistonT / 2;
    const rodLen = Math.max(0.25, this.frameTopY - py - rodBottom);
    this.rod.scale.y = rodLen;
    this.rod.position.y = rodBottom + rodLen / 2;
  }

  getReadouts() {
    const V = this.params.volume;
    const T = this.params.temperature;
    const P = (this.n * R * T) / V;
    const pressureKPa = (P / 1000) * 12;
    let sum = 0;
    for (const p of this.particles) sum += p.vel.length();
    const avg = sum / this.particles.length;
    const avgSpeed = Math.round(Math.sqrt(T / 300) * 480 + avg * 20);
    return {
      pressure: pressureKPa.toFixed(1),
      n: this.n.toFixed(3),
      avgSpeed: String(avgSpeed),
      collisions: String(this.collisionsPerSec),
    };
  }
}
