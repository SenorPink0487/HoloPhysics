import * as THREE from 'three';
import { Experiment } from './base.js';
import { chrome, darkMetal, metal, tempToColor } from '../lab/materials.js';
import { makeLabBench } from '../lab/primitives.js';

/** Soft smoke tracers — dense enough to read as a continuous plume */
const PARTICLE_COUNT = 1800;

/**
 * Natural convection: buoyancy-driven smoke plume over a hot plate.
 * Particles carry temperature, feel Boussinesq lift, and form organic
 * rising cores + wall return flows — no didactic arrows/labels.
 */
export class ConvectionExperiment extends Experiment {
  get meta() {
    return {
      id: 'convection',
      name: '自然对流',
      tag: 'BUOYANCY · Nu(Ra)',
      title: '自然对流换热台',
      description:
        '热板加热近壁空气，密度降低后受浮力上升，形成羽流；羽流冷却后沿侧壁回流。' +
        'ΔT 越大瑞利数 Ra 越高，环流越强；对流换热 Q = h A ΔT。',
      formula: 'Q = hAΔt；温差越大对流换热越强',
    };
  }

  get controlDefs() {
    return [
      { key: 'tPlate', label: '热板温度', min: 300, max: 900, step: 10, unit: 'K' },
      { key: 'tAir', label: '环境温度', min: 250, max: 350, step: 5, unit: 'K' },
      { key: 'area', label: '换热面积', min: 0.05, max: 0.25, step: 0.01, unit: 'm²' },
      {
        key: 'running',
        label: '流动',
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
      { key: 'deltaT', label: '温差 ΔT', unit: 'K', tone: 'warm' },
      { key: 'h', label: '对流系数 h', unit: 'W/(m²·K)', tone: 'ok' },
      { key: 'q', label: '对流热流 Q', unit: 'W', tone: 'hot' },
      { key: 'ra', label: '瑞利数 Ra', unit: '', tone: 'cool' },
      { key: 'nu', label: '努塞尔数 Nu', unit: '', tone: 'ok' },
    ];
  }

  setup() {
    super.setup();
    this.params = { tPlate: 650, tAir: 300, area: 0.12, running: true };
    this._c = new THREE.Color();
    this._cHot = new THREE.Color();
    this._cCool = new THREE.Color();

    this.chamberW = 2.2;
    this.chamberH = 2.35;
    this.chamberD = 1.25;
    this.plateY = 0.28;
    this.airBot = 0.38;
    this.airTop = 0.2 + this.chamberH - 0.12;

    // Closer 3/4 view so the plume fills more of the frame
    this.camera.position.set(2.9, 2.35, 3.6);
    this.controls.target.set(0, 1.25, 0);
    // Local fog is lighter so smoke doesn't wash out
    this.scene.fog = new THREE.FogExp2(0x0a0e16, 0.016);

    const bench = makeLabBench(5.5, 2.8, 0.88);
    this.scene.add(bench);
    const y0 = bench.userData.topY;

    this.rig = new THREE.Group();
    this.rig.position.y = y0;
    this.scene.add(this.rig);

    const steel = metal(0x8b95a5, { roughness: 0.36 });
    const steelDark = darkMetal(0x2a3140);

    const base = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 1.85), steelDark);
    base.position.y = 0.05;
    base.receiveShadow = true;
    base.castShadow = true;
    this.rig.add(base);

    // Glass enclosure — four light walls, open top (symmetric)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xb8d4ea,
      transparent: true,
      opacity: 0.28,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      roughness: 0.04,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const wallT = 0.035;
    const hw = this.chamberW / 2;
    const hd = this.chamberD / 2;
    const ch = this.chamberH;
    const wallY = 0.2 + ch / 2;

