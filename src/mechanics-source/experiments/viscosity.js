import * as THREE from 'three';
import { liveSlider, liveSelect, createSlider, setReadouts, setFormula } from '../core/ui.js';
import { formatNum } from '../core/engine.js';
import { Mats } from '../core/materials.js';
import { addSimpleGround } from '../core/labkit.js';

/** 常见实验液体：20°C 基准粘滞系数 (Pa·s)、密度 (kg/m³)、颜色
 *  opacity 刻意偏低，保证筒内钢球下落全程可见 */
const LIQUIDS = {
  glycerin: {
    label: '甘油 (丙三醇)',
    rho: 1260,
    eta20: 1.49,
    color: 0xd4a84a,
    opacity: 0.38,
    tempFactor: 0.085,
  },
  castor: {
    label: '蓖麻油',
    rho: 960,
    eta20: 0.986,
    color: 0xc49a2a,
    opacity: 0.36,
    tempFactor: 0.06,
  },
  silicone: {
    label: '硅油 (高粘)',
    rho: 970,
    eta20: 0.5,
    color: 0x9ecde8,
    opacity: 0.32,
    tempFactor: 0.04,
  },
  machine: {
    label: '机油 (SAE 30)',
    rho: 880,
    eta20: 0.29,
    color: 0x4a3f28,
    opacity: 0.42,
    tempFactor: 0.05,
  },
};

const STEEL_RHO = 7800;
const G = 9.81;

function etaAtTemp(liquidKey, T) {
  const L = LIQUIDS[liquidKey];
  return L.eta20 * Math.exp(-L.tempFactor * (T - 20));
}

function terminalVelocity(r, rhoBall, rhoLiq, eta) {
  return (2 * r * r * (rhoBall - rhoLiq) * G) / (9 * eta);
}

function viscosityFromV(r, R, rhoBall, rhoLiq, v) {
  if (v <= 1e-9) return NaN;
  const wall = 1 + 2.4 * (r / R);
  return (2 * r * r * (rhoBall - rhoLiq) * G) / (9 * v * wall);
}

/* ─────────────────── materials helpers ─────────────────── */

function glassMat({ opacity = 0.28, color = 0xd8e8f8 } = {}) {
  // 仅渲染外壁正面，避免 DoubleSide + 无 depthWrite 造成筒内物体重影
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    roughness: 0.6,
    transparent: true,
    opacity,
    side: THREE.FrontSide,
    depthWrite: false,
  });
}

