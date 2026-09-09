import * as THREE from 'three';
import { liveSlider, liveSelect, setReadouts, setFormula } from '../core/ui.js';
import { formatNum } from '../core/engine.js';
import { Mats, makeLabSphere } from '../core/materials.js';
import {
  addSimpleGround,
  addCable,
} from '../core/labkit.js';

/**
 * Constant-density sphere radius (lab plastic ~ 180 kg/m³ hollow / foam ball look).
 * Clamped for visibility on the track.
 */
function radiusFromMass(m) {
  const rho = 180;
  const r = Math.cbrt((3 * m) / (4 * Math.PI * rho));
  return Math.min(0.38, Math.max(0.12, r));
}

/**
 * Exact 1D two-body collision (Newton restitution).
 * Momentum conserved; kinetic energy conserved iff e = 1.
 * Equal mass + e = 1 ⇒ velocity exchange (incident ball stops) — real physics.
 */
function collide1D(m1, m2, u1, u2, e) {
  const M = m1 + m2;
  const v1 = ((m1 - e * m2) * u1 + m2 * (1 + e) * u2) / M;
  const v2 = ((m2 - e * m1) * u2 + m1 * (1 + e) * u1) / M;
  return { v1, v2 };
}

/** Precision air-cushion track */
function buildAirTrack(engine, {
  length = 12.5,
  width = 0.72,
  height = 0.14,
  y = 0.55,
} = {}) {
  const g = new THREE.Group();
  const half = length / 2;

  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, width),
    new THREE.MeshPhysicalMaterial({
      color: 0x2a3548,
      metalness: 0.6,
      roughness: 0.32,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
    })
  );
  bed.castShadow = true;
  bed.receiveShadow = true;
  g.add(bed);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(length - 0.12, 0.02, width * 0.55),
    Mats.matteBlack()
  );
  deck.position.y = height / 2 + 0.01;
  deck.receiveShadow = true;
  g.add(deck);

  const holeMat = new THREE.MeshBasicMaterial({ color: 0x0a0e16 });
  for (let i = 0; i < 40; i++) {
    const x = -half + 0.5 + (i / 39) * (length - 1);
    for (const z of [-0.08, 0.08]) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 6), holeMat);
      hole.position.set(x, height / 2 + 0.018, z);
      g.add(hole);
    }
  }

  for (const z of [-width / 2 + 0.035, width / 2 - 0.035]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.07, 0.05),
      Mats.anodizedBlue()
    );
    rail.position.set(0, height / 2 + 0.035, z);
    rail.castShadow = true;
    g.add(rail);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.02, 0.08),
      Mats.brushedAluminum()
    );
    lip.position.set(0, height / 2 + 0.08, z);
    g.add(lip);
  }

  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(length - 0.2, 0.012, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 0.1, roughness: 0.55 })
  );
  tape.position.set(0, height / 2 + 0.008, width / 2 - 0.12);
  g.add(tape);

  for (let cm = 0; cm <= Math.floor(length * 10); cm++) {
    const isMajor = cm % 10 === 0;
    const isMid = cm % 5 === 0;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.006, isMajor ? 0.045 : isMid ? 0.03 : 0.018),
      isMajor ? Mats.warningYellow() : Mats.matteBlack()
    );
    tick.position.set(-half + 0.15 + cm * 0.1, height / 2 + 0.016, width / 2 - 0.12);
    g.add(tick);
  }

  for (const lx of [-half + 1.2, 0, half - 1.2]) {
    const pedestal = new THREE.Group();
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, y - height / 2, 0.14),
      Mats.darkMetal()
    );
    column.position.y = -(y - height / 2) / 2 - height / 2;
    column.castShadow = true;
    pedestal.add(column);
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.18, 0.05, 20),
      Mats.matteBlack()
    );
    foot.position.y = -y + 0.025;
    pedestal.add(foot);
    pedestal.position.x = lx;
    g.add(pedestal);
  }

  for (const x of [-half, half]) {
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, height + 0.12, width + 0.08),
      Mats.darkMetal()
    );
    cap.position.set(x, 0.02, 0);
    g.add(cap);
  }

  g.position.set(0, y, 0);
  engine.addStaticMesh(g);
  return {
    group: g,
    length,
    width,
    height,
    y,
    surfaceY: y + height / 2 + 0.02,
    half,
  };
}