    const front = new THREE.Mesh(new THREE.BoxGeometry(this.chamberW, ch, wallT), glassMat);
    front.position.set(0, wallY, hd);
    this.rig.add(front);
    const back = front.clone();
    back.position.z = -hd;
    this.rig.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, ch, this.chamberD), glassMat);
    left.position.set(-hw, wallY, 0);
    this.rig.add(left);
    const right = left.clone();
    right.position.x = hw;
    this.rig.add(right);

    [
      [-hw, -hd],
      [hw, -hd],
      [-hw, hd],
      [hw, hd],
    ].forEach(([x, z]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, ch + 0.12, 0.055), steelDark);
      post.position.set(x, wallY, z);
      post.castShadow = true;
      this.rig.add(post);
    });

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(this.chamberW + 0.08, 0.05, this.chamberD + 0.08),
      steel
    );
    rim.position.y = 0.2 + ch + 0.025;
    this.rig.add(rim);

    // Hot plate — dull metal that glows with temperature
    this.plate = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.07, 0.85),
      new THREE.MeshStandardMaterial({
        color: 0x4a3a32,
        emissive: 0x000000,
        emissiveIntensity: 0,
        metalness: 0.55,
        roughness: 0.48,
      })
    );
    this.plate.position.set(0, this.plateY, 0);
    this.plate.castShadow = true;
    this.plate.receiveShadow = true;
    this.rig.add(this.plate);

    // Soft heat bloom just above plate surface
    this.plateBloom = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff6020,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.plateBloom.rotation.x = -Math.PI / 2;
    this.plateBloom.position.set(0, this.plateY + 0.04, 0);
    this.rig.add(this.plateBloom);

    this.coils = [];
    for (let i = 0; i < 4; i++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.11, 0.018, 8, 20),
        new THREE.MeshStandardMaterial({
          color: 0x5a4030,
          emissive: 0x331808,
          emissiveIntensity: 0.2,
          metalness: 0.45,
          roughness: 0.5,
        })
      );
      coil.rotation.x = Math.PI / 2;
      coil.position.set(-0.42 + i * 0.28, 0.2, 0);
      this.rig.add(coil);
      this.coils.push(coil);
    }

    // Thermocouple
    const probe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.85, 8),
      chrome()
    );
    probe.position.set(0.52, 0.85, 0.32);
    this.rig.add(probe);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x22d3ee,
        emissive: 0x0891b2,
        emissiveIntensity: 0.45,
      })
    );
    tip.position.set(0.52, 0.42, 0.32);
    this.rig.add(tip);

    // —— Smoke / heat tracers (Points) ——
    this.smokeTex = this._makeSmokeTexture();
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Soft smoke sprite + per-particle size (balanced brightness)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.smokeTex },
        uOpacity: { value: 0.55 },
        uScale: { value: 320 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          float lum = max(color.r, max(color.g, color.b));
          vAlpha = 0.4 + lum * 0.4;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale * (1.0 / max(0.35, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float a = tex.a * uOpacity * vAlpha;
          if (a < 0.02) discard;
          vec3 rgb = vColor * (0.4 + tex.r * 0.7);
          gl_FragColor = vec4(rgb, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.smoke = new THREE.Points(geo, mat);
    this.smoke.frustumCulled = false;
    this.rig.add(this.smoke);

    this.positions = positions;
    this.colors = colors;
    this.sizes = sizes;
    this.particles = [];

    this._initParticles();
    this._updatePlateSize();
  }

  _makeSmokeTexture() {
    const s = 128;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Cheap 3-value hash noise for organic swirl (no extra deps). */
  _noise(x, y, z, t) {
    const s = Math.sin(x * 1.7 + t * 0.7) * Math.cos(y * 2.1 - t * 0.55) * Math.sin(z * 1.9 + t * 0.4);
    const s2 = Math.sin(x * 3.3 - y * 2.4 + t * 1.1) * 0.5;
    return s + s2;
  }

  _plateHalf() {
    const sc = Math.sqrt(this.params.area / 0.12);
    return { hx: 0.675 * sc, hz: 0.425 * sc };
  }

  _spawnParticle(p, mode = 'mixed') {
    const { hx, hz } = this._plateHalf();
    const dT = this._deltaT();
    const tAir = this.params.tAir;

    if (mode === 'nearPlate' || (mode === 'mixed' && Math.random() < 0.68)) {
      // Seed in thin layer just above plate — denser core = clearer plume
      p.x = (Math.random() - 0.5) * hx * 1.5;
      p.z = (Math.random() - 0.5) * hz * 1.5;
      p.y = this.airBot + Math.random() * 0.18;
      p.temp = tAir + dT * (0.65 + Math.random() * 0.35);
    } else if (mode === 'wall' || (mode === 'mixed' && Math.random() < 0.5)) {
      // Cool air along side walls
      const side = Math.random() < 0.5 ? -1 : 1;
      p.x = side * (this.chamberW * 0.38 + Math.random() * 0.12);
      p.z = (Math.random() - 0.5) * this.chamberD * 0.7;
      p.y = this.airBot + 0.3 + Math.random() * (this.airTop - this.airBot - 0.4);
      p.temp = tAir + dT * Math.random() * 0.12;
    } else {
      // Fill volume
      p.x = (Math.random() - 0.5) * this.chamberW * 0.85;
      p.z = (Math.random() - 0.5) * this.chamberD * 0.8;
      p.y = this.airBot + Math.random() * (this.airTop - this.airBot);
      p.temp = tAir + dT * Math.random() * 0.25;
    }

    p.vx = (Math.random() - 0.5) * 0.05;
    p.vy = (Math.random() - 0.5) * 0.02;
    p.vz = (Math.random() - 0.5) * 0.05;
    p.life = 0.4 + Math.random() * 0.6;
    p.age = Math.random();
    p.size = 0.11 + Math.random() * 0.12;
  }

  _initParticles() {
    this.particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        temp: this.params.tAir,
        life: 1,
        age: 0,
        size: 0.1,
      };
      this._spawnParticle(p, 'mixed');
      this.particles.push(p);
    }
  }

  _deltaT() {
    return Math.max(0, this.params.tPlate - this.params.tAir);
  }

  _h() {
    const dT = this._deltaT();
    if (dT < 1) return 2;
    const L = Math.sqrt(this.params.area);
    const Ra = 1e8 * dT * L ** 3;
    const Nu = 0.15 * Math.pow(Math.max(Ra, 1), 1 / 3);
    const kAir = 0.028;
    return Math.max(3, (Nu * kAir) / L);
  }

  _ra() {
    const dT = this._deltaT();
    const L = Math.sqrt(this.params.area);
    return 1e8 * dT * L ** 3;
  }

  _nu() {
    return 0.15 * Math.pow(Math.max(this._ra(), 1), 1 / 3);
  }

  _updatePlateSize() {
    const scale = Math.sqrt(this.params.area / 0.12);
    this.plate.scale.set(scale, 1, scale);
    this.plateBloom.scale.set(scale, scale, 1);
  }

  onParamChange(key) {
    if (key === 'area') this._updatePlateSize();
  }

  reset() {
    super.reset();
    this.params.tPlate = 650;
    this.params.tAir = 300;
    this.params.area = 0.12;
    this.params.running = true;
    this._updatePlateSize();
    this._initParticles();
  }

  update(dt) {
    super.update(dt);
    // Cap dt so pause/resume or tab switch doesn't explode velocities
    const h = Math.min(dt, 0.05);
    const dT = this._deltaT();
    const heat = THREE.MathUtils.clamp(dT / 520, 0, 1);
    const t = this.clock.elapsedTime;
    const tAir = this.params.tAir;
    const tPlate = this.params.tPlate;
    const running = this.params.running && dT > 3;

    // Plate appearance: metal → glowing
    const col = tempToColor(tPlate, 280, 950, this._c);
    // Blend base metal with thermal color
    this.plate.material.color.setRGB(
      0.22 + col.r * 0.55 * heat,
      0.16 + col.g * 0.35 * heat,
      0.12 + col.b * 0.2 * heat
    );
    this.plate.material.emissive.copy(col).multiplyScalar(0.12 + heat * 0.55);
    this.plate.material.emissiveIntensity = heat * 0.85;
    this.plate.material.roughness = 0.55 - heat * 0.15;

    this.plateBloom.material.color.copy(col);
    this.plateBloom.material.opacity = heat * 0.22 * (0.85 + 0.15 * Math.sin(t * 2.2));

    for (const coil of this.coils) {
      coil.material.emissive.copy(col).multiplyScalar(0.35);
      coil.material.emissiveIntensity = 0.12 + heat * 0.7;
      coil.material.color.setRGB(0.25 + heat * 0.4, 0.18 + heat * 0.18, 0.12);
    }

    this.smoke.material.uniforms.uOpacity.value = running
      ? 0.48 + heat * 0.22
      : 0.12;
    this.smoke.visible = dT > 1;

    // Host SimBackend owns particle integrate; source only paints buffers.
    if (this._hostParticlesOwned) {
      this._writeBuffers(heat, tAir, tPlate, running);
      return;
    }

    if (!running) {
      // Still refresh colors slowly when paused
      this._writeBuffers(heat, tAir, tPlate, false);
      return;
    }

    const { hx, hz } = this._plateHalf();
    // Buoyancy strength ~ sqrt(ΔT) (stays readable across range)
    const buoy = 1.35 * Math.sqrt(dT / 200);
    const coolRate = 0.55 + (1 - heat) * 0.35;
    const heatRate = 2.8 + heat * 3.5;
    const drag = 1.6;
    const xMax = this.chamberW * 0.46;
    const zMax = this.chamberD * 0.42;
    const yMin = this.airBot;
    const yMax = this.airTop;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += h;

      // Distance to plate surface (horizontal ellipse)
      const nx = p.x / Math.max(hx * 1.05, 0.05);
      const nz = p.z / Math.max(hz * 1.05, 0.05);
      const rPlate2 = nx * nx + nz * nz;
      const abovePlate = rPlate2 < 1.35 && p.y < yMin + 0.55;
      const heightAbove = Math.max(0, p.y - this.plateY);

      // Thermal exchange
      if (abovePlate && heightAbove < 0.55) {
        const proximity = Math.exp(-rPlate2 * 1.8) * Math.exp(-heightAbove * 3.2);
        p.temp += (tPlate - p.temp) * heatRate * proximity * h;
      }
      // Ambient cooling + stronger cooling near ceiling / walls
      let cool = coolRate;
      if (p.y > yMax - 0.45) cool += 1.2;
      const wallDist = Math.min(xMax - Math.abs(p.x), zMax - Math.abs(p.z));
      if (wallDist < 0.22) cool += 0.9;
      p.temp += (tAir - p.temp) * cool * h;
      p.temp = THREE.MathUtils.clamp(p.temp, tAir - 5, tPlate + 10);

      const dTp = p.temp - tAir;
      const dens = dTp / Math.max(dT, 1); // 0 cool … 1 hot

      // Boussinesq lift
      p.vy += buoy * dens * h * 2.4;
      // Gravity bias for cool parcels (return flow)
      p.vy -= (0.35 + (1 - dens) * 1.1) * h;

      // Horizontal: plume core converges slightly near plate, fans at mid-height, returns at walls
      const midY = (yMin + yMax) * 0.5;
      const rise = THREE.MathUtils.clamp((p.y - yMin) / (yMax - yMin), 0, 1);

      // Entrainment / spreading of hot plume
      if (dens > 0.25 && rise < 0.7) {
        const spread = 0.15 + rise * 0.55;
        p.vx += p.x * spread * dens * h * 0.35;
        p.vz += p.z * spread * dens * h * 0.35;
      }

      // Wall return: cool fluid sinks and is pushed inward near floor
      if (dens < 0.35) {
        const sidePull = Math.sign(p.x || 1) * (0.4 + rise * 0.3);
        // Near walls, prefer downward + along wall
        if (Math.abs(p.x) > hx * 0.9) {
          p.vx += -Math.sign(p.x) * (0.15 + (1 - dens)) * h * 0.8;
          p.vy -= 0.6 * h;
        }
        if (rise < 0.25) {
          // floor jet back toward plate
          p.vx += -p.x * 1.4 * h;
          p.vz += -p.z * 1.1 * h;
        } else {
          p.vx += sidePull * (1 - dens) * h * 0.15;
        }
      }

      // Soft large-scale rolls (two cells) without locking to rails
      const roll = Math.sin(p.x * 1.4) * Math.cos(p.y * 0.9 + t * 0.2);
      p.vx += roll * 0.25 * heat * h;
      p.vy += Math.cos(p.x * 1.4) * 0.12 * heat * h;

      // Turbulent swirl (curl-ish noise)
      const n1 = this._noise(p.x * 2.2, p.y * 1.8, p.z * 2.0, t);
      const n2 = this._noise(p.x * 1.5 + 10, p.y * 2.4, p.z * 1.7 + 4, t * 1.1);
      const n3 = this._noise(p.z * 2.0, p.x * 1.9, p.y * 2.1, t * 0.9);
      const turb = 0.35 + heat * 0.55;
      p.vx += n1 * turb * h;
      p.vy += n2 * turb * 0.55 * h;
      p.vz += n3 * turb * h;

      // Drag
      const damp = Math.exp(-drag * h);
      p.vx *= damp;
      p.vy *= damp;
      p.vz *= damp;

      // Clamp speeds
      const maxSp = 1.1 + buoy * 0.9;
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp > maxSp) {
        const s = maxSp / sp;
        p.vx *= s;
        p.vy *= s;
        p.vz *= s;
      }

      p.x += p.vx * h;
      p.y += p.vy * h;
      p.z += p.vz * h;

      // Soft walls
      if (p.x > xMax) {
        p.x = xMax;
        p.vx *= -0.35;
      } else if (p.x < -xMax) {
        p.x = -xMax;
        p.vx *= -0.35;
      }
      if (p.z > zMax) {
        p.z = zMax;
        p.vz *= -0.35;
      } else if (p.z < -zMax) {
        p.z = -zMax;
        p.vz *= -0.35;
      }
      if (p.y > yMax) {
        p.y = yMax;
        p.vy *= -0.2;
        p.temp = tAir + (p.temp - tAir) * 0.5;
      } else if (p.y < yMin) {
        p.y = yMin + 0.01;
        p.vy = Math.abs(p.vy) * 0.3;
      }

      // Lifetime: recycle so the plume stays fed
      p.life -= h * (0.08 + (1 - dens) * 0.04);
      if (p.life <= 0 || p.age > 18) {
        this._spawnParticle(p, dens > 0.4 ? 'nearPlate' : Math.random() < 0.4 ? 'wall' : 'mixed');
      }
    }

    this._writeBuffers(heat, tAir, tPlate, true);
  }

  _writeBuffers(heat, tAir, tPlate, _live) {
    const dT = Math.max(tPlate - tAir, 1);
    const pos = this.positions;
    const col = this.colors;
    const sizes = this.sizes;

    // Cool cyan vs warm amber — saturated enough to read, not neon-blown
    this._cCool.setRGB(0.22, 0.48, 0.85);
    this._cHot.setRGB(0.95, 0.4, 0.1);
    this._c.setRGB(1.0, 0.78, 0.4);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const i3 = i * 3;
      pos[i3] = p.x;
      pos[i3 + 1] = p.y;
      pos[i3 + 2] = p.z;

      const u = THREE.MathUtils.clamp((p.temp - tAir) / dT, 0, 1);
      if (u < 0.5) {
        const v = u / 0.5;
        col[i3] = this._cCool.r + (this._cHot.r - this._cCool.r) * v;
        col[i3 + 1] = this._cCool.g + (this._cHot.g - this._cCool.g) * v;
        col[i3 + 2] = this._cCool.b + (this._cHot.b - this._cCool.b) * v;
      } else {
        const v = (u - 0.5) / 0.5;
        col[i3] = this._cHot.r + (this._c.r - this._cHot.r) * v;
        col[i3 + 1] = this._cHot.g + (this._c.g - this._cHot.g) * v;
        col[i3 + 2] = this._cHot.b + (this._c.b - this._cHot.b) * v;
      }
      const dim = 0.38 + u * 0.55;
      const gain = 0.72 + heat * 0.28;
      col[i3] *= dim * gain;
      col[i3 + 1] *= dim * gain;
      col[i3 + 2] *= dim * gain;

      sizes[i] = p.size * (0.85 + u * 0.55 + heat * 0.2);
    }

    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.color.needsUpdate = true;
    this.smoke.geometry.attributes.size.needsUpdate = true;
    this.smoke.material.uniforms.uScale.value = 300 + heat * 80;
  }

  getReadouts() {
    const dT = this._deltaT();
    const h = this._h();
    const Q = h * this.params.area * dT;
    const Ra = this._ra();
    const Nu = this._nu();
    return {
      deltaT: dT.toFixed(0),
      h: h.toFixed(1),
      q: Q.toFixed(1),
      ra: Ra >= 1e6 ? (Ra / 1e6).toFixed(2) + 'e6' : Ra.toFixed(0),
      nu: Nu.toFixed(1),
    };
  }
}
