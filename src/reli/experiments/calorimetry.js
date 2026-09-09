import * as THREE from 'three';
import { Experiment } from './base.js';
import { chrome, darkMetal, metal, tempToColor } from '../lab/materials.js';
import { makeLabBench } from '../lab/primitives.js';

const C_WATER = 4180;
const POUR_RADIUS = 1.0;

/**
 * Mixing calorimeter — drag beakers onto the cup to pour.
 */
export class CalorimetryExperiment extends Experiment {
  get meta() {
    return {
      id: 'calorimetry',
      name: '混合量热',
      tag: 'CALORIMETER · mcΔT',
      title: '混合量热实验台',
      description:
        '拖动烧杯到量热杯旁松开倒入。两侧都倒入后温度弛豫到平衡。左键拖动 · 松开倒入。',
      formula: 'Q = cmΔt；热平衡时 Q放 = Q吸',
    };
  }

  get controlDefs() {
    return [
      { key: 'tHot', label: '热水初温', min: 40, max: 95, step: 1, unit: '°C' },
      { key: 'tCold', label: '冷水初温', min: 5, max: 40, step: 1, unit: '°C' },
      { key: 'mHot', label: '热水质量', min: 50, max: 400, step: 10, unit: 'g' },
      { key: 'mCold', label: '冷水质量', min: 50, max: 400, step: 10, unit: 'g' },
    ];
  }

  get readoutDefs() {
    return [
      { key: 'tNow', label: '杯内温度', unit: '°C', tone: 'warm' },
      { key: 'tEq', label: '理论平衡温', unit: '°C', tone: 'ok' },
      { key: 'qTransfer', label: '已传热 Q', unit: 'kJ', tone: 'hot' },
      { key: 'progress', label: '混合进度', unit: '%', tone: 'cool' },
      { key: 'hint', label: '操作提示', unit: '', tone: 'cool' },
    ];
  }