function makeArrow(engine, color) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 1, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = 0.5;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.2, 14),
    new THREE.MeshBasicMaterial({ color })
  );
  head.rotation.z = -Math.PI / 2;
  head.position.x = 1.1;
  group.add(shaft, head);
  group.visible = false;
  engine.addHelper(group);
  return group;
}

function makeImpactFX(engine) {
  const group = new THREE.Group();
  group.visible = false;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.28, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    })
  );
  ring.rotation.y = Math.PI / 2;
  group.add(ring);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
  );
  group.add(core);
  engine.addHelper(group);

  let t = 0;
  let active = false;

  function trigger(x, y, z) {
    group.position.set(x, y, z);
    group.visible = true;
    t = 0;
    active = true;
    ring.scale.setScalar(0.3);
    core.scale.setScalar(1);
  }

  function update(dt) {
    if (!active) return;
    t += dt;
    const u = Math.min(t / 0.4, 1);
    ring.scale.setScalar(0.3 + u * 2);
    ring.material.opacity = 0.9 * (1 - u);
    core.scale.setScalar(1 - u * 0.9);
    core.material.opacity = 0.95 * (1 - u);
    if (u >= 1) {
      active = false;
      group.visible = false;
    }
  }

  return { trigger, update };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * World-space velocity badge above each ball.
 * Lives in the source content graph so host scale/position apply correctly
 * (DOM tags were hidden by the host and projected with local coords).
 */