function steelMat() {
  return new THREE.MeshStandardMaterial({
    color: 0xb0b8c4,
    metalness: 0.12,
    roughness: 0.75,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
}

function chromeRod() {
  return new THREE.MeshStandardMaterial({
    color: 0xb8c0cc,
    metalness: 0.15,
    roughness: 0.7,
  });
}

function blackPlastic() {
  return new THREE.MeshStandardMaterial({
    color: 0x1c212c,
    metalness: 0.05,
    roughness: 0.88,
  });
}

/** 无自发光的状态指示点 */
function dullLed(color = 0x3ee0b0) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.7,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
}

/* ─────────────────── textures ─────────────────── */

/**
 * 外置标尺正面贴图：固定朝 +Z（向前）
 * 白底黑字，高对比
 */
function createExternalRulerMap() {
  const w = 512;
  const h = 2048;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#f4f6fa';
  ctx.fillRect(0, 0, w, h);

  // 左边深色边（靠量筒）
  ctx.fillStyle = '#2a3548';
  ctx.fillRect(0, 0, 8, h);

  ctx.strokeStyle = '#5a6a82';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  const topPad = h * 0.035;
  const botPad = h * 0.03;
  const usable = h - topPad - botPad;
  const maxMm = 500;
  const x0 = 28;

  ctx.fillStyle = '#0d1524';
  ctx.font = `bold ${Math.round(h * 0.022)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('mm', w * 0.55, topPad * 0.45);

  for (let mm = 0; mm <= maxMm; mm += 1) {
    const y = topPad + usable * (1 - mm / maxMm);
    const is50 = mm % 50 === 0;
    const is10 = mm % 10 === 0;
    const is5 = mm % 5 === 0;

    let len;
    let lw;
    if (is50) {
      len = w * 0.42;
      lw = 5;
    } else if (is10) {
      len = w * 0.3;
      lw = 3.2;
    } else if (is5) {
      len = w * 0.2;
      lw = 2.2;
    } else {
      len = w * 0.11;
      lw = 1.4;
    }

    ctx.strokeStyle = is50 ? '#0a1020' : is10 ? '#152033' : '#3a4a62';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + len, y);
    ctx.stroke();

    if (is50) {
      ctx.fillStyle = '#0a1020';
      ctx.font = `bold ${Math.round(h * 0.032)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(mm), x0 + len + 14, y);
    } else if (is10 && mm > 0) {
      ctx.fillStyle = '#2a3a52';
      ctx.font = `600 ${Math.round(h * 0.016)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(mm), x0 + len + 8, y);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 外置立式标尺（固定朝前 +Z）
 * 本地：y=0 为底；尺面法线 +Z；0 刻度在 liquidBottomY
 */
function buildExternalRuler({
  height = 0.74,
  width = 0.055,
  thickness = 0.01,
  liquidBottomY = 0.04,
} = {}) {
  const g = new THREE.Group();
  const map = createExternalRulerMap();
  const midY = liquidBottomY + height / 2;

  // 尺身：宽 = X，高 = Y，厚 = Z（薄方向向前，正面朝 +Z）
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, thickness),
    new THREE.MeshStandardMaterial({
      color: 0xe8ecf4,
      metalness: 0.15,
      roughness: 0.45,
    })
  );
  body.position.y = midY;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // 刻度面：贴在 +Z 前表面（Plane 默认法线 +Z，无需旋转）
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.96, height * 0.98),
    new THREE.MeshBasicMaterial({
      map,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  face.position.set(0, midY, thickness / 2 + 0.001);
  g.add(face);

  // 实体刻线（保证贴图失效时仍可见）
  const tickMat = new THREE.MeshBasicMaterial({ color: 0x0a1020, toneMapped: false });
  const majorMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const maxMm = 500;
  for (let mm = 0; mm <= maxMm; mm += 5) {
    const t = mm / maxMm;
    const y = liquidBottomY + t * height;
    const is50 = mm % 50 === 0;
    const is10 = mm % 10 === 0;
    const len = is50 ? width * 0.42 : is10 ? width * 0.3 : width * 0.16;
    const th = is50 ? 0.0022 : is10 ? 0.0015 : 0.001;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(len, th, 0.002),
      is50 ? majorMat : tickMat
    );
    // 刻线从尺左侧伸出
    tick.position.set(-width / 2 + len / 2 + 0.004, y, thickness / 2 + 0.002);
    g.add(tick);
  }

  // 顶帽
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.008, 0.012, thickness + 0.006),
    new THREE.MeshStandardMaterial({ color: 0x2a3548, metalness: 0.05, roughness: 0.8 })
  );
  cap.position.y = liquidBottomY + height + 0.006;
  g.add(cap);

  // 支脚
  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.012, 0.014, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x1e2636, metalness: 0.2, roughness: 0.55 })
  );
  foot.position.set(0, 0.007, 0.005);
  g.add(foot);

  // 0 位红色标记
  const zero = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.003, 0.004),
    new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false })
  );
  zero.position.set(-width / 2 - 0.004, liquidBottomY, thickness / 2 + 0.002);
  g.add(zero);

  // 单位小牌
  const unit = new THREE.Mesh(
    new THREE.PlaneGeometry(0.028, 0.012),
    new THREE.MeshBasicMaterial({
      color: 0x0d1524,
      toneMapped: false,
    })
  );
  unit.position.set(width * 0.2, liquidBottomY + height - 0.02, thickness / 2 + 0.002);
  g.add(unit);

  return g;
}

function createLabelTexture(title, sub) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#c8c0b0';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 120);
  ctx.fillStyle = '#2a3548';
  ctx.font = 'bold 28px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 128, 52);
  ctx.fillStyle = '#5a6a80';
  ctx.font = '18px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText(sub, 128, 88);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ─────────────────── apparatus builders ─────────────────── */

/**
 * 精密量筒：六角塑料底座 + 洁净玻璃筒 + 液体（刻度外置，管面无贴图）
 * 坐标：底座底面在 y=0，筒轴在本地原点
 */
function buildMeasuringCylinder({
  innerR = 0.036,
  wall = 0.0028,
  height = 0.86,
  liquidH = 0.74,
  liquidKey = 'glycerin',
} = {}) {
  const g = new THREE.Group();
  const L = LIQUIDS[liquidKey];
  const outerR = innerR + wall;
  const glass = glassMat({ opacity: 0.26, color: 0xd0e4f8 });

  // —— 六角底座（真实量筒常见） ——
  const hexShape = new THREE.Shape();
  const hexR = outerR + 0.028;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * hexR;
    const y = Math.sin(a) * hexR;
    if (i === 0) hexShape.moveTo(x, y);
    else hexShape.lineTo(x, y);
  }
  hexShape.closePath();
  const hexGeo = new THREE.ExtrudeGeometry(hexShape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
  });
  hexGeo.rotateX(-Math.PI / 2);
  const hexBase = new THREE.Mesh(
    hexGeo,
    new THREE.MeshStandardMaterial({
      color: 0xe8ecf2,
      metalness: 0,
      roughness: 0.75,
    })
  );
  hexBase.position.y = 0;
  hexBase.castShadow = true;
  hexBase.receiveShadow = true;
  g.add(hexBase);

  // 底座中心凹槽环
  const well = new THREE.Mesh(
    new THREE.CylinderGeometry(outerR + 0.004, outerR + 0.006, 0.008, 48),
    new THREE.MeshStandardMaterial({
      color: 0xd0d6e0,
      metalness: 0,
      roughness: 0.8,
    })
  );
  well.position.y = 0.026;
  g.add(well);

  // 玻璃底盘
  const glassBottom = new THREE.Mesh(
    new THREE.CylinderGeometry(outerR, outerR, 0.008, 64),
    glass
  );
  glassBottom.position.y = 0.032;
  g.add(glassBottom);

  const floorDisk = new THREE.Mesh(
    new THREE.CircleGeometry(innerR - 0.001, 48),
    new THREE.MeshStandardMaterial({
      color: 0xc8d8ec,
      metalness: 0,
      roughness: 0.7,
      transparent: true,
      opacity: 0.55,
    })
  );
  floorDisk.rotation.x = -Math.PI / 2;
  floorDisk.position.y = 0.037;
  g.add(floorDisk);

  const tubeBottomY = 0.036;
  const tubeH = height - 0.02;

  // 外壁
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(outerR, outerR, tubeH, 64, 1, true),
    glass
  );
  outer.position.y = tubeBottomY + tubeH / 2;
  outer.castShadow = true;
  g.add(outer);

  // 内壁
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(innerR, innerR, tubeH - 0.004, 64, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xf0f6ff,
      metalness: 0,
      roughness: 0.7,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  inner.position.y = tubeBottomY + tubeH / 2;
  g.add(inner);

  // 筒口加厚卷边
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(outerR - wall * 0.2, wall * 0.95, 12, 48),
    glassMat({ opacity: 0.4, color: 0xe0eefc })
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = tubeBottomY + tubeH;
  g.add(lip);

  // 倾倒嘴（小三角凸起）
  const spout = new THREE.Mesh(
    new THREE.ConeGeometry(0.008, 0.016, 8),
    glassMat({ opacity: 0.35 })
  );
  spout.rotation.z = Math.PI / 2;
  spout.position.set(outerR + 0.004, tubeBottomY + tubeH - 0.002, 0);
  g.add(spout);

  // 液体：半透明、不写深度；renderOrder 低于钢球
  const liqMat = new THREE.MeshStandardMaterial({
    color: L.color,
    metalness: 0,
    roughness: 0.55,
    transparent: true,
    opacity: L.opacity,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const liquidR = innerR - 0.0012;
  // 实心柱（含上下底），单层半透明，避免双侧面叠透明度
  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(liquidR, liquidR, liquidH, 64),
    liqMat
  );
  liquid.position.y = tubeBottomY + 0.004 + liquidH / 2;
  liquid.receiveShadow = true;
  liquid.renderOrder = 1;
  g.add(liquid);

  // 液面（唯一顶面）
  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(innerR - 0.002, 48),
    new THREE.MeshStandardMaterial({
      color: L.color,
      metalness: 0,
      roughness: 0.5,
      transparent: true,
      opacity: Math.min(0.55, L.opacity + 0.12),
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = tubeBottomY + 0.004 + liquidH + 0.0005;
  surface.renderOrder = 2;
  g.add(surface);

  // 弯月面
  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(innerR * 0.82, innerR * 0.045, 8, 48),
    new THREE.MeshStandardMaterial({
      color: L.color,
      transparent: true,
      opacity: Math.min(0.55, L.opacity + 0.1),
      roughness: 0.65,
      metalness: 0,
      depthWrite: false,
    })
  );
  meniscus.rotation.x = Math.PI / 2;
  meniscus.position.y = tubeBottomY + 0.004 + liquidH;
  meniscus.renderOrder = 2;
  g.add(meniscus);

  const liquidBottomY = tubeBottomY + 0.004;
  const liquidTopY = liquidBottomY + liquidH;
  const topY = tubeBottomY + tubeH;

  return {
    group: g,
    innerR,
    outerR,
    height,
    liquidH,
    liquidBottomY,
    liquidTopY,
    topY,
    meniscus,
    surface,
    liquidMat: liqMat,
  };
}

/**
 * 铁架台 + 环夹 + 光电门（一体化）
 * 本地坐标：立柱 x=0；量筒轴线 x = rodToCyl
 * 所有夹具/光电门只在量筒「外侧」装配，绝不穿过玻璃内部
 */
function buildRetortStand({
  rodH = 1.05,
  rodToCyl = 0.14,
  outerR = 0.04,
  gateHighLocalY = 0.55,
  gateLowLocalY = 0.32,
  tubeTopY = 0.9,
} = {}) {
  const g = new THREE.Group();
  const rodMat = chromeRod();
  const cast = new THREE.MeshStandardMaterial({
    color: 0x2a303c,
    metalness: 0.15,
    roughness: 0.75,
  });

  // 间隙：量筒外壁到夹具内侧
  const clearance = 0.006;
  const ringR = outerR + clearance + 0.003; // 水平环内半径略大于筒外径
  // 光电门两臂在 z 方向的内侧位置（在筒外）
  const armZ = outerR + clearance + 0.012;
  // 光电门连接梁在量筒「后方」（-x 侧，朝向立柱），不穿过液体
  const bridgeX = rodToCyl - outerR - clearance - 0.012;

  // —— H 型底座（整体在立柱侧，避免与量筒六角座重叠）——
  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.016, 0.12), cast);
  basePlate.position.set(-0.02, 0.008, 0);
  basePlate.castShadow = true;
  basePlate.receiveShadow = true;
  g.add(basePlate);

  for (const z of [-0.048, 0.048]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.028), cast);
    foot.position.set(-0.02, 0.006, z);
    g.add(foot);
  }
  for (const [x, z] of [
    [-0.08, -0.048],
    [0.04, -0.048],
    [-0.08, 0.048],
    [0.04, 0.048],
  ]) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.012, 0.005, 14),
      Mats.rubber(0x151820)
    );
    pad.position.set(x, 0.0025, z);
    g.add(pad);
  }

  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.024, 24), cast);
  boss.position.set(0, 0.028, 0);
  g.add(boss);

  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, rodH, 24), rodMat);
  rod.position.set(0, 0.036 + rodH / 2, 0);
  rod.castShadow = true;
  g.add(rod);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.011, 14, 12), blackPlastic());
  cap.position.set(0, 0.036 + rodH, 0);
  g.add(cap);

  /** C 形夹：从立柱伸出，在量筒外壁两侧抱紧（全部在玻璃外） */
  function addRingClamp(y) {
    const clamp = new THREE.Group();

    const block = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.028, 0.026), blackPlastic());
    clamp.add(block);

    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.016, 14),
      new THREE.MeshStandardMaterial({
        color: 0xe8a020,
        metalness: 0.05,
        roughness: 0.7,
      })
    );
    knob.rotation.z = Math.PI / 2;
    knob.position.set(-0.022, 0, 0);
    clamp.add(knob);

    // 主臂：立柱 → 量筒外壁（止于筒外）
    const armEndX = rodToCyl - outerR - clearance;
    const armLen = armEndX - 0.012;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, armLen, 12), rodMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0.012 + armLen / 2, 0, 0);
    clamp.add(arm);

    // 弧形夹爪：用水平半环，圆心=量筒轴，半径在筒外
    // Torus 默认在 XY，先绕 X 置水平，再绕 Y 把开口转到 +X 观察侧
    const jaw = new THREE.Mesh(
      new THREE.TorusGeometry(ringR, 0.0042, 10, 40, Math.PI),
      rodMat
    );
    jaw.rotation.x = -Math.PI / 2;
    jaw.rotation.y = Math.PI; // 弧在立柱侧（−x 半周）
    jaw.position.set(rodToCyl, 0, 0);
    clamp.add(jaw);

    const jawPad = new THREE.Mesh(
      new THREE.TorusGeometry(ringR - 0.0005, 0.0026, 8, 32, Math.PI),
      Mats.rubber(0x3a4050)
    );
    jawPad.rotation.x = -Math.PI / 2;
    jawPad.rotation.y = Math.PI;
    jawPad.position.set(rodToCyl, 0, 0);
    clamp.add(jawPad);

    clamp.position.set(0, y, 0);
    g.add(clamp);
  }

  // 夹在量筒中下 / 中上，避开光电门高度
  const midGate = (gateHighLocalY + gateLowLocalY) / 2;
  addRingClamp(Math.min(0.18, gateLowLocalY - 0.1));
  addRingClamp(Math.min(tubeTopY - 0.08, Math.max(midGate + 0.12, gateHighLocalY + 0.08)));

  /**
   * U 形光电门：两臂在量筒 ±z 外侧，连接梁在量筒后方（立柱侧）
   * 光束穿过玻璃中心，但实体不进入液体
   */
  function addPhotoGate(y, color) {
    const gate = new THREE.Group();
    const bodyMat = blackPlastic();

    // 抱柱锁块
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.024, 0.024), bodyMat);
    gate.add(lock);
    const lockKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.012, 12),
      new THREE.MeshStandardMaterial({ color: 0x4d8dff, metalness: 0.05, roughness: 0.65 })
    );
    lockKnob.rotation.z = Math.PI / 2;
    lockKnob.position.set(-0.016, 0, 0);
    gate.add(lockKnob);

    // 从立柱伸向量筒后方的连接臂（止于 bridgeX）
    const railLen = Math.max(0.04, bridgeX - 0.01);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(railLen, 0.012, 0.014), bodyMat);
    rail.position.set(railLen / 2 + 0.01, 0, 0);
    gate.add(rail);

    // 后方连接梁（在筒外）
    const bridgeW = armZ * 2 + 0.02;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.018, bridgeW), bodyMat);
    bridge.position.set(bridgeX, 0, 0);
    bridge.castShadow = true;
    gate.add(bridge);

    // 两侧臂：从后方绕到筒的 ±z 外侧
    for (const side of [-1, 1]) {
      // 侧向延伸段
      const sideArm = new THREE.Mesh(
        new THREE.BoxGeometry(outerR + clearance + 0.02, 0.016, 0.016),
        bodyMat
      );
      sideArm.position.set(
        bridgeX + (outerR + clearance + 0.02) / 2,
        0,
        side * armZ
      );
      sideArm.castShadow = true;
      gate.add(sideArm);

      // 传感器头
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.024, 0.02), bodyMat);
      head.position.set(rodToCyl, 0, side * armZ);
      head.castShadow = true;
      gate.add(head);

      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.005, 14),
        new THREE.MeshStandardMaterial({
          color: 0x1a2030,
          metalness: 0.05,
          roughness: 0.7,
        })
      );
      // 透镜朝向量筒中心
      lens.rotation.x = Math.PI / 2;
      lens.position.set(rodToCyl, 0, side * (armZ - 0.01));
      gate.add(lens);
    }

    // 仅光束穿过筒（半透明细线）
    const beamLen = armZ * 2 - 0.02;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.001, 0.001, beamLen, 6),
      new THREE.MeshStandardMaterial({
        color,
        metalness: 0,
        roughness: 0.9,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    );
    beam.rotation.x = Math.PI / 2;
    beam.position.set(rodToCyl, 0, 0);
    gate.add(beam);

    const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), dullLed(0x3ee0b0));
    led.position.set(rodToCyl + 0.008, 0.012, armZ);
    gate.add(led);

    gate.position.set(0, y, 0);
    g.add(gate);
    return { group: gate, beam, led, y };
  }

  const gateHi = addPhotoGate(gateHighLocalY, 0xff4d6a);
  const gateLo = addPhotoGate(gateLowLocalY, 0x4d9fff);

  // S 间距示意（哑光，无发光）
  const sH = gateHighLocalY - gateLowLocalY;
  const sX = rodToCyl + outerR + 0.02;
  const sBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.0025, sH, 0.0025),
    new THREE.MeshStandardMaterial({ color: 0x4a8a70, metalness: 0, roughness: 0.85 })
  );
  sBar.position.set(sX, (gateHighLocalY + gateLowLocalY) / 2, 0);
  g.add(sBar);
  for (const y of [gateHighLocalY, gateLowLocalY]) {
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.002, 0.002),
      new THREE.MeshStandardMaterial({ color: 0xb89040, metalness: 0, roughness: 0.8 })
    );
    tick.position.set(sX - 0.004, y, 0);
    g.add(tick);
  }

  // 释放漏斗：仅在量筒口上方，不插入筒内
  const dropY = tubeTopY + 0.035;
  const drop = new THREE.Group();
  const dropArmLen = rodToCyl;
  const dropArm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0045, 0.0045, dropArmLen, 12),
    rodMat
  );
  dropArm.rotation.z = Math.PI / 2;
  dropArm.position.set(dropArmLen / 2, 0, 0);
  drop.add(dropArm);

  const dropBlock = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.018, 0.018), blackPlastic());
  drop.add(dropBlock);

  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.0045, 0.022, 18, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xb8c4d4,
      metalness: 0.1,
      roughness: 0.7,
    })
  );
  funnel.position.set(rodToCyl, -0.006, 0);
  drop.add(funnel);

  const funnelRing = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0018, 8, 18), chromeRod());
  funnelRing.rotation.x = Math.PI / 2;
  funnelRing.position.set(rodToCyl, 0.005, 0);
  drop.add(funnelRing);

  drop.position.set(0, dropY, 0);
  g.add(drop);

  return { group: g, gateHi, gateLo, rodToCyl };
}

/** 钢球盒可选规格 (mm) */
const CASE_BALL_MM = [1.5, 2.0, 2.5, 3.0, 4.0];

/**
 * 钢球盒：泡沫穴 + 可拾取钢球 + 盖 + 铭牌
 * @returns {{ group: THREE.Group, slots: Array<{ diameterMm, ball, homeLocal, br }> }}
 */
function buildBallCase(diametersMm = CASE_BALL_MM) {
  const g = new THREE.Group();
  const w = 0.38;
  const d = 0.18;
  const h = 0.048;
  const slots = [];

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.1,
      roughness: 0.65,
    })
  );
  box.position.y = h / 2;
  box.castShadow = true;
  box.receiveShadow = true;
  g.add(box);

  const foam = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.016, 0.018, d - 0.016),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
  );
  foam.position.y = h - 0.006;
  g.add(foam);

  diametersMm.forEach((dm, i) => {
    const n = diametersMm.length;
    const x = ((i + 0.5) / n - 0.5) * (w - 0.06);
    const wellR = 0.024;
    const well = new THREE.Mesh(
      new THREE.CylinderGeometry(wellR, wellR, 0.014, 24),
      new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.9 })
    );
    well.position.set(x, h - 0.003, 0);
    g.add(well);

    const br = Math.max(0.011, Math.min(0.024, (dm / 4.0) * 0.022));
    const ballMat = steelMat();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(br, 32, 24), ballMat);
    const homeLocal = new THREE.Vector3(x, h + br * 0.45, 0);
    ball.position.copy(homeLocal);
    ball.castShadow = true;
    ball.userData.diameterMm = dm;
    ball.userData.pickable = true;
    ball.userData.interactive = true;
    ball.userData.role = 'mechanics_viscosity_ball';
    ball.userData.baseColor = ballMat.color.getHex();

    // Large invisible hit proxy for effortless crosshair aiming and picking
    const hitProxyR = Math.max(0.038, br * 2.4);
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(hitProxyR, 16, 12),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    hit.userData.diameterMm = dm;
    hit.userData.pickable = true;
    hit.userData.interactive = true;
    hit.userData.role = 'mechanics_viscosity_ball';
    hit.userData.isHitProxy = true;
    ball.add(hit);
    g.add(ball);

    // High resolution slot label
    const tCanvas = document.createElement('canvas');
    tCanvas.width = 128;
    tCanvas.height = 64;
    const tctx = tCanvas.getContext('2d');
    tctx.fillStyle = '#f1f5f9';
    tctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    tctx.fillText(`${dm.toFixed(1)} mm`, 64, 32);
    const ttex = new THREE.CanvasTexture(tCanvas);
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.052, 0.026),
      new THREE.MeshBasicMaterial({ map: ttex, transparent: true })
    );
    tag.rotation.x = -Math.PI / 2;
    tag.position.set(x, h + 0.008, d * 0.30);
    g.add(tag);

    slots.push({ diameterMm: dm, ball, homeLocal: homeLocal.clone(), br, hitProxy: hit });
  });

  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.008, d),
    new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.1,
      roughness: 0.65,
    })
  );
  lid.position.set(0, h + 0.035, -d * 0.52);
  lid.rotation.x = -1.15;
  g.add(lid);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.030),
    new THREE.MeshBasicMaterial({
      map: createLabelTexture('STEEL BALLS', '标准精密钢球组 · 拖拽投放'),
      transparent: true,
    })
  );
  plate.position.set(0, h / 2, d / 2 + 0.001);
  g.add(plate);

  return { group: g, slots };
}

/** 数字温度探头：本地原点为手柄附近，探针向下，整体放在筒外 */
function buildTempProbe() {
  const g = new THREE.Group();
  const probe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 0.12, 12),
    chromeRod()
  );
  probe.position.y = 0.04;
  g.add(probe);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.003, 0.01, 12),
    new THREE.MeshStandardMaterial({
      color: 0xc0c8d4,
      metalness: 0.1,
      roughness: 0.7,
    })
  );
  tip.position.y = -0.025;
  g.add(tip);

  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 0.04, 0.012),
    blackPlastic()
  );
  handle.position.y = 0.12;
  g.add(handle);

  const digi = new THREE.Mesh(
    new THREE.PlaneGeometry(0.018, 0.01),
    new THREE.MeshBasicMaterial({ color: 0x1a4030 })
  );
  digi.position.set(0, 0.125, 0.007);
  g.add(digi);

  // 小弹簧夹（示意固定在筒口外壁）
  const clip = new THREE.Mesh(
    new THREE.TorusGeometry(0.01, 0.0025, 8, 16, Math.PI),
    blackPlastic()
  );
  clip.rotation.y = Math.PI / 2;
  clip.position.set(-0.008, 0.09, 0);
  g.add(clip);

  return g;
}

function steelBallMesh(rVis) {
  // 不透明钢球：先写入深度；液体半透明后画，球在液中仍清晰可见
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(rVis, 48, 36),
    new THREE.MeshStandardMaterial({
      color: 0xd8dee8,
      metalness: 0.45,
      roughness: 0.28,
      emissive: 0x445060,
      emissiveIntensity: 0.4,
    })
  );
  m.castShadow = true;
  return m;
}

/* ─────────────────── UI helpers ─────────────────── */

function buildWorkflowUI(container, steps, activeIndex, onStepClick) {
  const wrap = document.createElement('div');
  wrap.className = 'workflow';
  wrap.innerHTML = `<div class="workflow-title">实验流程</div>`;
  const list = document.createElement('ol');
  list.className = 'workflow-steps';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className =
      'workflow-step' + (i === activeIndex ? ' active' : '') + (i < activeIndex ? ' done' : '');
    li.innerHTML = `<span class="idx">${i + 1}</span><span class="txt">${s}</span>`;
    if (onStepClick) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => onStepClick(i));
    }
    list.appendChild(li);
  });
  wrap.appendChild(list);
  container.appendChild(wrap);
  return wrap;
}

function buildActionButtons(container, actions) {
  const row = document.createElement('div');
  row.className = 'action-row';
  const buttons = {};
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`;
    btn.textContent = a.label;
    btn.disabled = !!a.disabled;
    btn.addEventListener('click', a.onClick);
    row.appendChild(btn);
    buttons[a.id] = btn;
  }
  container.appendChild(row);
  return buttons;
}

