import * as THREE from 'three';
import { BODY_TYPE } from '../../runtime/threading/physicsBackend.js';
import { liveSlider, liveSelect, setReadouts, setFormula } from '../core/ui.js';
import { formatNum, vecSpeed } from '../core/engine.js';
import { Mats } from '../core/materials.js';
import {
  addSimpleGround,
  addDigitalPanel,
  addCable,
  createPhysicsSphere,
} from '../core/labkit.js';

/**
 * Ballistics helpers — launch height ≠ landing height (proper quadratic root).
 * Design references:
 * - PhET Projectile Motion: parameter exploration + target
 * - Teaching labs: equal-time strobe dots, vx/vy decomposition
 * - Aim-line games (Angry Birds / artillery): dashed preview + apex
 */

function flightTime(v0, theta, g, y0, yLand = 0) {
  const vy = v0 * Math.sin(theta);
  //  y = y0 + vy t − ½ g t²  →  ½ g t² − vy t + (yLand − y0) = 0
  const a = 0.5 * g;
  const b = -vy;
  const c = yLand - y0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Math.max(0.05, (2 * vy) / g);
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  return Math.max(0.05, t);
}

function rangeX(v0, theta, g, y0, yLand = 0) {
  const T = flightTime(v0, theta, g, y0, yLand);
  return v0 * Math.cos(theta) * T;
}

function apexHeight(v0, theta, g, y0) {
  const vy = v0 * Math.sin(theta);
  return y0 + (vy * vy) / (2 * g);
}

function apexTime(v0, theta, g) {
  return (v0 * Math.sin(theta)) / g;
}

function sampleTrajectory(v0, theta, g, origin, yLand, samples = 80) {
  const [x0, y0] = origin;
  const T = flightTime(v0, theta, g, y0, yLand);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * T;
    const x = x0 + v0 * Math.cos(theta) * t;
    const y = y0 + v0 * Math.sin(theta) * t - 0.5 * g * t * t;
    if (y < yLand - 0.02 && i > 2) break;
    pts.push(new THREE.Vector3(x, Math.max(y, yLand), 0));
  }
  return { pts, T };
}

function makeArrow(color, length = 1) {
  const dir = new THREE.Vector3(1, 0, 0);
  const origin = new THREE.Vector3(0, 0, 0);
  const arrow = new THREE.ArrowHelper(dir, origin, length, color, 0.22, 0.12);
  arrow.line.material.depthTest = true;
  arrow.cone.material.depthTest = true;
  return arrow;
}

function setArrowFromTo(arrow, ox, oy, oz, dx, dy, dz, scale = 0.18) {
  const len = Math.hypot(dx, dy, dz) * scale;
  const L = Math.max(0.05, Math.min(2.8, len));
  arrow.position.set(ox, oy, oz);
  if (L < 0.06) {
    arrow.visible = false;
    return;
  }
  arrow.visible = true;
  const dir = new THREE.Vector3(dx, dy, dz);
  if (dir.lengthSq() < 1e-8) {
    arrow.visible = false;
    return;
  }
  dir.normalize();
  arrow.setDirection(dir);
  arrow.setLength(L, Math.min(0.28, L * 0.35), Math.min(0.14, L * 0.2));
}

function makeLabelSprite(text, color = '#ffc14d', scale = 0.55) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = 'bold 36px Segoe UI, Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,12,22,0.72)';
  const tw = ctx.measureText(text).width + 28;
  roundRect(ctx, (c.width - tw) / 2, 22, tw, 52, 12);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale * 1.6, scale * 0.6, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeStrobeDots(points, color, every = 4) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.055, 12, 10);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
  });
  for (let i = 0; i < points.length; i += every) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(points[i]);
    g.add(m);
  }
  // always mark landing
  if (points.length > 1) {
    const land = new THREE.Mesh(geo, mat.clone());
    land.material.color = new THREE.Color(0xff6b8a);
    land.position.copy(points[points.length - 1]);
    land.scale.setScalar(1.25);
    g.add(land);
  }
  return g;
}

function makeDashedPath(points, color, dash = 0.22, gap = 0.12, opacity = 0.88) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({
      color,
      dashSize: dash,
      gapSize: gap,
      transparent: true,
      opacity,
    })
  );
  line.computeLineDistances();
  return line;
}