function makeVelocityLabel(engine, { color = '#8eb6ff', label = 'v' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 140;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  // Host scales the rig ~0.26 — keep local size large enough to read on the desk.
  sprite.scale.set(2.6, 0.72, 1);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 20;
  engine.addHelper(sprite);

  let lastText = '';

  function paint(text) {
    if (text === lastText) return;
    lastText = text;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 44px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 40;
    const tw = Math.min(canvas.width - 24, ctx.measureText(text).width + padX);
    const x = (canvas.width - tw) / 2;
    const y = 30;
    const h = 78;
    roundRectPath(ctx, x, y, tw, h, 16);
    ctx.fillStyle = 'rgba(6, 12, 26, 0.9)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    // soft top highlight
    roundRectPath(ctx, x + 2, y + 2, tw - 4, h * 0.45, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, y + h / 2 + 1);
    tex.needsUpdate = true;
  }

  function update(x, y, z, vx) {
    sprite.position.set(x, y, z);
    const arrow = Math.abs(vx) < 0.03 ? '·' : vx > 0 ? '→' : '←';
    paint(`${label} ${arrow} ${formatNum(vx, 2)} m/s`);
  }

  function dispose() {
    tex.dispose();
    mat.dispose();
  }

  paint(`${label} · 0.00 m/s`);
  return { sprite, update, dispose };
}

export const collision = {
  id: 'collision',
  name: '碰撞与动能',
  meta: '气垫导轨 · 一维对心碰撞',
  description:
    '气垫导轨上一维对心碰撞（低摩擦）。动量守恒；e=1 时动能也守恒。默认入射球比靶球重，碰撞后两球都继续前进；若调成等质量且 e=1，才会出现速度交换（入射球瞬时停下）。',

  setup(engine, ui, overrides = {}) {
    const params = {
      // m1 > m2：完全弹性时入射球碰撞后仍向前，不会“撞一下就停”
      m1: 3,
      m2: 1.5,
      v1: 3.5,
      e: 1,
      mode: 'elastic',
      ...overrides,
    };

    // Horizontal 1D model: no gravity (air track supports weight; motion is free in x)
    engine.world.gravity.set(0, 0, 0);
    const { surfaceY } = addSimpleGround(engine, { size: 32, color: 0x0e1524 });

    const track = buildAirTrack(engine, {
      length: 12.5,
      width: 0.72,
      height: 0.14,
      y: surfaceY + 0.58,
    });

    const r1 = radiusFromMass(params.m1);
    const r2 = radiusFromMass(params.m2);
    // Each ball rests on the deck: center height = surface + own radius
    const y1 = track.surfaceY + r1;
    const y2 = track.surfaceY + r2;

    engine.setCamera([0.5, 3.6, 7.5], [0, track.surfaceY + 0.25, 0]);

    // —— Blower ——
    const blower = new THREE.Group();
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.55, 0.65),
      Mats.labPlastic(0x242b3a)
    );
    housing.position.set(-6.4, track.y - 0.05, 0.95);
    housing.castShadow = true;
    blower.add(housing);
    const duct = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.55, 16),
      Mats.darkMetal()
    );
    duct.rotation.z = Math.PI / 2;
    duct.rotation.y = -0.25;
    duct.position.set(-5.95, track.y + 0.02, 0.55);
    blower.add(duct);
    const fanLed = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.04), Mats.led(0x3ee0b0));
    fanLed.position.set(-6.4, track.y + 0.2, 1.28);
    blower.add(fanLed);
    engine.addStaticMesh(blower);

    addCable(
      engine,
      [
        [-5.95, track.y + 0.02, 0.45],
        [-5.5, track.y - 0.15, 0.2],
        [-5.0, track.y - 0.12, 0],
        [-4.5, track.y - 0.05, 0],
      ],
      0x2a303c
    );

    // —— Right damper ——
    {
      const x = 5.95;
      const stop = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.75), Mats.darkMetal());
      post.position.set(x, track.surfaceY + 0.2, 0);
      post.castShadow = true;
      stop.add(post);
      const foam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.58), Mats.rubber(0x3a2828));
      foam.position.set(x - 0.1, track.surfaceY + 0.2, 0);
      stop.add(foam);
      engine.addStaticMesh(stop);
    }

    // —— Launcher ——
    const muzzleX = -5.35;
    const wallL = muzzleX;
    const wallR = 5.82;
    // Soft foam bumper: low restitution (realistic end-stop)
    const wallRest = 0.18;
    // Tiny air-track drag (not perfect vacuum)
    const drag = 0.02;

    const launcher = new THREE.Group();
    const launchHouse = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.48, 0.58),
      Mats.labPlastic(0x222a3a)
    );
    launchHouse.position.set(muzzleX - 0.45, y1, 0);
    launchHouse.castShadow = true;
    launcher.add(launchHouse);

    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.022, 10, 28),
        i % 2 === 0 ? Mats.anodizedOrange() : Mats.darkMetal()
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.set(muzzleX - 0.22 - i * 0.06, y1, 0);
      launcher.add(ring);
    }

    const barrelLen = 0.48;
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, barrelLen, 24),
      Mats.matteBlack()
    );
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(muzzleX - barrelLen / 2 - 0.02, y1, 0);
    barrel.castShadow = true;
    launcher.add(barrel);

    const plunger = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.06, 0.16, 16),
      Mats.brushedAluminum()
    );
    plunger.rotation.z = Math.PI / 2;
    plunger.position.set(muzzleX - 0.1, y1, 0);
    launcher.add(plunger);

    const launchLed = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), Mats.led(0xffaa33));
    launchLed.position.set(muzzleX - 0.45, y1 + 0.24, 0.28);
    launcher.add(launchLed);
    engine.addStaticMesh(launcher);

    const ledArm = launchLed.material;
    const ledReady = Mats.led(0x3ee0b0);
    const ledFire = Mats.led(0xff3355);

    // —— Balls ——
    const mesh1 = makeLabSphere(r1, Mats.ballBlue());
    const mesh2 = makeLabSphere(r2, Mats.ballRed());
    engine.addStaticMesh(mesh1);
    engine.addStaticMesh(mesh2);

    const x1Start = muzzleX + r1 + 0.05;
    const x2Start = 0.8;
    let x1 = x1Start;
    let x2 = x2Start;
    let vel1 = 0;
    let vel2 = 0;
    let released = false;
    const releaseAt = 0.45;
    let plungerT = 0;
    let collided = false;
    let inContact = false;
    let settled = false;
    let pBefore = null;
    let kBefore = null;
    let pAfter = null;
    let kAfter = null;
    let eMeasured = null;
    let impactFlash = 0;
    // Pre-collision velocities for measurement (sampled just before impulse)
    let u1Snap = 0;
    let u2Snap = 0;

    const trail1 = engine.createTrail(0x5b8cff, 140);
    const trail2 = engine.createTrail(0xff6b8a, 140);
    const arrow1 = makeArrow(engine, 0x8eb6ff);
    const arrow2 = makeArrow(engine, 0xff9bb0);
    const impact = makeImpactFX(engine);
    const speedTag1 = makeVelocityLabel(engine, { color: '#8eb6ff', label: 'v₁' });
    const speedTag2 = makeVelocityLabel(engine, { color: '#ff9bb0', label: 'v₂' });

    liveSelect(ui, params, 'mode', {
      id: 'mode',
      label: '碰撞类型预设',
      options: [
        { value: 'elastic', label: '完全弹性 e=1（动能守恒）' },
        { value: 'inelastic', label: '非弹性 e=0.4（部分动能损失）' },
        { value: 'sticky', label: '近似完全非弹性 e≈0（一起运动）' },
        { value: 'exchange', label: '等质量弹性（速度交换演示）' },
      ],
      map: (p, v) => {
        if (v === 'elastic') {
          p.e = 1;
          // 保持当前质量，若碰巧等质量则略调开，避免“蓝球直接停住”
          if (Math.abs(Number(p.m1) - Number(p.m2)) < 1e-6) {
            p.m1 = 3;
            p.m2 = 1.5;
          }
        }
        if (v === 'inelastic') p.e = 0.4;
        if (v === 'sticky') p.e = 0.05;
        if (v === 'exchange') {
          p.e = 1;
          p.m1 = 2;
          p.m2 = 2;
        }
      },
    });
    liveSlider(ui, params, 'm1', {
      id: 'm1',
      label: '入射球质量 m₁',
      min: 0.5,
      max: 8,
      step: 0.5,
      unit: ' kg',
    });
    liveSlider(ui, params, 'm2', {
      id: 'm2',
      label: '靶球质量 m₂',
      min: 0.5,
      max: 8,
      step: 0.5,
      unit: ' kg',
    });
    liveSlider(ui, params, 'v1', {
      id: 'v1',
      label: '入射初速度 v₁',
      min: 1,
      max: 7,
      step: 0.5,
      unit: ' m/s',
    });
    liveSlider(ui, params, 'e', {
      id: 'e',
      label: '恢复系数 e',
      min: 0,
      max: 1,
      step: 0.05,
      unit: '',
    });

    setFormula(
      ui.formula,
      `<strong>一维对心碰撞</strong><br/>
       动量守恒：<code>m₁v₁ + m₂v₂ = m₁v₁′ + m₂v₂′</code><br/>
       恢复系数：<code>e = (v₂′−v₁′)/(v₁−v₂)</code><br/>
       动能：<code>E_k = (1/2)mv²</code>；仅 <code>e=1</code>（弹性碰撞）时动能守恒<br/>
       <span style="opacity:.9">默认 m₁&gt;m₂：碰撞后蓝球仍向前。仅当 m₁=m₂ 且 e=1 时速度交换（入射球才停下）。</span>`
    );

    function syncMeshes() {
      mesh1.position.set(x1, y1, 0);
      mesh2.position.set(x2, y2, 0);
      // Roll as if rolling without slip on deck (visual only)
      mesh1.rotation.z = -x1 / r1;
      mesh2.rotation.z = -x2 / r2;

      const kick = plungerT > 0 ? Math.sin(Math.min(plungerT, 1) * Math.PI) * 0.12 : 0;
      plunger.position.x = muzzleX - 0.1 + kick;

      if (impactFlash > 0) launchLed.material = ledFire;
      else if (released) launchLed.material = ledReady;
      else launchLed.material = ledArm;
    }

    function updateArrow(arrow, x, y, vx) {
      const speed = Math.abs(vx);
      if (speed < 0.04) {
        arrow.visible = false;
        return;
      }
      arrow.visible = true;
      arrow.position.set(x, y + 0.12, 0.32);
      const len = Math.min(speed * 0.4, 2.0);
      arrow.scale.set((vx >= 0 ? 1 : -1) * len, 1, 1);
    }

    function tryRelease(t) {
      if (released || t < releaseAt) return;
      released = true;
      plungerT = 0.001;
      vel1 = Number(params.v1);
      vel2 = 0;
      pBefore = Number(params.m1) * vel1 + Number(params.m2) * vel2;
      kBefore = 0.5 * Number(params.m1) * vel1 * vel1 + 0.5 * Number(params.m2) * vel2 * vel2;
    }

    function softReset() {
      released = false;
      plungerT = 0;
      collided = false;
      inContact = false;
      settled = false;
      pBefore = null;
      kBefore = null;
      pAfter = null;
      kAfter = null;
      eMeasured = null;
      impactFlash = 0;
      u1Snap = 0;
      u2Snap = 0;
      x1 = x1Start;
      x2 = x2Start;
      vel1 = 0;
      vel2 = 0;
      engine.clearTrail(trail1);
      engine.clearTrail(trail2);
      syncMeshes();
      speedTag1.update(x1, y1 + r1 + 0.22, 0, 0);
      speedTag2.update(x2, y2 + r2 + 0.22, 0, 0);
      arrow1.visible = false;
      arrow2.visible = false;
      return true;
    }

    function integrate(dt) {
      if (settled) {
        if (plungerT < 1.2) plungerT += dt * 6;
        if (impactFlash > 0) impactFlash = Math.max(0, impactFlash - dt);
        impact.update(dt);
        return;
      }
      if (plungerT < 1.2) plungerT += dt * 6;
      if (impactFlash > 0) impactFlash = Math.max(0, impactFlash - dt);
      impact.update(dt);

      // Light linear drag (air track residual resistance)
      const damp = Math.exp(-drag * dt);
      vel1 *= damp;
      vel2 *= damp;

      x1 += vel1 * dt;
      x2 += vel2 * dt;

      // End stops
      if (x1 - r1 <= wallL && vel1 < 0) {
        x1 = wallL + r1;
        vel1 = -vel1 * wallRest;
        inContact = false;
      }
      if (x2 + r2 >= wallR && vel2 > 0) {
        x2 = wallR - r2;
        vel2 = -vel2 * wallRest;
        inContact = false;
      }
      if (x1 + r1 >= wallR && vel1 > 0) {
        x1 = wallR - r1;
        vel1 = -vel1 * wallRest;
        inContact = false;
      }
      if (x2 - r2 <= wallL && vel2 < 0) {
        x2 = wallL + r2;
        vel2 = -vel2 * wallRest;
        inContact = false;
      }

      const m1 = Number(params.m1);
      const m2 = Number(params.m2);
      const e = Math.min(1, Math.max(0, Number(params.e)));

      const gap = x2 - x1;
      const minGap = r1 + r2;
      const rel = vel1 - vel2;

      if (gap > minGap + 0.01) inContact = false;

      // Approaching contact → one physical impulse
      if (!inContact && gap <= minGap && rel > 1e-5) {
        inContact = true;
        u1Snap = vel1;
        u2Snap = vel2;

        const res = collide1D(m1, m2, vel1, vel2, e);
        vel1 = res.v1;
        vel2 = res.v2;

        // Non-penetration: put contact point correctly
        const c = (x1 + r1 + x2 - r2) * 0.5;
        x1 = c - r1 - 1e-4;
        x2 = c + r2 + 1e-4;

        if (!collided) {
          collided = true;
          impactFlash = 0.3;
          pAfter = m1 * vel1 + m2 * vel2;
          kAfter = 0.5 * m1 * vel1 * vel1 + 0.5 * m2 * vel2 * vel2;
          const approach = u1Snap - u2Snap;
          eMeasured = Math.abs(approach) > 1e-9 ? (vel2 - vel1) / approach : 0;
          impact.trigger((x1 + x2) / 2, (y1 + y2) / 2, 0);
        }
      } else if (inContact && e < 0.08 && gap <= minGap + 0.015) {
        // Sticky: common velocity (inelastic lock) while still touching
        const vCom = (m1 * vel1 + m2 * vel2) / (m1 + m2);
        vel1 = vCom;
        vel2 = vCom;
        const c = (x1 + r1 + x2 - r2) * 0.5;
        x1 = c - r1;
        x2 = c + r2;
      }

      // After collision + damping, stop residual crawling so balls do not
      // bounce end-stops forever on a near-frictionless track.
      if (collided && Math.abs(vel1) < 0.04 && Math.abs(vel2) < 0.04) {
        vel1 = 0;
        vel2 = 0;
        settled = true;
      }
    }

    engine.onPreStep = (dt, t) => {
      tryRelease(t);
      if (released) integrate(dt);
    };

    syncMeshes();
    speedTag1.update(x1, y1 + r1 + 0.22, 0, vel1);
    speedTag2.update(x2, y2 + r2 + 0.22, 0, vel2);

    return {
      getParams: () => ({ ...params }),
      hostAction(action) {
        if (action === 'reset') return softReset();
        return false;
      },
      dispose() {
        speedTag1.dispose();
        speedTag2.dispose();
      },
      tick(_dt, t) {
        tryRelease(t);
        syncMeshes();

        // Real-time velocity badges floating above each ball
        speedTag1.update(x1, y1 + r1 + 0.22, 0, vel1);
        speedTag2.update(x2, y2 + r2 + 0.22, 0, vel2);

        if (released && !settled) {
          engine.pushTrail(trail1, x1, y1, 0);
          engine.pushTrail(trail2, x2, y2, 0);
        }
        updateArrow(arrow1, x1, y1 + r1, vel1);
        updateArrow(arrow2, x2, y2 + r2, vel2);

        const m1 = Number(params.m1);
        const m2 = Number(params.m2);
        const e = Number(params.e);
        const u1 = Number(params.v1);
        const k1 = 0.5 * m1 * vel1 * vel1;
        const k2 = 0.5 * m2 * vel2 * vel2;
        const p = m1 * vel1 + m2 * vel2;
        const k = k1 + k2;
        const theory = collide1D(m1, m2, u1, 0, e);
        const k0 = 0.5 * m1 * u1 * u1;
        const kTh =
          0.5 * m1 * theory.v1 * theory.v1 + 0.5 * m2 * theory.v2 * theory.v2;

        const pRatio =
          pBefore != null && pAfter != null && Math.abs(pBefore) > 1e-9
            ? pAfter / pBefore
            : null;
        const kRatio =
          kBefore != null && kAfter != null && kBefore > 1e-9 ? kAfter / kBefore : null;
        const dK = kBefore != null && kAfter != null ? kBefore - kAfter : null;

        setReadouts(ui.readouts, [
          { label: 'v₁ 实时', value: `${formatNum(vel1, 2)} m/s` },
          { label: 'v₂ 实时', value: `${formatNum(vel2, 2)} m/s` },
          { label: '理论 v₁′ / v₂′', value: `${formatNum(theory.v1, 2)} / ${formatNum(theory.v2, 2)}` },
          { label: '总动量 p', value: `${formatNum(p, 2)} kg·m/s` },
          { label: '总动能 K', value: `${formatNum(k, 2)} J` },
          {
            label: '动能损失 ΔK',
            value: dK == null ? '—' : `${formatNum(dK, 2)} J`,
          },
          {
            label: 'p′/p₀（应≈1）',
            value: pRatio == null ? '—' : formatNum(pRatio, 3),
          },
          {
            label: 'K′/K₀（测/理论）',
            value:
              kRatio == null
                ? '—'
                : `${formatNum(kRatio, 3)} / ${formatNum(kTh / k0, 3)}`,
          },
          {
            label: '测得 e',
            value: eMeasured == null ? '—' : formatNum(eMeasured, 3),
          },
        ]);
      },
    };
  },
};