function buildDataTable(container) {
  const wrap = document.createElement('div');
  wrap.className = 'data-table-wrap';
  wrap.innerHTML = `
    <div class="workflow-title">数据记录</div>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>d/mm</th>
          <th>Δt/s</th>
          <th>v/(m·s⁻¹)</th>
          <th>η/(Pa·s)</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div class="data-summary"></div>
  `;
  container.appendChild(wrap);
  return {
    tbody: wrap.querySelector('tbody'),
    summary: wrap.querySelector('.data-summary'),
    wrap,
  };
}

/* ─────────────────── experiment ─────────────────── */

export const viscosity = {
  id: 'viscosity',
  name: '落球法测粘滞系数',
  meta: 'Stokes 落球 · 光电门计时 · Ladenburg 修正',
  description:
    '落球法测液体黏度：钢球在黏性液体中下落至收尾速度，用光电门测速，结合斯托克斯公式与管壁修正求黏滞系数 η。按流程完成测径、投放、计时与数据处理。',

  setup(engine, ui, overrides = {}) {
    const params = {
      liquid: 'glycerin',
      diameterMm: 2.5,
      temperature: 20,
      tubeDiameterMm: 50,
      measureS: 0.2,
      timeScale: 6,
      // null = 球都在盒子里，尚未放到漏斗
      _placedBallMm: null,
      ...overrides,
    };

    // 物理量可随「从盒中取球」动态更新
    let r = params.diameterMm / 2000;
    const R = params.tubeDiameterMm / 2000;
    const rhoBall = STEEL_RHO;
    const liquid = LIQUIDS[params.liquid];
    const rhoLiq = liquid.rho;
    const etaTrue = etaAtTemp(params.liquid, params.temperature);
    let vInf = terminalVelocity(r, rhoBall, rhoLiq, etaTrue);
    let wallFactor = 1 + 2.4 * (r / R);
    let vTerm = vInf / wallFactor;
    let mass = (4 / 3) * Math.PI * r * r * r * rhoBall;
    let volume = (4 / 3) * Math.PI * r * r * r;

    engine.world.gravity.set(0, 0, 0);
    const { surfaceY } = addSimpleGround(engine, { size: 26, color: 0x0e1628 });

    // Host adaptation requested by the user: use the existing mechanics table
    // instead of nesting the source project's dark lab bench inside it.
    const by = surfaceY + 0.93;

    // —— 视觉尺寸：细长量筒 ——
    const innerRVis = 0.038;
    const wallVis = 0.0026;
    const cylH = 0.88;
    const liquidH = 0.74;

    // 立柱与量筒拉开间距，避免底座/夹具重叠
    const originX = -0.12;
    const originZ = 0.08;
    const rodToCyl = 0.145;

    const cyl = buildMeasuringCylinder({
      innerR: innerRVis,
      wall: wallVis,
      height: cylH,
      liquidH,
      liquidKey: params.liquid,
    });
    const cylX = originX + rodToCyl;
    const cylZ = originZ;
    cyl.group.position.set(cylX, by, cylZ);
    engine.addStaticMesh(cyl.group);

    // 外置标尺：量筒右侧，尺面固定朝前（+Z），不随视角旋转
    const rulerW = 0.058;
    const ruler = buildExternalRuler({
      height: liquidH,
      width: rulerW,
      thickness: 0.012,
      liquidBottomY: cyl.liquidBottomY,
    });
    ruler.position.set(cylX + cyl.outerR + rulerW / 2 + 0.025, by, cylZ + 0.01);
    // rotation.y = 0 → 正面法线 +Z（向前）
    engine.addStaticMesh(ruler);

    const liquidBottom = by + cyl.liquidBottomY;
    const liquidTop = by + cyl.liquidTopY;
    const physLiquidH = 0.5;
    const yMap = (physY) => liquidBottom + (physY / physLiquidH) * liquidH;

    const physGateLow = 0.12;
    const physGateHigh = physGateLow + params.measureS;
    const gateHighY = yMap(physGateHigh);
    const gateLowY = yMap(physGateLow);

    const stand = buildRetortStand({
      rodH: 1.02,
      rodToCyl,
      outerR: cyl.outerR,
      gateHighLocalY: gateHighY - by,
      gateLowLocalY: gateLowY - by,
      tubeTopY: cyl.topY,
    });
    stand.group.position.set(originX, by, originZ);
    engine.addStaticMesh(stand.group);

    const gateHi = stand.gateHi;
    const gateLo = stand.gateLo;

    // 台面辅件：钢球盒与量筒共轴对齐（同在 Z = cylZ 垂直工作平面内）
    const ballCase = buildBallCase(CASE_BALL_MM);
    const caseW = 0.38;
    const caseX = originX - 0.28 - caseW / 2;
    const caseZ = cylZ;
    ballCase.group.position.set(caseX, by, caseZ);
    ballCase.group.rotation.y = 0;
    ballCase.slots.forEach((slot) => {
      slot.ball.userData.interactive = true;
      slot.ball.userData.role = 'mechanics_viscosity_ball';
      slot.ball.userData.diameterMm = slot.diameterMm;
    });
    engine.addStaticMesh(ballCase.group);

    const probe = buildTempProbe();
    probe.position.set(
      cylX + cyl.outerR + 0.012,
      liquidTop - 0.1,
      cylZ + 0.02
    );
    probe.rotation.y = -0.15;
    engine.addStaticMesh(probe);

    // 活动钢球：视觉放大；初始在盒中时隐藏，取出后放漏斗口
    function visRadiusFor(dm) {
      const rr = dm / 2000;
      return Math.min(innerRVis * 0.42, Math.max(0.012, innerRVis * (rr / R) * 4.8));
    }
    let rVis = visRadiusFor(params.diameterMm);
    const ball = steelBallMesh(rVis);
    ball.userData.interactive = true;
    ball.userData.role = 'mechanics_viscosity_ball';
    let dropY = by + cyl.topY + rVis + 0.01;
    const physDropY = physLiquidH + 0.05;
    ball.position.set(cylX, dropY, cylZ);
    const ballPlaced = params._placedBallMm != null;
    ball.visible = ballPlaced;
    engine.scene.add(ball);
    engine.meshes.push(ball);

    const trail = engine.createTrail(0xe8c060, 160);

    // 机位：正对共线装置（盒—架—筒），略偏右看清标尺
    const midX = (caseX + cylX) / 2;
    engine.setCamera([midX + 0.08, by + 0.7, cylZ + 1.55], [midX + 0.05, by + 0.38, cylZ]);

    const STEPS = [
      '选择液体与温度',
      '从钢球盒取球',
      '确认量筒与间距 S',
      '释放钢球并计时',
      '计算粘滞系数 η',
      '记录多次取平均',
    ];

    let step = ballPlaced ? 1 : 0;
    let phase = 'ready';
    let simY = dropY;
    let physY = physDropY;
    let vel = 0;
    let tGateHigh = null;
    let tGateLow = null;
    let measuredDt = null;
    let measuredV = null;
    let measuredEta = null;
    let clockT = 0;
    let records = Array.isArray(overrides._records) ? [...overrides._records] : [];
    let gateHiTriggered = false;
    let gateLoTriggered = false;
    let splash = 0;
    let hoverSlot = null;
    let hostDragProgress = 0;
    let hostDragStart = new THREE.Vector3(caseX, by + 0.12, caseZ);

    // 漏斗落点示意环（拖近时高亮）
    const funnelHint = new THREE.Mesh(
      new THREE.TorusGeometry(innerRVis * 0.55, 0.003, 8, 40),
      new THREE.MeshBasicMaterial({
        color: 0x5ec8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    funnelHint.rotation.x = Math.PI / 2;
    funnelHint.position.set(cylX, by + cyl.topY + 0.02, cylZ);
    engine.scene.add(funnelHint);
    engine.meshes.push(funnelHint);

    function recomputePhysics(dm) {
      params.diameterMm = dm;
      r = dm / 2000;
      mass = (4 / 3) * Math.PI * r * r * r * rhoBall;
      volume = (4 / 3) * Math.PI * r * r * r;
      wallFactor = 1 + 2.4 * (r / R);
      vInf = terminalVelocity(r, rhoBall, rhoLiq, etaTrue);
      vTerm = vInf / wallFactor;
      rVis = visRadiusFor(dm);
      dropY = by + cyl.topY + rVis + 0.01;
      ball.geometry.dispose();
      ball.geometry = new THREE.SphereGeometry(rVis, 48, 36);
      funnelHint.position.y = by + cyl.topY + 0.02;
    }

    function syncCaseVisibility() {
      const placed = params._placedBallMm;
      for (const slot of ballCase.slots) {
        const isTaken =
          placed != null &&
          Math.abs(slot.diameterMm - placed) < 0.05 &&
          ball.visible;
        slot.ball.visible = !isTaken;
        if (!isTaken && slot.ball.material?.emissive) {
          slot.ball.material.emissive.setHex(0x000000);
          slot.ball.material.emissiveIntensity = 0;
          slot.ball.scale.setScalar(1);
        }
      }
    }

    function slotWorldPos(slot) {
      const v = slot.homeLocal.clone();
      ballCase.group.localToWorld(v);
      return v;
    }

    /** 放回钢球盒 */
    function returnBallToCase() {
      if (phase === 'falling') return;
      // dragging 结束时也会调用，允许从 dragging 回收
      if (!ball.visible && params._placedBallMm == null) return;
      const dm = params._placedBallMm;
      const slot = ballCase.slots.find((s) => Math.abs(s.diameterMm - dm) < 0.05);
      ball.visible = false;
      params._placedBallMm = null;
      if (slot) {
        slot.ball.visible = true;
        slot.ball.position.copy(slot.homeLocal);
        slot.ball.scale.setScalar(1);
      }
      syncCaseVisibility();
      phase = 'ready';
      vel = 0;
      funnelHint.material.opacity = 0;
      if (buttons) {
        buttons.drop.disabled = true;
        buttons.drop.textContent = '释放钢球';
        buttons.returnBtn.disabled = true;
      }
      engine.clearTrail(trail);
      updateFormula();
    }

    function placeAtFunnelInstant() {
      ball.visible = true;
      ball.position.set(cylX, dropY, cylZ);
      simY = dropY;
      physY = physDropY;
      vel = 0;
      phase = 'ready';
      funnelHint.material.opacity = 0;
      if (buttons) {
        buttons.drop.disabled = false;
        buttons.drop.textContent = '释放钢球';
        buttons.returnBtn.disabled = false;
      }
      syncCaseVisibility();
    }

    function distXZ(ax, az, bx, bz) {
      return Math.hypot(ax - bx, az - bz);
    }

    function nearFunnel(pos, radius = 0.14) {
      // 水平距离为主：拖拽平面较高，不卡 y
      return distXZ(pos.x, pos.z, cylX, cylZ) < radius;
    }

    function nearCase(pos, radius = 0.18) {
      return distXZ(pos.x, pos.z, caseX, caseZ) < radius;
    }

    // ─── 拖拽：球始终贴在鼠标下（固定深度 unproject） ───
    const pointerNdc = new THREE.Vector2();
    const _proj = new THREE.Vector3();
    const _unproj = new THREE.Vector3();
    const canvas = engine.canvas;
    /** @type {null | { dm: number, depth: number, pointerId: number }} */
    let dragState = null;
    let diameterSlider = null;
    const PICK_PX = 36;

    function setPointerNdc(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
      return rect;
    }

    function projectToScreen(worldPos, rect) {
      _proj.copy(worldPos).project(engine.camera);
      return {
        x: (_proj.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-_proj.y * 0.5 + 0.5) * rect.height + rect.top,
        ndcZ: _proj.z,
      };
    }

    /**
     * 鼠标位置 → 世界坐标（保持抓取时的相机深度，球永远在指针正下方）
     */
    function mouseToWorld(clientX, clientY, depth) {
      setPointerNdc(clientX, clientY);
      _unproj.set(pointerNdc.x, pointerNdc.y, depth);
      _unproj.unproject(engine.camera);
      return _unproj;
    }

    /**
     * 世界点在相机裁剪空间中的深度（用于 unproject 跟手）
     */
    function worldDepth(worldPos) {
      _proj.copy(worldPos).project(engine.camera);
      return _proj.z;
    }

    /**
     * @returns {{ kind: 'case', slot } | { kind: 'active' } | null}
     */
    function pickInteractive(clientX, clientY) {
      engine.scene.updateMatrixWorld(true);
      const rect = canvas.getBoundingClientRect();
      let best = null;
      let bestD = PICK_PX;

      for (const slot of ballCase.slots) {
        if (!slot.ball.visible) continue;
        const w = slotWorldPos(slot);
        const s = projectToScreen(w, rect);
        if (s.ndcZ < -1 || s.ndcZ > 1) continue;
        const d = Math.hypot(s.x - clientX, s.y - clientY);
        if (d < bestD) {
          bestD = d;
          best = { kind: 'case', slot };
        }
      }

      if (ball.visible && phase !== 'falling') {
        const s = projectToScreen(ball.position, rect);
        if (s.ndcZ >= -1 && s.ndcZ <= 1) {
          const d = Math.hypot(s.x - clientX, s.y - clientY);
          if (d < bestD) {
            bestD = d;
            best = { kind: 'active' };
          }
        }
      }
      return best;
    }

    function lockOrbit() {
      engine.controls.enabled = false;
    }

    function unlockOrbit() {
      engine.controls.enabled = true;
    }

    function clearHover() {
      if (hoverSlot) {
        hoverSlot.ball.material.emissive?.setHex(0x000000);
        hoverSlot.ball.material.emissiveIntensity = 0;
        hoverSlot.ball.scale.setScalar(1);
        hoverSlot = null;
      }
    }

    /** 每帧：球心 = 鼠标反投影点（真正跟手） */
    function stickBallToMouse(clientX, clientY) {
      if (!dragState) return;
      const w = mouseToWorld(clientX, clientY, dragState.depth);
      ball.position.copy(w);
      // 不要穿进台面
      if (ball.position.y < by + 0.03) ball.position.y = by + 0.03;
      const over = nearFunnel(ball.position, 0.14);
      funnelHint.material.opacity = over ? 0.95 : 0.4;
      funnelHint.material.color.setHex(over ? 0x6dffb0 : 0x5ec8ff);
    }

    function startDragging(dm, startWorld, clientX, clientY, pointerId) {
      // 以抓取点深度为基准；球立刻贴到指针下并保持深度
      const depth = worldDepth(startWorld);

      ball.visible = true;
      ball.scale.setScalar(1.2);
      dragState = { dm, depth, pointerId };
      phase = 'dragging';
      vel = 0;
      engine.clearTrail(trail);
      lockOrbit();
      canvas.style.cursor = 'grabbing';
      funnelHint.material.opacity = 0.45;

      if (buttons) {
        buttons.drop.disabled = true;
        buttons.drop.textContent = '拖到漏斗…';
        buttons.returnBtn.disabled = true;
      }
      step = Math.max(step, 1);
      refreshWorkflow();
      updateFormula();

      // 第一帧就贴在鼠标下
      stickBallToMouse(clientX, clientY);
    }

    function beginDragFromCase(slot, clientX, clientY, pointerId) {
      const dm = slot.diameterMm;
      if (
        params._placedBallMm != null &&
        Math.abs(params._placedBallMm - dm) > 0.05 &&
        ball.visible
      ) {
        const prev = ballCase.slots.find(
          (s) => Math.abs(s.diameterMm - params._placedBallMm) < 0.05
        );
        if (prev) {
          prev.ball.visible = true;
          prev.ball.position.copy(prev.homeLocal);
        }
      }

      recomputePhysics(dm);
      params._placedBallMm = dm;
      if (diameterSlider) diameterSlider.value = dm;

      const world = slotWorldPos(slot);
      slot.ball.visible = false;
      clearHover();
      startDragging(dm, world, clientX, clientY, pointerId);
    }

    function beginDragActiveBall(clientX, clientY, pointerId) {
      if (!ball.visible) return;
      const dm = params._placedBallMm ?? params.diameterMm;
      startDragging(dm, ball.position.clone(), clientX, clientY, pointerId);
    }

    /** 放到漏斗口并立刻开始下落（拖到量筒上方松开即落） */
    function dropIntoCylinder(dm) {
      params._placedBallMm = dm;
      if (diameterSlider) diameterSlider.value = dm;
      recomputePhysics(dm);
      ball.visible = true;
      ball.scale.setScalar(1);
      ball.position.set(cylX, dropY, cylZ);
      simY = dropY;
      physY = physDropY;
      vel = 0;
      funnelHint.material.opacity = 0;
      syncCaseVisibility();
      step = Math.max(step, 3);
      refreshWorkflow();
      // startDrop 在下方定义（function 声明会提升）
      startDrop();
    }

    function endDrag() {
      if (!dragState) return;
      const pos = ball.position.clone();
      const dm = dragState.dm;
      dragState = null;
      ball.scale.setScalar(1);
      unlockOrbit();
      canvas.style.cursor = '';
      funnelHint.material.opacity = 0;

      // 靠近量筒/漏斗 → 松开即下落
      if (nearFunnel(pos, 0.16)) {
        dropIntoCylinder(dm);
      } else if (nearCase(pos, 0.18)) {
        returnBallToCase();
      } else {
        const dFunnel = distXZ(pos.x, pos.z, cylX, cylZ);
        const dCase = distXZ(pos.x, pos.z, caseX, caseZ);
        if (dFunnel <= dCase + 0.02) {
          dropIntoCylinder(dm);
        } else {
          returnBallToCase();
        }
      }
    }

    function onPointerDown(ev) {
      if (ev.button !== 0) return;
      if (phase === 'falling' || phase === 'dragging') return;

      const hit = pickInteractive(ev.clientX, ev.clientY);
      if (!hit) return;

      ev.preventDefault();
      ev.stopImmediatePropagation();
      lockOrbit();

      if (hit.kind === 'active') {
        beginDragActiveBall(ev.clientX, ev.clientY, ev.pointerId);
      } else {
        beginDragFromCase(hit.slot, ev.clientX, ev.clientY, ev.pointerId);
      }

      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (_) {
        /* ignore */
      }
    }

    function onPointerMove(ev) {
      // 拖拽中：球每帧贴鼠标
      if (dragState && phase === 'dragging') {
        ev.preventDefault();
        stickBallToMouse(ev.clientX, ev.clientY);
        canvas.style.cursor = 'grabbing';
        return;
      }

      if (phase === 'falling') {
        canvas.style.cursor = '';
        return;
      }

      const hit = pickInteractive(ev.clientX, ev.clientY);
      clearHover();
      if (hit?.kind === 'case') {
        hoverSlot = hit.slot;
        hit.slot.ball.material.emissive?.setHex(0x6688aa);
        hit.slot.ball.material.emissiveIntensity = 0.55;
        hit.slot.ball.scale.setScalar(1.3);
        canvas.style.cursor = 'grab';
      } else if (hit?.kind === 'active') {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = '';
      }
    }

    function onPointerUp(ev) {
      if (ev.button !== 0) return;
      if (phase === 'dragging' && dragState) {
        try {
          canvas.releasePointerCapture(ev.pointerId);
        } catch (_) {
          /* ignore */
        }
        endDrag();
      }
    }

    function onPointerCancel() {
      if (phase === 'dragging' && dragState) endDrag();
    }

    canvas.addEventListener('pointerdown', onPointerDown, true);
    // document 级 move/up：拖出画布仍跟手
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';

    ui.controls.innerHTML = '';

    const workflowEl = buildWorkflowUI(ui.controls, STEPS, step, (i) => {
      if (i <= step) {
        step = i;
        refreshWorkflow();
        updateFormula();
      }
    });

    // 取球提示
    const tip = document.createElement('div');
    tip.className = 'control muted';
    tip.style.cssText = 'font-size:12px;line-height:1.45;opacity:0.85;margin-bottom:6px;';
    tip.innerHTML =
      '✋ <strong>从钢球盒拖到量筒上方松开，球会立刻下落</strong>；拖回盒子可换球。拖动时视角锁定。';
    ui.controls.appendChild(tip);

    liveSelect(ui, params, 'liquid', {
      id: 'liquid',
      label: '待测液体',
      options: Object.entries(LIQUIDS).map(([k, v]) => ({ value: k, label: v.label })),
    });

    liveSlider(ui, params, 'temperature', {
      id: 'temp',
      label: '温度 t',
      min: 10,
      max: 40,
      step: 1,
      unit: ' °C',
    });

    // 直径：滑块改值时同步「放置」状态，不整场景重建（避免打断取球）
    diameterSlider = createSlider(ui.controls, {
      id: 'd',
      label: '钢球直径 d',
      min: 1.0,
      max: 5.0,
      step: 0.1,
      unit: ' mm',
      value: params.diameterMm,
      onChange: (v) => {
        if (phase === 'falling' || phase === 'dragging') {
          diameterSlider.value = params.diameterMm;
          return;
        }
        recomputePhysics(v);
        // 滑块对应标准规格则视为从盒中取出该球
        const catalog = CASE_BALL_MM.find((x) => Math.abs(x - v) < 0.05);
        params._placedBallMm = catalog ?? v;
        if (!ball.visible) placeAtFunnelInstant();
        else {
          ball.position.set(cylX, dropY, cylZ);
          simY = dropY;
        }
        syncCaseVisibility();
        step = Math.max(step, 1);
        refreshWorkflow();
        updateFormula();
        buttons.drop.disabled = false;
        buttons.returnBtn.disabled = false;
      },
    });

    liveSlider(ui, params, 'tubeDiameterMm', {
      id: 'tube',
      label: '量筒内径 D',
      min: 30,
      max: 80,
      step: 1,
      unit: ' mm',
    });

    liveSlider(ui, params, 'measureS', {
      id: 'S',
      label: '光电门间距 S',
      min: 0.1,
      max: 0.3,
      step: 0.01,
      unit: ' m',
    });

    liveSlider(ui, params, 'timeScale', {
      id: 'ts',
      label: '仿真加速',
      min: 1,
      max: 12,
      step: 1,
      unit: ' ×',
    });

    const buttons = buildActionButtons(ui.controls, [
      {
        id: 'drop',
        label: '释放钢球',
        primary: true,
        onClick: () => {
          if (phase === 'falling' || phase === 'dragging') return;
          if (!ball.visible) return;
          step = Math.max(step, 3);
          refreshWorkflow();
          startDrop();
        },
      },
      {
        id: 'returnBtn',
        label: '放回钢球盒',
        onClick: () => returnBallToCase(),
      },
      {
        id: 'record',
        label: '记录数据',
        onClick: () => {
          if (measuredEta == null || !Number.isFinite(measuredEta)) return;
          records.push({
            d: params.diameterMm,
            dt: measuredDt,
            v: measuredV,
            eta: measuredEta,
          });
          step = 5;
          refreshWorkflow();
          refreshTable();
          updateFormula();
        },
      },
      {
        id: 'clear',
        label: '清空记录',
        danger: true,
        onClick: () => {
          records = [];
          refreshTable();
        },
      },
    ]);

    // 初始：未取球则禁用释放；重建时若已放置则放到漏斗
    if (ballPlaced) {
      recomputePhysics(params._placedBallMm);
      diameterSlider.value = params.diameterMm;
      placeAtFunnelInstant();
    } else {
      buttons.drop.disabled = true;
      buttons.returnBtn.disabled = true;
      syncCaseVisibility();
    }

    const table = buildDataTable(ui.controls);

    function refreshWorkflow() {
      workflowEl.querySelectorAll('.workflow-step').forEach((el, i) => {
        el.classList.toggle('active', i === step);
        el.classList.toggle('done', i < step);
      });
    }

    function refreshTable() {
      table.tbody.innerHTML = records
        .map(
          (row, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${formatNum(row.d, 1)}</td>
          <td>${formatNum(row.dt, 3)}</td>
          <td>${formatNum(row.v, 5)}</td>
          <td>${formatNum(row.eta, 4)}</td>
        </tr>`
        )
        .join('');
      if (records.length) {
        const avg = records.reduce((s, row) => s + row.eta, 0) / records.length;
        const err = ((avg - etaTrue) / etaTrue) * 100;
        table.summary.innerHTML = `
          <div>平均 η = <strong>${formatNum(avg, 4)}</strong> Pa·s</div>
          <div>理论 η(t) = <strong>${formatNum(etaTrue, 4)}</strong> Pa·s · 相对误差 <strong>${formatNum(err, 1)}%</strong></div>
        `;
      } else {
        table.summary.innerHTML = '<div class="muted">完成一次计时后点击「记录数据」</div>';
      }
    }

    function updateFormula() {
      const dMm = params.diameterMm;
      const texts = [
        `<strong>原理 · 落球法测黏度</strong><br/>
         钢球达收尾速度时：重力 = 浮力 + 黏滞阻力<br/>
         <code>f = 6πηrv</code>（斯托克斯公式）<br/>
         <code>η = 2r²(ρ−ρ₀)g / [9v(1+2.4r/R)]</code><br/>
         <span style="opacity:.75">括号内为管壁修正；要求雷诺数很小</span>`,
        `<strong>步骤 2 · 从钢球盒取球</strong><br/>
         <span style="color:#8ec8ff">拖到量筒上方松开 → 自动下落</span><br/>
         当前 <code>d = ${formatNum(dMm, 1)} mm</code>，
         <code>r = ${formatNum(r * 1000, 2)} mm</code><br/>
         钢球密度 ρ = ${STEEL_RHO} kg/m³<br/>
         ${
           phase === 'falling'
             ? '<span style="opacity:.8">下落计时中…</span>'
             : params._placedBallMm == null || !ball.visible
               ? '<span style="opacity:.8">请从盒子拖球到量筒上方（圆环变绿时松开）</span>'
               : `<span style="opacity:.8">已放置 d=${formatNum(params._placedBallMm, 1)} mm</span>`
         }`,
        `<strong>步骤 3 · 装置确认</strong><br/>
         量筒内半径 <code>R = ${formatNum(R * 1000, 1)} mm</code><br/>
         光电门间距 <code>S = ${formatNum(params.measureS, 2)} m</code><br/>
         液体密度 ρ₀ = ${rhoLiq} kg/m³ · ${liquid.label}`,
        `<strong>步骤 4 · 落球计时</strong><br/>
         自液面中心释放，待进入匀速段后<br/>
         上、下光电门触发，<code>v = S / Δt</code><br/>
         理论终端速度 <code>v∞ ≈ ${formatNum(vTerm * 1000, 2)} mm/s</code>`,
        `<strong>步骤 5 · 计算 η</strong><br/>
         ${
           measuredEta != null
             ? `测得 Δt = ${formatNum(measuredDt, 3)} s，v = ${formatNum(measuredV, 5)} m/s<br/>
                <code>η<sub>测</sub> = ${formatNum(measuredEta, 4)} Pa·s</code><br/>
                理论值 η(t=${params.temperature}°C) = ${formatNum(etaTrue, 4)} Pa·s`
             : '请先释放钢球完成一次计时'
         }`,
        `<strong>步骤 6 · 数据处理</strong><br/>
         换不同直径钢球重复 3–5 次，求 η 平均值<br/>
         已记录 <code>${records.length}</code> 组 · 注意恒温与气泡`,
      ];
      setFormula(ui.formula, texts[Math.min(step, texts.length - 1)]);
    }

    function startDrop() {
      if (!ball.visible) return;
      phase = 'falling';
      clockT = 0;
      vel = 0;
      physY = physDropY;
      simY = dropY;
      ball.position.set(cylX, simY, cylZ);
      tGateHigh = null;
      tGateLow = null;
      measuredDt = null;
      measuredV = null;
      measuredEta = null;
      gateHiTriggered = false;
      gateLoTriggered = false;
      splash = 0;
      gateHi.led.material = dullLed(0x3ee0b0);
      gateLo.led.material = dullLed(0x3ee0b0);
      gateHi.beam.material.opacity = 0.28;
      gateLo.beam.material.opacity = 0.28;
      engine.clearTrail(trail);
      buttons.drop.disabled = true;
      buttons.drop.textContent = '下落中…';
      buttons.returnBtn.disabled = true;
      updateFormula();
    }

    /** Host pointer-lock adapter: track 3D crosshair raycast in world space and stick ball to crosshair in vertical plane */
    const _invMat = new THREE.Matrix4();
    const _localRayOrigin = new THREE.Vector3();
    const _localRayDir = new THREE.Vector3();

    function positionBallFromRay(raycaster, rootObj) {
      if (!raycaster?.ray) return false;
      if (rootObj) {
        rootObj.updateMatrixWorld(true);
        _invMat.copy(rootObj.matrixWorld).invert();
        _localRayOrigin.copy(raycaster.ray.origin).applyMatrix4(_invMat);
        _localRayDir.copy(raycaster.ray.direction).transformDirection(_invMat).normalize();
      } else {
        _localRayOrigin.copy(raycaster.ray.origin);
        _localRayDir.copy(raycaster.ray.direction).normalize();
      }

      // Intersect with vertical plane Z = cylZ (perpendicular to ground, parallel to desk X axis)
      const targetPlaneZ = cylZ;
      if (Math.abs(_localRayDir.z) > 0.0001) {
        const t = (targetPlaneZ - _localRayOrigin.z) / _localRayDir.z;
        if (t > 0 && t < 30) {
          const targetX = THREE.MathUtils.clamp(
            _localRayOrigin.x + _localRayDir.x * t,
            caseX - 0.25,
            cylX + 0.35
          );
          const targetY = THREE.MathUtils.clamp(
            _localRayOrigin.y + _localRayDir.y * t,
            by + 0.02,
            by + cyl.topY + 0.28
          );
          ball.position.set(targetX, targetY, targetPlaneZ);
          return true;
        }
      }

      // Fallback if ray is nearly parallel: project along ray
      const fallbackT = THREE.MathUtils.clamp((targetPlaneZ - _localRayOrigin.z) / Math.min(-0.1, _localRayDir.z), 0.5, 3.0);
      ball.position.set(
        THREE.MathUtils.clamp(_localRayOrigin.x + _localRayDir.x * fallbackT, caseX - 0.25, cylX + 0.35),
        THREE.MathUtils.clamp(_localRayOrigin.y + _localRayDir.y * fallbackT, by + 0.02, by + cyl.topY + 0.28),
        targetPlaneZ
      );
      return true;
    }

    function beginHostBallDrag(dm = params._placedBallMm ?? params.diameterMm, context = {}, rootObj = null) {
      if (phase === 'falling') return false;
      const diameter = Number(dm);
      recomputePhysics(diameter);
      params._placedBallMm = diameter;
      if (diameterSlider) diameterSlider.value = diameter;
      const slot = ballCase.slots.find((s) => Math.abs(s.diameterMm - diameter) < 0.05);
      if (slot) slot.ball.visible = false;
      hostDragStart = new THREE.Vector3(caseX, by + 0.06, cylZ);
      ball.visible = true;
      ball.scale.setScalar(1.25);
      ball.position.copy(hostDragStart);
      phase = 'dragging';
      hostDragProgress = 0;
      vel = 0;
      engine.clearTrail(trail);
      funnelHint.material.opacity = 0.45;
      step = Math.max(step, 1);
      refreshWorkflow();
      updateFormula();
      syncCaseVisibility();

      if (context?.raycaster) {
        positionBallFromRay(context.raycaster, rootObj);
      }
      return true;
    }

    function updateHostBallDrag(totalX = 0, totalY = 0, context = {}, rootObj = null) {
      if (phase !== 'dragging') return false;
      let rayMoved = false;
      if (context?.raycaster) {
        rayMoved = positionBallFromRay(context.raycaster, rootObj);
      }

      if (!rayMoved) {
        hostDragProgress = THREE.MathUtils.clamp(
          Math.max(Math.abs(Number(totalX) || 0) / 150, Math.abs(Number(totalY) || 0) / 110),
          0,
          1,
        );
        const target = new THREE.Vector3(cylX, dropY, cylZ);
        ball.position.lerpVectors(hostDragStart, target, hostDragProgress);
      }

      const funnelMouthY = by + cyl.topY;
      const dX = Math.abs(ball.position.x - cylX);
      const dY = ball.position.y - funnelMouthY;
      const isNearFunnel = dX < 0.14 && dY >= -0.06 && dY <= 0.26;

      // Magnetic snap effect when close to funnel mouth
      if (dX < 0.06 && dY >= -0.04 && dY <= 0.16) {
        ball.position.x = THREE.MathUtils.lerp(ball.position.x, cylX, 0.45);
        ball.position.y = THREE.MathUtils.lerp(ball.position.y, funnelMouthY + 0.02, 0.45);
      }

      funnelHint.material.opacity = isNearFunnel ? 0.95 : 0.45;
      funnelHint.material.color.setHex(isNearFunnel ? 0x4ade80 : 0x38bdf8);
      return true;
    }

    function endHostBallDrag(cancelled = false, context = {}, rootObj = null) {
      if (phase !== 'dragging') return false;
      ball.scale.setScalar(1);
      funnelHint.material.opacity = 0;

      const funnelMouthY = by + cyl.topY;
      const dX = Math.abs(ball.position.x - cylX);
      const dY = ball.position.y - funnelMouthY;
      const canDrop = !cancelled && dX < 0.16 && dY >= -0.08 && dY <= 0.30;

      if (canDrop) {
        dropIntoCylinder(params._placedBallMm ?? params.diameterMm);
      } else {
        returnBallToCase();
      }
      hostDragProgress = 0;
      return true;
    }

    function physToVisY(py) {
      if (py >= physLiquidH) {
        // 空气段：物理 [physLiquidH, physDropY] → 视觉 [liquidTop, dropY]
        const airSpan = Math.max(physDropY - physLiquidH, 1e-6);
        const t = Math.min(1.2, (py - physLiquidH) / airSpan);
        return liquidTop + t * (dropY - liquidTop);
      }
      return liquidBottom + (py / physLiquidH) * liquidH;
    }

    refreshTable();
    updateFormula();

    return {
      getParams() {
        return { ...params, _records: records, _placedBallMm: params._placedBallMm };
      },
      dispose() {
        if (dragState) {
          dragState = null;
          unlockOrbit();
        }
        canvas.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('pointermove', onPointerMove, true);
        document.removeEventListener('pointerup', onPointerUp, true);
        document.removeEventListener('pointercancel', onPointerCancel, true);
        canvas.style.cursor = '';
        canvas.style.touchAction = '';
      },
      hostAction(action) {
        // Soft reset for host experiment switch — never fall through to
        // dispose+build (that was a multi-second first-open freeze).
        if (action === 'reset') {
          try {
            if (phase === 'falling') {
              // Abort fall without geometry rebuild.
              phase = 'ready';
              vel = 0;
            }
            if (typeof returnBallToCase === 'function') {
              // Prefer clean funnel-empty state when a ball was in play.
              if (ball.visible || params._placedBallMm != null) {
                // returnBallToCase no-ops while falling — force ready first.
                phase = phase === 'falling' ? 'ready' : phase;
                returnBallToCase();
              }
            }
            if (typeof engine?.clearTrail === 'function' && trail) {
              engine.clearTrail(trail);
            }
            if (typeof updateFormula === 'function') updateFormula();
            return true;
          } catch {
            return true; // still soft — host must not hard-rebuild
          }
        }
        const button = buttons?.[action];
        if (!button || button.disabled) return false;
        button.click();
        return true;
      },
      beginHostBallDrag,
      updateHostBallDrag,
      endHostBallDrag,
      tick(dt) {
        const scale = params.timeScale;

        if (phase === 'falling') {
          // 粘滞阻力阻尼极强（τ≈ms），显式欧拉不稳定 → 隐式积分
          // m·dv/dt = F0 − b·v ，其中 F0 = −mg + 浮力，b = 6π η r (1+2.4 r/R)
          const sub = Math.max(8, Math.ceil(scale * 4));
          const h = (dt * scale) / sub;
          for (let i = 0; i < sub; i++) {
            const prevY = physY;
            clockT += h;
            const inLiquid = physY < physLiquidH;

            // 重力（向下为负）+ 液体中浮力
            let F0 = -mass * G;
            let b = 0;
            if (inLiquid) {
              F0 += volume * rhoLiq * G;
              b = 6 * Math.PI * etaTrue * r * wallFactor;
            }

            // 隐式欧拉：v⁺ = (v + (F0/m)·h) / (1 + (b/m)·h)  — 线性阻力无条件稳定
            const invM = 1 / mass;
            vel = (vel + F0 * invM * h) / (1 + b * invM * h);
            physY += vel * h;

            if (!gateHiTriggered && prevY > physGateHigh && physY <= physGateHigh && vel < 0) {
              gateHiTriggered = true;
              tGateHigh = clockT;
              gateHi.led.material = dullLed(0xc48820);
              gateHi.beam.material.opacity = 0.4;
            }
            if (
              gateHiTriggered &&
              !gateLoTriggered &&
              prevY > physGateLow &&
              physY <= physGateLow &&
              vel < 0
            ) {
              gateLoTriggered = true;
              tGateLow = clockT;
              gateLo.led.material = dullLed(0x3a9a70);
              measuredDt = Math.max(tGateLow - tGateHigh, 1e-6);
              measuredV = params.measureS / measuredDt;
              measuredEta = viscosityFromV(r, R, rhoBall, rhoLiq, measuredV);
              step = 4;
              refreshWorkflow();
              updateFormula();
            }

            if (prevY >= physLiquidH && physY < physLiquidH) splash = 1;

            // 触底：球心不低于半径
            if (physY < r) {
              physY = r;
              vel = 0;
              phase = 'done';
              buttons.drop.disabled = false;
              buttons.drop.textContent = '再次释放';
              buttons.returnBtn.disabled = false;
              if (step < 4 && measuredEta != null) step = 4;
              refreshWorkflow();
              break;
            }
          }

          simY = physToVisY(physY);
          ball.position.set(cylX, simY, cylZ);
          // 随速度缓慢自转（示意）
          ball.rotation.x -= Math.min(Math.abs(vel), 0.05) * 8 * dt * scale;
          if (phase === 'falling' || phase === 'done') {
            engine.pushTrail(trail, cylX, simY, cylZ);
          }
          if (splash > 0 && splash < 40) {
            splash += 1;
            const wobble = 1 + 0.04 * Math.sin(splash * 0.5) * Math.exp(-splash * 0.05);
            cyl.meniscus.scale.set(wobble, wobble, 1);
          }
        }

        const speed = Math.abs(vel);
        const inLiq = physY < physLiquidH;
        let posLabel = '钢球盒中';
        if (phase === 'dragging') posLabel = '拖拽中…';
        else if (!ball.visible) posLabel = '钢球盒中';
        else if (phase === 'falling') posLabel = inLiq ? '液体中' : '空气中';
        else if (phase === 'done') posLabel = '已沉底';
        else posLabel = '漏斗口待释放';

        setReadouts(ui.readouts, [
          { label: '流程步骤', value: `${step + 1}/6 ${STEPS[step]}` },
          { label: '液体 / 温度', value: `${liquid.label} · ${params.temperature}°C` },
          { label: '钢球 d', value: `${formatNum(params.diameterMm, 1)} mm` },
          { label: 'η 理论', value: `${formatNum(etaTrue, 4)} Pa·s` },
          { label: '位置', value: posLabel },
          { label: '速度 |v|', value: `${formatNum(speed * 1000, 2)} mm/s` },
          { label: 'v∞ 理论', value: `${formatNum(vTerm * 1000, 2)} mm/s` },
          {
            label: 'Δt (光电门)',
            value:
              measuredDt != null
                ? `${formatNum(measuredDt, 3)} s`
                : tGateHigh != null
                  ? '计时中…'
                  : '—',
          },
          {
            label: 'v = S/Δt',
            value: measuredV != null ? `${formatNum(measuredV, 5)} m/s` : '—',
          },
          {
            label: 'η 测量',
            value:
              measuredEta != null && Number.isFinite(measuredEta)
                ? `${formatNum(measuredEta, 4)} Pa·s`
                : '—',
          },
          {
            label: '相对误差',
            value:
              measuredEta != null && Number.isFinite(measuredEta)
                ? `${formatNum(((measuredEta - etaTrue) / etaTrue) * 100, 1)} %`
                : '—',
          },
          { label: '已记录组数', value: String(records.length) },
        ]);
      },
    };
  },
};