function makeSolidPath(points, color, opacity = 0.55) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
}

/** Graduated range tape along +X (capped to keep mesh count reasonable) */
function buildRangeTape(engine, maxX, surfaceY) {
  const g = new THREE.Group();
  const end = Math.min(40, Math.ceil(Math.max(Number.isFinite(maxX) ? maxX + 2 : 12, 12)));

  // long strip base
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(end + 1, 0.02, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x1a2234, metalness: 0.2, roughness: 0.75 })
  );
  strip.position.set(end / 2, surfaceY + 0.012, -0.85);
  strip.receiveShadow = true;
  g.add(strip);

  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(end + 1, 0.008, 0.04),
    Mats.anodizedBlue()
  );
  accent.position.set(end / 2, surfaceY + 0.025, -0.62);
  g.add(accent);

  for (let i = 0; i <= end; i++) {
    const major = i % 5 === 0;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.01, major ? 0.42 : 0.22),
      major ? Mats.warningYellow() : Mats.brushedAluminum()
    );
    tick.position.set(i, surfaceY + 0.028, -0.85);
    g.add(tick);

    if (major) {
      // pylon + soft glow ring
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.03, 0.32, 10),
        Mats.darkMetal()
      );
      post.position.set(i, surfaceY + 0.16, -1.15);
      post.castShadow = true;
      g.add(post);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 12, 10),
        Mats.led(i === 0 ? 0x3ee0b0 : 0xffc14d)
      );
      cap.position.set(i, surfaceY + 0.34, -1.15);
      g.add(cap);

      const label = makeLabelSprite(`${i} m`, '#c8d6f0', 0.42);
      label.position.set(i, surfaceY + 0.52, -1.15);
      g.add(label);
    }
  }

  engine.addStaticMesh(g);
  return g;
}

/** School-lab spring launcher on an elevating stand (PhET-style cannon). */
function buildLauncher(engine, { baseY, h0, theta }) {
  const launcher = new THREE.Group();

  // Heavy base plate
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.62, 0.1, 40),
    Mats.darkMetal()
  );
  base.position.set(0, baseY + 0.05, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  launcher.add(base);

  const rubber = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.035, 10, 36),
    Mats.rubber(0x151820)
  );
  rubber.rotation.x = Math.PI / 2;
  rubber.position.set(0, baseY + 0.03, 0);
  launcher.add(rubber);

  // Elevating column (launch height h0)
  const colH = Math.max(0.35, h0 - 0.15);
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, colH, 20),
    Mats.brushedAluminum()
  );
  column.position.set(0, baseY + 0.1 + colH / 2, 0);
  column.castShadow = true;
  launcher.add(column);

  // Height scale marks
  for (let i = 0; i < Math.floor(colH / 0.25); i++) {
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.01, 0.02),
      Mats.warningYellow()
    );
    mark.position.set(0.08, baseY + 0.2 + i * 0.25, 0);
    launcher.add(mark);
  }

  // Turret plate
  const plateY = baseY + h0;
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.07, 32),
    Mats.labPlastic(0x252b38)
  );
  plate.position.set(0, plateY, 0);
  plate.castShadow = true;
  launcher.add(plate);

  // Yoke arms
  for (const z of [-0.16, 0.16]) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.32, 0.055),
      Mats.brushedAluminum()
    );
    arm.position.set(0, plateY + 0.2, z);
    arm.castShadow = true;
    launcher.add(arm);
  }

  // Barrel assembly (pivots about plateY + 0.22)
  const pivotY = plateY + 0.22;
  const barrelG = new THREE.Group();

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.105, 1.2, 28),
    Mats.brushedAluminum()
  );
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.48, 0, 0);
  barrel.castShadow = true;
  barrelG.add(barrel);

  for (const x of [0.18, 0.55, 0.92]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.016, 10, 24),
      Mats.anodizedBlue()
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.set(x, 0, 0);
    barrelG.add(ring);
  }

  const muzzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.095, 0.14, 20),
    Mats.matteBlack()
  );
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(1.1, 0, 0);
  barrelG.add(muzzle);

  // Inner bore glow
  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16),
    Mats.led(0x3ee0b0)
  );
  bore.rotation.z = Math.PI / 2;
  bore.position.set(1.16, 0, 0);
  barrelG.add(bore);

  // Spring housing + compression indicator
  const springHouse = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.2, 0.2),
    Mats.labPlastic(0x1e2433)
  );
  springHouse.position.set(-0.08, 0, 0);
  barrelG.add(springHouse);

  const powerBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.04, 0.06),
    Mats.led(0xff9a3c)
  );
  powerBar.position.set(-0.08, 0.08, 0.12);
  barrelG.add(powerBar);

  // Elevation protractor (semicircle)
  const elev = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.26, 32, 1, 0, Math.PI),
    new THREE.MeshPhysicalMaterial({
      color: 0xe8ecf4,
      metalness: 0.15,
      roughness: 0.4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    })
  );
  elev.position.set(0, 0, 0.2);
  elev.rotation.y = Math.PI / 2;
  barrelG.add(elev);

  // Angle needle (local +X is barrel axis; needle along barrel)
  const needle = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.018, 0.018),
    Mats.anodizedOrange()
  );
  needle.position.set(0.1, 0, 0.2);
  barrelG.add(needle);

  const lockKnob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.07, 16),
    Mats.anodizedOrange()
  );
  lockKnob.rotation.x = Math.PI / 2;
  lockKnob.position.set(0, 0, 0.24);
  barrelG.add(lockKnob);

  barrelG.position.set(0, pivotY, 0);
  barrelG.rotation.z = theta;
  launcher.add(barrelG);

  // Digital angle badge
  const angleLabel = makeLabelSprite(`${Math.round((theta * 180) / Math.PI)}°`, '#4d8dff', 0.5);
  angleLabel.position.set(-0.35, pivotY + 0.35, 0.35);
  launcher.add(angleLabel);

  engine.addStaticMesh(launcher);

  // Muzzle world position (barrel length ≈ 1.1 from pivot)
  const muzzleLen = 1.12;
  const launchPos = [
    muzzleLen * Math.cos(theta),
    pivotY + muzzleLen * Math.sin(theta),
    0,
  ];

  return { launcher, barrelG, launchPos, pivotY, muzzleLen, powerBar };
}