  setup() {
    super.setup();
    this.params = { tHot: 80, tCold: 20, mHot: 200, mCold: 200 };
    this._c = new THREE.Color();

    this.cup = { hasCold: false, hasHot: false, mCold: 0, mHot: 0 };
    this.beakerFill = { hot: 1, cold: 1 };
    this.mixProgress = 0;
    this.tCurrent = null;
    this.pour = null; // phased pour state
    this.drag = null;

    this.camera.position.set(4.0, 3.1, 5.4);
    this.controls.target.set(0, 1.45, 0);

    const bench = makeLabBench(6.0, 2.9, 0.88);
    this.scene.add(bench);
    this.benchY = bench.userData.topY;

    this.rig = new THREE.Group();
    this.rig.position.y = this.benchY;
    this.scene.add(this.rig);

    const steel = metal(0x8b95a5, { roughness: 0.36 });
    const steelDark = darkMetal(0x2a3140);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.02, 0.08, 40), steelDark);
    base.position.y = 0.04;
    base.receiveShadow = true;
    base.castShadow = true;
    this.rig.add(base);

    // Glass calorimeter
    this.outerR = 0.52;
    this.innerR = 0.42;
    this.outerH = 1.15;
    this.innerH = 1.0;
    this.innerBottom = 0.28;
    const glassY0 = 0.18;

    const glassWall = () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xc5dff0,
        transparent: true,
        opacity: 0.35,
        clearcoat: 0.9,
        clearcoatRoughness: 0.1,
        roughness: 0.08,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

    this.cupOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(this.outerR, this.outerR * 1.02, this.outerH, 48, 1, true),
      glassWall()
    );
    this.cupOuter.position.y = glassY0 + this.outerH / 2;
    this.rig.add(this.cupOuter);

    const cupInner = new THREE.Mesh(
      new THREE.CylinderGeometry(this.innerR, this.innerR, this.innerH, 48, 1, true),
      glassWall()
    );
    cupInner.position.y = this.innerBottom + this.innerH / 2;
    this.rig.add(cupInner);

    const glassFloor = new THREE.Mesh(
      new THREE.CircleGeometry(this.innerR - 0.01, 40),
      new THREE.MeshPhysicalMaterial({
        color: 0xa8c8e0,
        transparent: true,
        opacity: 0.45,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
        roughness: 0.12,
        side: THREE.DoubleSide,
      })
    );
    glassFloor.rotation.x = -Math.PI / 2;
    glassFloor.position.y = this.innerBottom + 0.005;
    this.rig.add(glassFloor);

    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(this.outerR + 0.04, this.outerR + 0.08, 0.06, 40),
      steel
    );
    foot.position.y = glassY0 - 0.02;
    foot.castShadow = true;
    this.rig.add(foot);

    // Open mouth — thin metal lip only, no lid
    const rimY = glassY0 + this.outerH;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(this.outerR + 0.01, 0.018, 10, 48),
      chrome(0xc5ced8)
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = rimY;
    this.rig.add(rim);

    // Water body (open-ended — top face would z-fight with surface disc)
    this.water = new THREE.Mesh(
      new THREE.CylinderGeometry(this.innerR - 0.03, this.innerR - 0.03, 1, 40, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        emissive: 0x1e3a8a,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
        roughness: 0.2,
        depthWrite: false,
      })
    );
    this.water.visible = false;
    this.water.renderOrder = 1;
    this.rig.add(this.water);

    // Free surface sits slightly above the open water column (no coplanar flicker)
    this.surface = new THREE.Mesh(
      new THREE.CircleGeometry(this.innerR - 0.032, 40),
      new THREE.MeshStandardMaterial({
        color: 0x60a5fa,
        emissive: 0x1d4ed8,
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 0.92,
        roughness: 0.18,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.visible = false;
    this.surface.renderOrder = 2;
    this.rig.add(this.surface);

    // Thermometer hanging into open cup (no lid port)
    this.thermo = new THREE.Group();
    this.thermo.position.set(-0.12, rimY + 0.08, 0.08);
    this.rig.add(this.thermo);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.95, 12),
      new THREE.MeshPhysicalMaterial({
        color: 0xdce8f5,
        transparent: true,
        opacity: 0.55,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
        roughness: 0.1,
      })
    );
    stem.position.y = -0.4;
    this.thermo.add(stem);
    this.mercury = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.48, 10),
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 0.55,
      })
    );
    this.mercury.position.y = -0.52;
    this.thermo.add(this.mercury);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        emissive: 0xdc2626,
        emissiveIntensity: 0.5,
      })
    );
    bulb.position.y = -0.78;
    this.thermo.add(bulb);

    // Stirrer in open cup
    this.stirrer = new THREE.Group();
    this.stirrer.position.set(0.14, this.innerBottom + 0.1, -0.06);
    this.rig.add(this.stirrer);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 10), chrome());
    rod.position.y = 0.48;
    this.stirrer.add(rod);
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.028, 0.035), metal(0x6b7588));
    paddle.position.y = 0.05;
    this.stirrer.add(paddle);

    // Beakers
    this.hotHome = new THREE.Vector3(-1.95, 0, 0.12);
    this.coldHome = new THREE.Vector3(1.95, 0, 0.12);
    this.hotBeaker = this._makeBeaker(0xf59e0b, 'hot');
    this.hotBeaker.position.copy(this.hotHome);
    this.rig.add(this.hotBeaker);
    this.coldBeaker = this._makeBeaker(0x3b82f6, 'cold');
    this.coldBeaker.position.copy(this.coldHome);
    this.rig.add(this.coldBeaker);

    // Stream ribbon (continuous tube feel via chained spheres)
    this.stream = [];
    const pGeo = new THREE.SphereGeometry(0.028, 8, 8);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(
        pGeo,
        new THREE.MeshStandardMaterial({
          color: 0x60a5fa,
          emissive: 0x2563eb,
          emissiveIntensity: 0.4,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      m.visible = false;
      this.rig.add(m);
      this.stream.push(m);
    }

    // Pour poses: stand clear of Dewar (outerR≈0.52, beakerR≈0.28),
    // lift above bench, tilt so rim sits just outside the cup mouth.
    // rotZ: left→center = negative; right→center = positive.
    // Rim local height ≈ 0.82 (base + wall).
    this._beakerRimLocalY = 0.82;
    this._pourPose = {
      hot: { x: -1.18, y: 0.92, z: 0.12, rotZ: -0.95 },
      cold: { x: 1.18, y: 0.92, z: 0.12, rotZ: 0.95 },
    };
    // Cup mouth (open top center) for stream target
    this._cupMouth = new THREE.Vector3(0, rimY, 0);

    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._hitPoint = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    this._onPointerDown = (e) => this._pointerDown(e);
    this._onPointerMove = (e) => this._pointerMove(e);
    this._onPointerUp = (e) => this._pointerUp(e);
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    this.canvas.style.touchAction = 'none';

    this._syncVisuals();
  }

  _makeBeaker(tint, kind) {
    const g = new THREE.Group();
    g.userData.pick = kind;
    g.userData.kind = kind;

    const rTop = 0.28;
    const rBot = 0.25;
    const h = 0.7;

    // Closed glass shell: wall + bottom so empty cup still readable
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, 32, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xd0e6f5,
        transparent: true,
        opacity: 0.35,
        clearcoat: 0.9,
        clearcoatRoughness: 0.1,
        roughness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    wall.position.y = 0.12 + h / 2;
    g.add(wall);
    g.userData.wall = wall;

    const bottom = new THREE.Mesh(
      new THREE.CylinderGeometry(rBot - 0.01, rBot, 0.04, 28),
      new THREE.MeshPhysicalMaterial({
        color: 0xb0cce0,
        transparent: true,
        opacity: 0.45,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
        roughness: 0.15,
      })
    );
    bottom.position.y = 0.14;
    g.add(bottom);

    // Visible rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(rTop + 0.005, 0.012, 8, 28),
      chrome(0xd0d8e0)
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.12 + h;
    g.add(rim);

    // Open-ended liquid column — top face would z-fight with surface disc
    const liquid = new THREE.Mesh(
      new THREE.CylinderGeometry(rBot - 0.035, rBot - 0.04, 0.4, 28, 1, true),
      new THREE.MeshStandardMaterial({
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.82,
        roughness: 0.2,
        depthWrite: false,
      })
    );
    liquid.position.y = 0.34;
    liquid.renderOrder = 1;
    g.add(liquid);
    g.userData.liquid = liquid;
    g.userData.tint = tint;
    g.userData.liqBaseY = 0.14; // bottom of liquid column
    g.userData.liqMaxH = 0.4;

    const surf = new THREE.Mesh(
      new THREE.CircleGeometry(rBot - 0.04, 28),
      new THREE.MeshStandardMaterial({
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 0.92,
        roughness: 0.18,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 0.54;
    surf.renderOrder = 2;
    g.add(surf);
    g.userData.surf = surf;

    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.32, 0.05, 24),
      darkMetal()
    );
    stand.position.y = 0.03;
    stand.castShadow = true;
    g.add(stand);

    // Pick volume
    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop + 0.05, rBot + 0.05, h + 0.15, 16),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.y = 0.12 + h / 2;
    hit.userData.pick = kind;
    g.add(hit);

    // Hover halo (horizontal disc under beaker — never looks like a wireframe box)
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.38, 32),
      new THREE.MeshBasicMaterial({
        color: 0x00d4aa,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.02;
    g.add(halo);
    g.userData.halo = halo;

    return g;
  }

  _setPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pickBeaker(e) {
    this._setPointer(e);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObjects([this.hotBeaker, this.coldBeaker], true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData?.pick !== 'hot' && o.userData?.pick !== 'cold') {
        o = o.parent;
      }
      if (!o) continue;
      return o.userData.pick === 'hot' ? this.hotBeaker : this.coldBeaker;
    }
    return null;
  }

  _busy() {
    return !!this.pour || !!this.drag;
  }

  _pointerDown(e) {
    if (this._disposed || this.pour) return;
    if (e.button !== 0) return;

    const beaker = this._pickBeaker(e);
    if (!beaker) return;
    const kind = beaker.userData.kind;
    if (this.beakerFill[kind] <= 0.02) return;
    if (kind === 'hot' && this.cup.hasHot) return;
    if (kind === 'cold' && this.cup.hasCold) return;

    e.preventDefault();
    this.controls.enabled = false;

    const lift = 0.18;
    const worldY = this.benchY + lift;
    this._dragPlane.set(new THREE.Vector3(0, 1, 0), -worldY);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    if (!this._raycaster.ray.intersectPlane(this._dragPlane, this._hitPoint)) return;

    const localHit = this.rig.worldToLocal(this._hitPoint.clone());
    this._offset.set(beaker.position.x - localHit.x, 0, beaker.position.z - localHit.z);

    beaker.position.y = lift;
    beaker.rotation.set(0, 0, 0);
    beaker.userData.halo.material.opacity = 0.45;

    this.drag = { beaker, kind, lift };
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
  }

  _pointerMove(e) {
    if (this._disposed) return;
    this._setPointer(e);

    if (this.drag) {
      const { beaker, lift } = this.drag;
      const worldY = this.benchY + lift;
      this._dragPlane.set(new THREE.Vector3(0, 1, 0), -worldY);
      this._raycaster.setFromCamera(this._pointer, this.camera);
      if (this._raycaster.ray.intersectPlane(this._dragPlane, this._hitPoint)) {
        const local = this.rig.worldToLocal(this._hitPoint.clone());
        beaker.position.x = THREE.MathUtils.clamp(local.x + this._offset.x, -2.6, 2.6);
        beaker.position.z = THREE.MathUtils.clamp(local.z + this._offset.z, -1.15, 1.15);
        beaker.position.y = lift;
        // Keep upright while dragging — tilt only during pour animation
        beaker.rotation.set(0, 0, 0);

        const near = this._nearCup(beaker);
        beaker.userData.halo.material.opacity = near ? 0.9 : 0.4;
        beaker.userData.halo.material.color.setHex(near ? 0x34d399 : 0x00d4aa);
        this.canvas.style.cursor = near ? 'copy' : 'grabbing';
      }
      return;
    }

    if (this.pour) {
      this.canvas.style.cursor = 'wait';
      return;
    }

    this.hotBeaker.userData.halo.material.opacity = 0;
    this.coldBeaker.userData.halo.material.opacity = 0;
    const beaker = this._pickBeaker(e);
    if (beaker && this.beakerFill[beaker.userData.kind] > 0.02) {
      const kind = beaker.userData.kind;
      const already = kind === 'hot' ? this.cup.hasHot : this.cup.hasCold;
      if (!already) {
        beaker.userData.halo.material.opacity = 0.5;
        beaker.userData.halo.material.color.setHex(0x00d4aa);
        this.canvas.style.cursor = 'grab';
        return;
      }
    }
    this.canvas.style.cursor = 'default';
  }

  _pointerUp(e) {
    if (this._disposed) return;
    if (!this.drag) {
      if (!this.pour) this.controls.enabled = true;
      return;
    }

    const { beaker, kind } = this.drag;
    this.drag = null;
    try {
      this.canvas.releasePointerCapture?.(e.pointerId);
    } catch (_) {
      /* ignore */
    }

    if (this.beakerFill[kind] > 0.02 && this._nearCup(beaker)) {
      this._beginPour(kind, beaker);
    } else {
      this._snapHome(beaker);
      this.controls.enabled = true;
      this.canvas.style.cursor = 'default';
    }
  }

  _nearCup(beaker) {
    // Near the calorimeter column, but not required to overlap it
    const r = Math.hypot(beaker.position.x, beaker.position.z);
    return r < POUR_RADIUS + 0.35 && r > 0.45;
  }

  /** World-ish lip position of a tilted beaker (rig-local) */
  _beakerLip(beaker) {
    const ry = this._beakerRimLocalY ?? 0.82;
    const rz = beaker.rotation.z;
    // rotation around Z applied to local rim (0, ry, 0)
    const lipX = beaker.position.x - ry * Math.sin(rz);
    const lipY = beaker.position.y + ry * Math.cos(rz);
    const lipZ = beaker.position.z;
    return { x: lipX, y: lipY, z: lipZ };
  }

  _homeOf(kind) {
    return kind === 'hot' ? this.hotHome : this.coldHome;
  }

  _snapHome(beaker) {
    const home = this._homeOf(beaker.userData.kind);
    beaker.position.copy(home);
    beaker.rotation.set(0, 0, 0);
    beaker.userData.halo.material.opacity = 0;
  }

  _beginPour(kind, beaker) {
    if (kind === 'hot' && this.cup.hasHot) {
      this._snapHome(beaker);
      this.controls.enabled = true;
      return;
    }
    if (kind === 'cold' && this.cup.hasCold) {
      this._snapHome(beaker);
      this.controls.enabled = true;
      return;
    }

    const pose = this._pourPose[kind];
    const tint = kind === 'hot' ? 0xf59e0b : 0x3b82f6;
    for (const m of this.stream) {
      m.material.color.setHex(tint);
      m.material.emissive.setHex(tint);
      m.visible = false;
      m.material.opacity = 0;
    }

    beaker.userData.halo.material.opacity = 0;
    this.controls.enabled = false;
    this.canvas.style.cursor = 'wait';

    // Phased: approach → tilt+stream → upright → return
    this.pour = {
      kind,
      beaker,
      phase: 'approach',
      t: 0,
      // capture start pose for lerp
      fromPos: beaker.position.clone(),
      fromRotZ: beaker.rotation.z,
      toPos: new THREE.Vector3(pose.x, pose.y, pose.z),
      toRotZ: pose.rotZ,
      fillStart: this.beakerFill[kind],
    };
  }

  _commitPour(kind) {
    if (kind === 'hot') {
      this.cup.hasHot = true;
      this.cup.mHot = this.params.mHot;
      this.beakerFill.hot = 0;
    } else {
      this.cup.hasCold = true;
      this.cup.mCold = this.params.mCold;
      this.beakerFill.cold = 0;
    }

    if (this.cup.hasHot && this.cup.hasCold) {
      this.tCurrent = this.params.tCold;
      this.mixProgress = 0;
    } else if (this.cup.hasHot) {
      this.tCurrent = this.params.tHot;
      this.mixProgress = 0;
    } else {
      this.tCurrent = this.params.tCold;
      this.mixProgress = 0;
    }
  }

  _endPour() {
    const { beaker } = this.pour;
    this._snapHome(beaker);
    for (const m of this.stream) {
      m.visible = false;
      m.material.opacity = 0;
    }
    this.pour = null;
    this.controls.enabled = true;
    this.canvas.style.cursor = 'default';
    this._syncVisuals();
  }

  _updatePour(dt) {
    const p = this.pour;
    if (!p) return;
    const { beaker, kind } = p;
    p.t += dt;

    const ease = (x) => 1 - (1 - x) * (1 - x); // ease-out quad

    if (p.phase === 'approach') {
      // 0.35s move to pour pose, slight pre-tilt
      const u = Math.min(1, p.t / 0.35);
      const e = ease(u);
      beaker.position.lerpVectors(p.fromPos, p.toPos, e);
      beaker.rotation.z = THREE.MathUtils.lerp(p.fromRotZ, p.toRotZ * 0.35, e);
      if (u >= 1) {
        p.phase = 'pouring';
        p.t = 0;
        p.fromPos.copy(beaker.position);
        p.fromRotZ = beaker.rotation.z;
      }
      return;
    }

    if (p.phase === 'pouring') {
      // 0.9s full tilt + empty
      const u = Math.min(1, p.t / 0.9);
      const e = ease(Math.min(1, u * 1.2));
      beaker.position.copy(p.toPos);
      beaker.rotation.z = THREE.MathUtils.lerp(p.fromRotZ, p.toRotZ, Math.min(1, e));
      this.beakerFill[kind] = p.fillStart * (1 - u);

      // Stream: geometric lip → cup mouth (gentle arc into open top)
      const lip = this._beakerLip(beaker);
      const mouth = this._cupMouth;
      for (let i = 0; i < this.stream.length; i++) {
        const m = this.stream[i];
        const along = (i + 0.5) / this.stream.length;
        const flow = (u * 1.4 - along * 0.35 + p.t * 0.8) % 1.15;
        if (flow < 0 || flow > 1 || u < 0.08 || u > 0.95) {
          m.visible = false;
          continue;
        }
        m.visible = true;
        const t = flow;
        // Arc dips slightly then into mouth
        const drop = 0.22 * Math.sin(t * Math.PI);
        m.position.set(
          THREE.MathUtils.lerp(lip.x, mouth.x, t),
          THREE.MathUtils.lerp(lip.y, mouth.y, t) - drop,
          THREE.MathUtils.lerp(lip.z, mouth.z, t)
        );
        m.scale.setScalar(0.75 + (1 - t) * 0.45);
        m.material.opacity = 0.85 * (1 - t) * Math.min(1, u * 3);
      }

      const grams = kind === 'hot' ? this.params.mHot : this.params.mCold;
      this._setBeakerLevel(
        beaker,
        this.beakerFill[kind] * this._massFrac(grams),
        kind === 'hot' ? this.params.tHot : this.params.tCold
      );
      this._previewCupWater(kind, u);

      if (u >= 1) {
        this.beakerFill[kind] = 0;
        this._commitPour(kind);
        p.phase = 'return';
        p.t = 0;
        p.fromPos.copy(beaker.position);
        p.fromRotZ = beaker.rotation.z;
        for (const m of this.stream) {
          m.visible = false;
          m.material.opacity = 0;
        }
      }
      return;
    }

    if (p.phase === 'return') {
      // 0.4s upright + fly home
      const u = Math.min(1, p.t / 0.4);
      const e = ease(u);
      const home = this._homeOf(kind);
      beaker.position.lerpVectors(p.fromPos, home, e);
      beaker.rotation.z = THREE.MathUtils.lerp(p.fromRotZ, 0, Math.min(1, e * 1.5));
      if (u >= 1) this._endPour();
    }
  }

  _previewCupWater(kind, u) {
    let coldM = this.cup.hasCold ? this.cup.mCold : 0;
    let hotM = this.cup.hasHot ? this.cup.mHot : 0;
    if (kind === 'cold') coldM = this.params.mCold * u;
    if (kind === 'hot') hotM = this.params.mHot * u;

    const mass = (coldM + hotM) / 1000;
    if (mass < 0.01) return;

    let tPrev;
    if (coldM > 0 && hotM > 0) {
      tPrev = (coldM * this.params.tCold + hotM * this.params.tHot) / (coldM + hotM);
    } else if (hotM > 0) {
      tPrev = this.params.tHot;
    } else {
      tPrev = this.params.tCold;
    }
    this._layoutWater(mass, tPrev);
  }

  /** Place water column + free surface without coplanar z-fight */
  _layoutWater(massKg, tempC) {
    this.water.visible = true;
    this.surface.visible = true;
    // 50 g → low, 800 g total → nearly full
    const h = THREE.MathUtils.clamp(0.12 + massKg * 0.95, 0.14, 0.92);
    this.water.scale.y = h;
    this.water.position.y = this.innerBottom + h / 2;
    // Free surface slightly above open column top
    this.surface.position.y = this.innerBottom + h + 0.008;

    const col = tempToColor(tempC + 273, 275, 370, this._c);
    this.water.material.color.copy(col);
    this.water.material.emissive.copy(col).multiplyScalar(0.28);
    this.surface.material.color.copy(col);
    this.surface.material.emissive.copy(col).multiplyScalar(0.16);
  }

  _tEq() {
    if (!this.cup.hasHot || !this.cup.hasCold) return null;
    const mh = this.cup.mHot / 1000;
    const mc = this.cup.mCold / 1000;
    return (mh * this.params.tHot + mc * this.params.tCold) / (mh + mc);
  }

  _cupMassKg() {
    return (this.cup.mHot + this.cup.mCold) / 1000;
  }

  /** Map mass (g) → visual fill height factor (50–400 g → visible range) */
  _massFrac(grams) {
    return THREE.MathUtils.clamp(grams / 400, 0.14, 1);
  }

  _syncVisuals() {
    if (!this.pour) {
      this._setBeakerLevel(
        this.hotBeaker,
        this.beakerFill.hot * this._massFrac(this.params.mHot),
        this.params.tHot
      );
      this._setBeakerLevel(
        this.coldBeaker,
        this.beakerFill.cold * this._massFrac(this.params.mCold),
        this.params.tCold
      );
    }

    const mass = this._cupMassKg();
    if (mass <= 0.001 || this.tCurrent == null) {
      if (!this.pour) {
        this.water.visible = false;
        this.surface.visible = false;
      }
    } else {
      this._layoutWater(mass, this.tCurrent);
      const uu = THREE.MathUtils.clamp(this.tCurrent / 100, 0, 1);
      this.mercury.scale.y = 0.25 + uu * 0.9;
      this.mercury.position.y = -0.75 + this.mercury.scale.y * 0.28;
    }
  }

  _setBeakerLevel(beaker, level, tempC) {
    const liq = beaker.userData.liquid;
    const surf = beaker.userData.surf;
    const baseY = beaker.userData.liqBaseY ?? 0.14;
    const maxH = beaker.userData.liqMaxH ?? 0.4;
    // level already includes mass fraction × remaining pour fraction
    const s = THREE.MathUtils.clamp(level, 0, 1);
    liq.visible = s > 0.02;
    surf.visible = s > 0.02;
    if (s > 0.02) {
      const h = maxH * s;
      liq.scale.y = s;
      liq.position.y = baseY + h / 2;
      surf.position.y = baseY + h + 0.006;
      const col = tempToColor(tempC + 273, 275, 370, this._c);
      liq.material.color.copy(col);
      liq.material.emissive.copy(col).multiplyScalar(0.28);
      surf.material.color.copy(col);
      surf.material.emissive.copy(col).multiplyScalar(0.16);
    }
  }

  _hintText() {
    if (this.pour) return '倒水中…';
    if (this.drag) return this._nearCup(this.drag.beaker) ? '松开以倒入' : '拖到量热杯旁';
    if (!this.cup.hasCold && !this.cup.hasHot) return '拖动烧杯到量热杯旁松开倒入';
    if (this.cup.hasCold && !this.cup.hasHot) return '再拖入热水烧杯';
    if (this.cup.hasHot && !this.cup.hasCold) return '再拖入冷水烧杯';
    if (this.mixProgress < 0.98) return '混合弛豫中…';
    return '已平衡 · 点「复位台架」重做';
  }

  onParamChange() {
    // Not yet poured → beaker stays full (level follows mass slider)
    if (!this.cup.hasHot) this.beakerFill.hot = 1;
    else this.cup.mHot = this.params.mHot;

    if (!this.cup.hasCold) this.beakerFill.cold = 1;
    else this.cup.mCold = this.params.mCold;

    // Refresh equilibrium path if both liquids are already in the cup
    if (this.cup.hasHot && this.cup.hasCold) {
      this.mixProgress = 0;
      this.tCurrent = this.params.tCold;
    } else if (this.cup.hasHot) {
      this.tCurrent = this.params.tHot;
    } else if (this.cup.hasCold) {
      this.tCurrent = this.params.tCold;
    }
    this._syncVisuals();
  }

  reset() {
    super.reset();
    this.params.tHot = 80;
    this.params.tCold = 20;
    this.params.mHot = 200;
    this.params.mCold = 200;
    this.cup = { hasCold: false, hasHot: false, mCold: 0, mHot: 0 };
    this.beakerFill = { hot: 1, cold: 1 };
    this.mixProgress = 0;
    this.tCurrent = null;
    this.pour = null;
    this.drag = null;
    this.controls.enabled = true;
    this._snapHome(this.hotBeaker);
    this._snapHome(this.coldBeaker);
    for (const m of this.stream) {
      m.visible = false;
      m.material.opacity = 0;
    }
    this.canvas.style.cursor = 'default';
    this._syncVisuals();
  }

  update(dt) {
    super.update(dt);

    if (this.pour) {
      this._updatePour(dt);
      return;
    }

    const teq = this._tEq();
    if (teq != null && this.tCurrent != null) {
      // Larger |T_hot − T_cold| → stronger thermal driving / convection → faster mix.
      // Reference: ΔT = 60 °C → τ ≈ 2.8 s; clamp so extremes stay playable.
      const dT = Math.abs(this.params.tHot - this.params.tCold);
      const tau = THREE.MathUtils.clamp(2.8 * (60 / Math.max(dT, 8)), 1.1, 6.5);
      this.mixProgress = Math.min(1, this.mixProgress + dt / tau);
      const k = 1 - Math.exp(-this.mixProgress * 4);
      this.tCurrent = this.params.tCold + (teq - this.params.tCold) * k;
      // Stir a bit faster when driving force is large
      const stir = 3.2 + (dT / 60) * 2.5;
      this.stirrer.rotation.y += dt * stir * (this.mixProgress < 0.98 ? 1 : 0.12);
    }

    this._syncVisuals();
  }

  getReadouts() {
    const teq = this._tEq();
    let q = 0;
    if (teq != null && this.tCurrent != null) {
      const mh = this.cup.mHot / 1000;
      const qMax = mh * C_WATER * (this.params.tHot - teq);
      const k = Math.min(
        1,
        (this.tCurrent - this.params.tCold) / Math.max(0.01, teq - this.params.tCold)
      );
      q = (qMax * k) / 1000;
    }
    return {
      tNow: this.tCurrent == null ? '—' : this.tCurrent.toFixed(1),
      tEq: teq == null ? '—' : teq.toFixed(1),
      qTransfer: teq == null ? '—' : q.toFixed(2),
      progress: teq == null ? '0' : (Math.min(1, this.mixProgress) * 100).toFixed(0),
      hint: this._hintText(),
    };
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.style.cursor = '';
    this.canvas.style.touchAction = '';
    if (this.controls) this.controls.enabled = true;
    super.dispose();
  }
}