/** Concentric LED target pad at theoretical range */
function buildTarget(engine, x, surfaceY) {
  const target = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.68, 0.07, 40),
    Mats.darkMetal()
  );
  pad.receiveShadow = true;
  target.add(pad);

  for (const [ri, col, op] of [
    [0.55, 0xff6b8a, 0.75],
    [0.36, 0xffffff, 0.7],
    [0.16, 0xff6b8a, 0.85],
  ]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ri - 0.07, ri, 40),
      new THREE.MeshBasicMaterial({
        color: col,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: op,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    target.add(ring);
  }

  const ledRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.018, 8, 48),
    Mats.led(0xff6b8a)
  );
  ledRing.rotation.x = Math.PI / 2;
  ledRing.position.y = 0.045;
  target.add(ledRing);

  // Bullseye sensor post
  const sensor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.12, 12),
    Mats.matteBlack()
  );
  sensor.position.y = 0.1;
  target.add(sensor);

  target.position.set(x, surfaceY + 0.035, 0);
  engine.addHelper(target);
  return { group: target, ledRing, x };
}

export const projectile = {
  id: 'projectile',
  name: '抛体运动',
  meta: '弹道分析台 · 分运动可视化',
  description:
    '可调仰角与发射高度的弹射实验台。理论虚线轨迹 + 等时间隔采样点（频闪风格），实时速度分量箭头，可选互补角对照与水平/竖直分运动分解。对比理论射高、射程与飞行时间。',

  setup(engine, ui, overrides = {}) {
    const params = {
      v0: 10,
      angleDeg: 42,
      g: 9.81,
      h0: 1.2,
      assist: 'strobe', // none | strobe | complement | components
      ...overrides,
    };

    engine.world.gravity.set(0, -params.g, 0);
    const { surfaceY } = addSimpleGround(engine, { size: 48 });

    const theta = (params.angleDeg * Math.PI) / 180;
    const v0 = params.v0;
    const g = params.g;
    const h0 = params.h0;
    const r = 0.15;
    const yLand = surfaceY + r;

    const { launchPos, powerBar } = buildLauncher(engine, {
      baseY: surfaceY,
      h0,
      theta,
    });

    // Scale power bar by v0 (visual feedback like artillery power meter)
    const pScale = THREE.MathUtils.clamp((v0 - 4) / 14, 0.15, 1);
    powerBar.scale.x = pScale;

    // Ballistics console
    addDigitalPanel(engine, {
      position: [-1.45, surfaceY + 0.55, 1.0],
      width: 0.85,
      height: 0.5,
      title: 'BALLISTICS',
    });
    addCable(
      engine,
      [
        [-1.1, surfaceY + 0.45, 1.0],
        [-0.4, surfaceY + 0.12, 0.5],
        [0, surfaceY + h0 * 0.4, 0.15],
      ],
      0x1a1e28
    );

    // Theory primary trajectory
    const y0 = launchPos[1];
    const { pts: theoryPts, T: Tflight } = sampleTrajectory(
      v0,
      theta,
      g,
      [launchPos[0], y0],
      yLand,
      96
    );
    const R = rangeX(v0, theta, g, y0, yLand);
    const H = apexHeight(v0, theta, g, y0);
    const tApex = apexTime(v0, theta, g);
    const xApex = launchPos[0] + v0 * Math.cos(theta) * tApex;

    buildRangeTape(engine, Math.max(R, 10), surfaceY);

    const theoryLine = makeDashedPath(theoryPts, 0xffb454, 0.2, 0.1, 0.9);
    engine.addHelper(theoryLine);

    // Equal-time strobe dots (classic teaching: constant Δt sampling)
    const strobe = makeStrobeDots(theoryPts, 0xffc14d, 5);
    strobe.visible = params.assist === 'strobe';
    engine.addHelper(strobe);

    // Apex marker + height drop line
    const apexG = new THREE.Group();
    const apexDiamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12, 0),
      Mats.led(0x4d8dff)
    );
    apexDiamond.position.set(xApex, H, 0);
    apexG.add(apexDiamond);
    const drop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xApex, H, 0),
        new THREE.Vector3(xApex, yLand, 0),
      ]),
      new THREE.LineDashedMaterial({
        color: 0x4d8dff,
        dashSize: 0.1,
        gapSize: 0.08,
        transparent: true,
        opacity: 0.7,
      })
    );
    drop.computeLineDistances();
    apexG.add(drop);
    const hLabel = makeLabelSprite(`H=${formatNum(H, 2)}m`, '#7eb6ff', 0.5);
    hLabel.position.set(xApex, H + 0.35, 0);
    apexG.add(hLabel);
    engine.addHelper(apexG);

    // Landing crosshair + range label
    const landG = new THREE.Group();
    const crossH = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.02, 0.04),
      Mats.led(0xff6b8a)
    );
    const crossV = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.02, 0.55),
      Mats.led(0xff6b8a)
    );
    crossH.position.set(launchPos[0] + R, yLand + 0.01, 0);
    crossV.position.copy(crossH.position);
    landG.add(crossH, crossV);
    const rLabel = makeLabelSprite(`R=${formatNum(R, 2)}m`, '#ff8fab', 0.5);
    rLabel.position.set(launchPos[0] + R, yLand + 0.55, 0);
    landG.add(rLabel);
    engine.addHelper(landG);

    // Target pad
    const target = buildTarget(engine, launchPos[0] + R, surfaceY);

    // Soft backstop net
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 2.4, 4.5),
      new THREE.MeshPhysicalMaterial({
        color: 0x3a4558,
        metalness: 0.15,
        roughness: 0.75,
        transparent: true,
        opacity: 0.45,
      })
    );
    net.position.set(Math.max(launchPos[0] + R + 3.5, 14), surfaceY + 1.2, 0);
    engine.addStaticMesh(net);

    // --- Complementary angle ghost (same range when y0≈0; still pedagogical) ---
    const complementG = new THREE.Group();
    const theta2 = Math.PI / 2 - theta;
    if (Math.abs(theta2 - theta) > 0.05 && params.assist === 'complement') {
      const { pts: cPts } = sampleTrajectory(
        v0,
        theta2,
        g,
        [launchPos[0], y0],
        yLand,
        80
      );
      complementG.add(makeDashedPath(cPts, 0xa78bfa, 0.16, 0.1, 0.75));
      complementG.add(makeStrobeDots(cPts, 0xa78bfa, 6));
      const cLabel = makeLabelSprite(
        `互补角 ${(theta2 * 180) / Math.PI | 0}°`,
        '#c4b5fd',
        0.48
      );
      if (cPts.length > 10) {
        const mid = cPts[Math.floor(cPts.length * 0.45)];
        cLabel.position.set(mid.x, mid.y + 0.35, 0);
        complementG.add(cLabel);
      }
    }
    engine.addHelper(complementG);

    // --- Component decomposition ghosts (水平匀速 + 竖直上抛) ---
    const componentG = new THREE.Group();
    const ghostHoriz = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.7, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.45 })
    );
    const ghostVert = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.7, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.45 })
    );
    // Horizontal ground track
    const hTrackPts = [
      new THREE.Vector3(launchPos[0], yLand + 0.02, 0.45),
      new THREE.Vector3(launchPos[0] + R, yLand + 0.02, 0.45),
    ];
    const hTrack = makeSolidPath(hTrackPts, 0x5b8cff, 0.5);
    // Vertical rail at launch x
    const vTrackPts = [
      new THREE.Vector3(launchPos[0] - 0.4, y0, 0),
      new THREE.Vector3(launchPos[0] - 0.4, H, 0),
    ];
    const vTrack = makeDashedPath(vTrackPts, 0xff9a3c, 0.1, 0.08, 0.65);
    componentG.add(ghostHoriz, ghostVert, hTrack, vTrack);
    const vxTag = makeLabelSprite('水平：匀速', '#7eb6ff', 0.42);
    vxTag.position.set(launchPos[0] + R * 0.5, yLand + 0.35, 0.45);
    const vyTag = makeLabelSprite('竖直：竖直上抛', '#ffb454', 0.42);
    vyTag.position.set(launchPos[0] - 0.4, H + 0.3, 0);
    componentG.add(vxTag, vyTag);
    componentG.visible = params.assist === 'components';
    engine.addHelper(componentG);

    // Projectile ball
    const ball = createPhysicsSphere(engine, {
      radius: r,
      position: launchPos,
      mass: 0.75,
      colorMat: Mats.ballTeal(),
      restitution: 0.25,
      friction: 0.3,
    });
    ball.body.type = BODY_TYPE.KINEMATIC;

    // Live velocity vectors on the ball (PhET / textbook style)
    const arrowV = makeArrow(0x3ee0b0, 1);
    const arrowVx = makeArrow(0x5b8cff, 0.8);
    const arrowVy = makeArrow(0xff9a3c, 0.8);
    engine.addHelper(arrowV);
    engine.addHelper(arrowVx);
    engine.addHelper(arrowVy);

    // Initial aim arrows at muzzle (before release)
    setArrowFromTo(
      arrowV,
      launchPos[0],
      launchPos[1],
      0,
      v0 * Math.cos(theta),
      v0 * Math.sin(theta),
      0,
      0.2
    );
    setArrowFromTo(arrowVx, launchPos[0], launchPos[1], 0, v0 * Math.cos(theta), 0, 0, 0.2);
    setArrowFromTo(arrowVy, launchPos[0], launchPos[1], 0, 0, v0 * Math.sin(theta), 0, 0.2);

    const trail = engine.createTrail(0x3ee0b0, 280);

    // Camera: frame launcher → apex → target
    const camX = Math.min(R * 0.45 + 2, 10);
    const camY = Math.max(H * 0.55 + 2.5, 4.5);
    const camZ = Math.max(R * 0.35 + 6, 11);
    engine.setCamera([camX, camY, camZ], [R * 0.4, Math.min(H * 0.4, 2.5), 0]);

    // ---- Controls ----
    liveSlider(ui, params, 'v0', {
      id: 'v0',
      label: '初速度 v₀',
      min: 4,
      max: 18,
      step: 0.5,
      unit: ' m/s',
    });
    liveSlider(ui, params, 'angleDeg', {
      id: 'angle',
      label: '仰角 θ',
      min: 10,
      max: 80,
      step: 1,
      unit: '°',
    });
    liveSlider(ui, params, 'h0', {
      id: 'h0',
      label: '发射高度 h₀',
      min: 0.5,
      max: 3.5,
      step: 0.1,
      unit: ' m',
    });
    liveSlider(ui, params, 'g', {
      id: 'g',
      label: '重力 g',
      min: 1.6,
      max: 15,
      step: 0.1,
      unit: ' m/s²',
    });
    liveSelect(ui, params, 'assist', {
      id: 'assist',
      label: '辅助显示',
      options: [
        { value: 'strobe', label: '等时采样点（频闪）' },
        { value: 'complement', label: '互补角对照轨迹' },
        { value: 'components', label: '水平 / 竖直分运动' },
        { value: 'none', label: '仅理论曲线' },
      ],
    });

    setFormula(
      ui.formula,
      `<strong>平抛 / 斜抛运动</strong><br/>
       轨迹方程：<code>y = x tanθ − g x² / (2 v₀² cos²θ)</code><br/>
       分运动：水平 <code>x = v₀ cosθ · t</code>（匀速）；
       竖直 <code>y = v₀ sinθ · t − (1/2)gt²</code>（匀变速）<br/>
       最大高度 H ≈ <strong>${formatNum(H, 2)} m</strong> ·
       水平射程 R ≈ <strong>${formatNum(R, 2)} m</strong> ·
       飞行时间 T ≈ <strong>${formatNum(Tflight, 2)} s</strong><br/>
       <span style="opacity:.75">互补角 θ 与 90°−θ 在同一水平面落地时射程相同（抛出点与落点等高时最明显）</span>`
    );

    let released = false;
    const releaseAt = 0.55;
    let maxH = y0;
    let landed = false;
    let landX = null;
    let landT = null;
    let hitTarget = false;

    function parkBallAtLaunch() {
      ball.body.type = BODY_TYPE.KINEMATIC;
      ball.body.velocity.set(0, 0, 0);
      ball.body.angularVelocity.set(0, 0, 0);
      ball.body.position.set(launchPos[0], launchPos[1], launchPos[2] || 0);
      ball.mesh.position.set(launchPos[0], launchPos[1], launchPos[2] || 0);
      ball.body.wakeUp();
    }

    function softReset() {
      released = false;
      maxH = y0;
      landed = false;
      landX = null;
      landT = null;
      hitTarget = false;
      engine.clearTrail(trail);
      parkBallAtLaunch();
      if (target.ledRing?.material) {
        target.ledRing.material.emissive?.setHex?.(0xff6b4a);
        target.ledRing.material.color?.setHex?.(0xff6b4a);
      }
      const th0 = (params.angleDeg * Math.PI) / 180;
      setArrowFromTo(
        arrowV,
        launchPos[0],
        launchPos[1],
        0,
        params.v0 * Math.cos(th0),
        params.v0 * Math.sin(th0),
        0,
        0.2,
      );
      setArrowFromTo(arrowVx, launchPos[0], launchPos[1], 0, params.v0 * Math.cos(th0), 0, 0, 0.2);
      setArrowFromTo(arrowVy, launchPos[0], launchPos[1], 0, 0, params.v0 * Math.sin(th0), 0, 0.2);
      ghostHoriz.position.set(launchPos[0], yLand + r * 0.7, 0.45);
      ghostVert.position.set(launchPos[0] - 0.4, y0, 0);
      return true;
    }

    return {
      getParams: () => ({ ...params }),
      hostAction(action) {
        if (action === 'reset') return softReset();
        return false;
      },
      tick(_dt, t) {
        const flightT = Math.max(0, t - releaseAt);

        if (!released && t >= releaseAt) {
          released = true;
          ball.body.type = BODY_TYPE.DYNAMIC;
          const th = (params.angleDeg * Math.PI) / 180;
          ball.body.velocity.set(
            params.v0 * Math.cos(th),
            params.v0 * Math.sin(th),
            0
          );
          ball.body.angularVelocity.set(0, 0, 0);
          ball.body.wakeUp();
        }

        const px = ball.body.position.x;
        const py = ball.body.position.y;
        const pz = ball.body.position.z;
        const vx = landed ? 0 : ball.body.velocity.x;
        const vy = landed ? 0 : ball.body.velocity.y;
        const vz = landed ? 0 : ball.body.velocity.z;

        if (released && !landed) {
          engine.pushTrail(trail, px, py, pz);
          maxH = Math.max(maxH, py);

          // Component ghosts follow ideal decomposition over time
          if (params.assist === 'components') {
            const th = (params.angleDeg * Math.PI) / 180;
            const gx = launchPos[0] + params.v0 * Math.cos(th) * flightT;
            const gy =
              y0 +
              params.v0 * Math.sin(th) * flightT -
              0.5 * params.g * flightT * flightT;
            ghostHoriz.position.set(
              Math.min(gx, launchPos[0] + R + 0.5),
              yLand + r * 0.7,
              0.45
            );
            ghostVert.position.set(
              launchPos[0] - 0.4,
              Math.max(yLand, Math.min(gy, H + 0.5)),
              0
            );
          }

          if (
            py <= yLand + 0.08 &&
            vy <= 0.35 &&
            t > releaseAt + 0.2
          ) {
            landed = true;
            landX = px;
            landT = flightT;
            hitTarget = Math.abs(px - target.x) < 0.65;
            if (hitTarget && target.ledRing.material.emissive) {
              target.ledRing.material.emissive.setHex(0x3ee0b0);
              target.ledRing.material.color.setHex(0x3ee0b0);
            }
            // Freeze on ground — DYNAMIC after impact used to bounce/roll forever.
            ball.body.type = BODY_TYPE.KINEMATIC;
            ball.body.velocity.set(0, 0, 0);
            ball.body.angularVelocity.set(0, 0, 0);
            ball.body.position.set(px, yLand + r, 0);
            ball.mesh.position.set(px, yLand + r, 0);
          }
        } else if (!released) {
          // Pre-launch: keep ghosts at origin
          ghostHoriz.position.set(launchPos[0], yLand + r * 0.7, 0.45);
          ghostVert.position.set(launchPos[0] - 0.4, y0, 0);
        }

        // Live arrows (use measured velocity after release; aim vector before)
        if (released && !landed) {
          setArrowFromTo(arrowV, px, py, pz, vx, vy, vz, 0.2);
          setArrowFromTo(arrowVx, px, py, pz, vx, 0, 0, 0.2);
          setArrowFromTo(arrowVy, px, py, pz, 0, vy, 0, 0.2);
        } else if (landed) {
          arrowV.visible = false;
          arrowVx.visible = false;
          arrowVy.visible = false;
        }

        const th = (params.angleDeg * Math.PI) / 180;
        const Hth = apexHeight(params.v0, th, params.g, y0);
        const Rth = rangeX(params.v0, th, params.g, y0, yLand);
        const Tth = flightTime(params.v0, th, params.g, y0, yLand);
        const speed = landed ? 0 : vecSpeed(ball.body);
        const vxi = params.v0 * Math.cos(th);
        const vyi = params.v0 * Math.sin(th);

        setReadouts(ui.readouts, [
          {
            label: '时间 t',
            value: released ? `${formatNum(flightT, 2)} s` : '待发射…',
          },
          { label: '位置 x', value: `${formatNum(px, 2)} m` },
          { label: '高度 y', value: `${formatNum(py, 2)} m` },
          { label: '速度 |v|', value: `${formatNum(speed, 2)} m/s` },
          {
            label: 'vx（水平）',
            value: released
              ? `${formatNum(vx, 2)} m/s`
              : `${formatNum(vxi, 2)} m/s`,
          },
          {
            label: 'vy（竖直）',
            value: released
              ? `${formatNum(vy, 2)} m/s`
              : `${formatNum(vyi, 2)} m/s`,
          },
          { label: '实测最大高度', value: `${formatNum(maxH, 2)} m` },
          { label: '理论最大高度 H', value: `${formatNum(Hth, 2)} m` },
          {
            label: '实测射程',
            value: landX == null ? '飞行中…' : `${formatNum(landX, 2)} m`,
          },
          { label: '理论射程 R', value: `${formatNum(Rth, 2)} m` },
          {
            label: '实测飞行时间',
            value: landT == null ? '飞行中…' : `${formatNum(landT, 2)} s`,
          },
          { label: '理论飞行时间 T', value: `${formatNum(Tth, 2)} s` },
          {
            label: '靶心判定',
            value: !landed ? '—' : hitTarget ? '命中 ✓' : '未命中',
          },
        ]);
      },
    };
  },
};
