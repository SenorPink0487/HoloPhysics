import * as THREE from 'three';
import { liveSlider, setReadouts, setFormula } from '../core/ui.js';
import { formatNum } from '../core/engine.js';
import { addSimpleGround } from '../core/labkit.js';

/**
 * 绘制实验室级量角器贴图
 * 约定：图像中心为圆心，竖直向下 = 0°，向右为正，向左为负（-90°…+90°）
 */
function createProtractorTexture(size = 1024) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.48; // 外半径
  const Rinner = size * 0.2;

  ctx.clearRect(0, 0, size, size);

  // 半透明盘面（下半扇 + 两侧，略大于半圆便于读负正角）
  ctx.save();
  ctx.beginPath();
  // 图像坐标：+x 右，+y 下。物理 0° 朝下 = 图像 +y
  // 从 -90°(左) 扫到 +90°(右)：在 canvas 中从左水平经底部到右水平
  // canvas 角度：0=右，顺时针为正（与标准 math 不同）
  // 物理角 a（0=下, +右）：canvas 方向 = a + 90° 从竖直下...
  // 用自定义映射：物理 (sin a, -cos a) 在图像里对应 (sin a, cos a) 因为 y 翻转
  ctx.moveTo(cx, cy);
  for (let deg = -95; deg <= 95; deg += 1) {
    const a = (deg * Math.PI) / 180;
    const x = cx + R * Math.sin(a);
    const y = cy + R * Math.cos(a); // 图像 y 向下 = 物理向下
    if (deg === -95) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(cx, cy, Rinner, cx, cy, R);
  grad.addColorStop(0, 'rgba(248, 251, 255, 0.15)');
  grad.addColorStop(0.45, 'rgba(235, 242, 252, 0.88)');
  grad.addColorStop(1, 'rgba(210, 222, 240, 0.95)');
  ctx.fillStyle = grad;
  ctx.fill();

  // 内圆挖空（环状尺）
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, Rinner, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // 内缘 / 外缘描边
  ctx.strokeStyle = 'rgba(40, 55, 80, 0.55)';
  ctx.lineWidth = size * 0.004;
  ctx.beginPath();
  for (let deg = -90; deg <= 90; deg += 1) {
    const a = (deg * Math.PI) / 180;
    const x = cx + R * Math.sin(a);
    const y = cy + R * Math.cos(a);
    if (deg === -90) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let deg = -90; deg <= 90; deg += 1) {
    const a = (deg * Math.PI) / 180;
    const x = cx + Rinner * Math.sin(a);
    const y = cy + Rinner * Math.cos(a);
    if (deg === -90) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 刻度：1° 短、5° 中、10° 长 + 数字
  ctx.lineCap = 'butt';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let deg = -90; deg <= 90; deg += 1) {
    const a = (deg * Math.PI) / 180;
    const is10 = deg % 10 === 0;
    const is5 = deg % 5 === 0;
    let tickLen;
    let lineW;
    let color;
    if (deg === 0) {
      tickLen = R * 0.2;
      lineW = size * 0.0055;
      color = '#d4203a';
    } else if (is10) {
      tickLen = R * 0.14;
      lineW = size * 0.0038;
      color = '#1a2438';
    } else if (is5) {
      tickLen = R * 0.09;
      lineW = size * 0.0026;
      color = '#2a3548';
    } else {
      tickLen = R * 0.05;
      lineW = size * 0.0016;
      color = '#4a5a72';
    }

    const r0 = R - 2;
    const r1 = R - tickLen;
    const x0 = cx + r0 * Math.sin(a);
    const y0 = cy + r0 * Math.cos(a);
    const x1 = cx + r1 * Math.sin(a);
    const y1 = cy + r1 * Math.cos(a);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // 10° 标注数字（0、10、20…；左右对称）
    if (is10 && Math.abs(deg) <= 90) {
      const rNum = R - tickLen - size * 0.045;
      const nx = cx + rNum * Math.sin(a);
      const ny = cy + rNum * Math.cos(a);
      ctx.save();
      ctx.translate(nx, ny);
      // 数字保持大致正立，随弧轻微倾斜
      ctx.rotate(a);
      ctx.fillStyle = deg === 0 ? '#d4203a' : '#152033';
      ctx.font = `600 ${size * (deg === 0 ? 0.042 : 0.032)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillText(String(Math.abs(deg)), 0, 0);
      ctx.restore();
    }
  }

  // 单位与标题
  ctx.fillStyle = '#3a4a62';
  ctx.font = `600 ${size * 0.028}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.fillText('θ / °', cx, cy + R * 0.42);
  ctx.font = `${size * 0.022}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = '#5a6a82';
  ctx.fillText('PROTRACTOR', cx, cy + R * 0.52);

  // 左右方向提示
  ctx.font = `${size * 0.02}px "Segoe UI", sans-serif`;
  ctx.fillStyle = '#6a7a92';
  const hintR = R * 0.55;
  ctx.fillText('−', cx + hintR * Math.sin((-55 * Math.PI) / 180), cy + hintR * Math.cos((-55 * Math.PI) / 180));
  ctx.fillText('+', cx + hintR * Math.sin((55 * Math.PI) / 180), cy + hintR * Math.cos((55 * Math.PI) / 180));

  // 中心准心
  ctx.strokeStyle = '#d4203a';
  ctx.lineWidth = size * 0.003;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.012, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.02, cy);
  ctx.lineTo(cx + size * 0.02, cy);
  ctx.moveTo(cx, cy - size * 0.02);
  ctx.lineTo(cx, cy + size * 0.02);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 真实单摆：
 *  - 完整非线性方程 θ̈ = −(g/L) sinθ − c·ω  （含空气阻尼）
 *  - RK4 积分，摆球严格走圆弧（细线约束）
 *  - 大角度周期修正 + 多周期平均测周期
 */

export const pendulum = {
  id: 'pendulum',
  name: '单摆实验',
  meta: '非线性摆 · 阻尼 · 周期测量',
  description:
    '更接近真实物理的单摆：细线 + 重摆球，按 θ̈ = −(g/L)sinθ 运动，并含弱空气阻尼。可对比小角近似与大角度周期修正。',

  setup(engine, ui, overrides = {}) {
    const params = {
      length: 1.6,
      angleDeg: 35,
      mass: 0.8,
      g: 9.81,
      damping: 0.08, // 角速度阻尼系数 c（1/s 量级）
      ...overrides,
    };

    engine.world.gravity.set(0, -params.g, 0);
    addSimpleGround(engine, { size: 20, color: 0x10182a });

    const L = params.length;
    const g = params.g;
    const m = params.mass;
    // 固定密度近似：半径随质量变化，更真实
    const bobR = Math.cbrt((3 * m) / (4 * Math.PI * 2800)) * 0.55; // 视觉缩放
    const rVis = THREE.MathUtils.clamp(bobR, 0.07, 0.18);

    // —— 支架几何 ——
    const postH = Math.max(L + 0.55, 1.8);
    const pivot = new THREE.Vector3(0, postH, 0);

    engine.setCamera([2.8, pivot.y * 0.55, 3.6], [0, pivot.y - L * 0.45, 0]);

    const stand = new THREE.Group();

    // 铸铁底座
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x2a2e36,
      metalness: 0.35,
      roughness: 0.75,
      envMapIntensity: 0,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.1, 48), baseMat);
    base.position.y = 0.05;
    base.castShadow = true;
    base.receiveShadow = true;
    stand.add(base);
    // 底座棱边
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.018, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.2, roughness: 0.9, envMapIntensity: 0 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.09;
    stand.add(rim);

    // 不锈钢立柱
    const steel = new THREE.MeshStandardMaterial({
      color: 0xb8c0cc,
      metalness: 0.55,
      roughness: 0.35,
      envMapIntensity: 0,
    });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, postH, 20), steel);
    post.position.y = postH / 2;
    post.castShadow = true;
    stand.add(post);

    // 顶部横臂 + 夹具
    const armLen = 0.42;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, armLen, 12), steel);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(-armLen / 2 + 0.02, pivot.y, 0);
    arm.castShadow = true;
    stand.add(arm);

    // 万向夹头 / 悬点
    const clampBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.055, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.3, roughness: 0.55, envMapIntensity: 0 })
    );
    clampBody.position.set(0.02, pivot.y, 0);
    stand.add(clampBody);
    const thumb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.05, 12),
      new THREE.MeshStandardMaterial({ color: 0xc45a20, metalness: 0.2, roughness: 0.55, envMapIntensity: 0 })
    );
    thumb.rotation.z = Math.PI / 2;
    thumb.position.set(0.06, pivot.y, 0);
    stand.add(thumb);

    // 悬点小钩
    const hook = new THREE.Mesh(
      new THREE.TorusGeometry(0.018, 0.004, 8, 16, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x888f9a, metalness: 0.6, roughness: 0.3, envMapIntensity: 0 })
    );
    hook.position.copy(pivot);
    hook.position.y -= 0.02;
    hook.rotation.x = Math.PI / 2;
    stand.add(hook);

    // —— 精密角度尺（量角器）：Canvas 刻度贴图 + 立体外沿刻度 ——
    const dialG = new THREE.Group();
    const dialR = 0.55; // 外半径（米）
    const dialInner = 0.22;

    const protractorTex = createProtractorTexture();
    const dialPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(dialR * 2.05, dialR * 2.05),
      new THREE.MeshStandardMaterial({
        map: protractorTex,
        transparent: true,
        roughness: 0.65,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 0,
      })
    );
    // 贴图中心 = 圆心 = 悬点；贴图朝前
    dialPlane.position.set(pivot.x, pivot.y, -0.09);
    dialG.add(dialPlane);

    // 半透明亚克力底板（略大一圈，增加厚度感）
    const acrylic = new THREE.Mesh(
      new THREE.CircleGeometry(dialR + 0.02, 64),
      new THREE.MeshStandardMaterial({
        color: 0xd8e4f5,
        transparent: true,
        opacity: 0.22,
        roughness: 0.35,
        metalness: 0,
        side: THREE.DoubleSide,
        envMapIntensity: 0,
      })
    );
    acrylic.position.set(pivot.x, pivot.y, -0.095);
    dialG.add(acrylic);

    // 金属外圈护边（下半圆弧）
    {
      const rimPts = [];
      for (let deg = -92; deg <= 92; deg += 2) {
        const a = (deg * Math.PI) / 180;
        rimPts.push(
          new THREE.Vector3(
            pivot.x + (dialR + 0.012) * Math.sin(a),
            pivot.y - (dialR + 0.012) * Math.cos(a),
            -0.09
          )
        );
      }
      const rimCurve = new THREE.CatmullRomCurve3(rimPts);
      const rimMesh = new THREE.Mesh(
        new THREE.TubeGeometry(rimCurve, 64, 0.007, 8, false),
        new THREE.MeshStandardMaterial({
          color: 0x6a7385,
          metalness: 0.45,
          roughness: 0.4,
          envMapIntensity: 0,
        })
      );
      dialG.add(rimMesh);
    }

    // 立体刻度齿：1° / 5° / 10°（沿弧外缘突起，便于侧视辨认）
    const tickMat1 = new THREE.MeshStandardMaterial({
      color: 0x1a2030,
      metalness: 0,
      roughness: 0.8,
      envMapIntensity: 0,
    });
    const tickMat5 = new THREE.MeshStandardMaterial({
      color: 0x0e1420,
      metalness: 0,
      roughness: 0.75,
      envMapIntensity: 0,
    });
    const tickMat10 = new THREE.MeshStandardMaterial({
      color: 0x0a0e18,
      metalness: 0.1,
      roughness: 0.7,
      envMapIntensity: 0,
    });
    const tickMat0 = new THREE.MeshStandardMaterial({
      color: 0xd4203a,
      metalness: 0.15,
      roughness: 0.55,
      envMapIntensity: 0,
      emissive: 0x4a0010,
      emissiveIntensity: 0.25,
    });

    for (let deg = -90; deg <= 90; deg += 1) {
      const a = (deg * Math.PI) / 180;
      const is10 = deg % 10 === 0;
      const is5 = deg % 5 === 0;
      let len;
      let thick;
      let mat;
      if (deg === 0) {
        len = 0.1;
        thick = 0.01;
        mat = tickMat0;
      } else if (is10) {
        len = 0.075;
        thick = 0.007;
        mat = tickMat10;
      } else if (is5) {
        len = 0.05;
        thick = 0.005;
        mat = tickMat5;
      } else {
        len = 0.028;
        thick = 0.0035;
        mat = tickMat1;
      }
      const tick = new THREE.Mesh(new THREE.BoxGeometry(thick, len, 0.006), mat);
      // 0° = 竖直向下，正角 → +x
      const rr = dialR - len / 2 + 0.002;
      tick.position.set(
        pivot.x + rr * Math.sin(a),
        pivot.y - rr * Math.cos(a),
        -0.086
      );
      tick.rotation.z = a;
      dialG.add(tick);
    }

    // 圆心轴套
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.028, 0.02, 24),
      new THREE.MeshStandardMaterial({
        color: 0x8a93a5,
        metalness: 0.5,
        roughness: 0.35,
        envMapIntensity: 0,
      })
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.set(pivot.x, pivot.y, -0.09);
    dialG.add(hub);

    stand.add(dialG);

    // 指针：细长针从圆心指向弧上读数
    const pointer = new THREE.Group();
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, dialR - 0.04, 0.004),
      new THREE.MeshStandardMaterial({
        color: 0x1ec9a0,
        metalness: 0.2,
        roughness: 0.45,
        emissive: 0x0a3a28,
        emissiveIntensity: 0.35,
        envMapIntensity: 0,
      })
    );
    // 本地 +Y 为针尖方向；静止时 θ=0 针尖朝下 → 旋转后对齐
    needle.position.y = -(dialR - 0.04) / 2;
    pointer.add(needle);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.014, 0.04, 10),
      new THREE.MeshStandardMaterial({
        color: 0x2fe0b0,
        metalness: 0.15,
        roughness: 0.4,
        emissive: 0x0a4030,
        emissiveIntensity: 0.4,
        envMapIntensity: 0,
      })
    );
    tip.position.y = -(dialR - 0.02);
    tip.rotation.x = Math.PI; // 尖端朝下
    pointer.add(tip);
    const pHub = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0x2fe0b0,
        metalness: 0.2,
        roughness: 0.4,
        envMapIntensity: 0,
      })
    );
    pointer.add(pHub);
    pointer.position.set(pivot.x, pivot.y, -0.082);
    stand.add(pointer);

    engine.addStaticMesh(stand);

    // —— 摆线（细尼龙线）——
    const stringMat = new THREE.MeshStandardMaterial({
      color: 0xd8dce4,
      metalness: 0,
      roughness: 0.7,
      envMapIntensity: 0,
    });
    const stringMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 8), stringMat);
    stringMesh.castShadow = true;
    engine.addHelper(stringMesh);

    // 摆线顶端小结
    const knot = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0, roughness: 0.8, envMapIntensity: 0 })
    );
    engine.addHelper(knot);

    // —— 摆球（哑光金属球 + 吊环）——
    const bobGroup = new THREE.Group();
    const bobMat = new THREE.MeshStandardMaterial({
      color: 0xc9a227, // 黄铜感，哑光
      metalness: 0.25,
      roughness: 0.55,
      envMapIntensity: 0,
    });
    const bobMesh = new THREE.Mesh(new THREE.SphereGeometry(rVis, 40, 32), bobMat);
    bobMesh.castShadow = true;
    bobMesh.receiveShadow = true;
    bobGroup.add(bobMesh);
    // 吊环
    const eye = new THREE.Mesh(
      new THREE.TorusGeometry(rVis * 0.22, rVis * 0.06, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x8a909a, metalness: 0.45, roughness: 0.4, envMapIntensity: 0 })
    );
    eye.position.y = rVis * 0.92;
    eye.rotation.x = Math.PI / 2;
    bobGroup.add(eye);
    // 接缝环（哑光，无反光）
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(rVis * 0.98, rVis * 0.015, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xa88b20, metalness: 0.15, roughness: 0.65, envMapIntensity: 0 })
    );
    seam.rotation.x = Math.PI / 2;
    bobGroup.add(seam);
    engine.addHelper(bobGroup);

    // 轨迹虚线（最大摆角弧）
    const arcMax = (params.angleDeg * Math.PI) / 180;
    const arcPts = [];
    for (let i = -60; i <= 60; i++) {
      const a = (i / 60) * Math.max(arcMax, 0.15);
      arcPts.push(
        new THREE.Vector3(
          pivot.x + L * Math.sin(a),
          pivot.y - L * Math.cos(a),
          0.01
        )
      );
    }
    const arcLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(arcPts),
      new THREE.LineDashedMaterial({
        color: 0x5b8cff,
        dashSize: 0.05,
        gapSize: 0.04,
        transparent: true,
        opacity: 0.45,
      })
    );
    arcLine.computeLineDistances();
    engine.addHelper(arcLine);

    // 光电门（平衡位置）
    const gateY = pivot.y - L;
    const gate = new THREE.Group();
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d24,
      metalness: 0.2,
      roughness: 0.7,
      envMapIntensity: 0,
    });
    for (const z of [-0.16, 0.16]) {
      const armG = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), gateMat);
      armG.position.set(pivot.x, gateY, z);
      gate.add(armG);
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.3, 6),
      new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.55 })
    );
    beam.rotation.x = Math.PI / 2;
    beam.position.set(pivot.x, gateY, 0);
    gate.add(beam);
    // 支架座
    const gateBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.04, 0.4),
      gateMat
    );
    gateBase.position.set(pivot.x, Math.max(0.03, gateY - 0.2), 0);
    if (gateY > 0.35) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, gateY - 0.15, 8), steel);
      stem.position.set(pivot.x, (gateY - 0.15) / 2 + 0.05, 0.16);
      gate.add(stem);
    }
    gate.add(gateBase);
    engine.addStaticMesh(gate);

    // —— 动力学状态 ——
    let theta = (params.angleDeg * Math.PI) / 180; // 从竖直向下量起，右偏为正
    let omega = 0;
    let released = false;
    const releaseAt = 0.4;
    let lastSimT = 0;

    // 周期测量：相邻两次同向过零（θ: -→+ 且 ω>0）
    let lastTheta = theta;
    let lastCrossT = null;
    let periodSamples = [];
    let periodAvg = null;
    let crossCount = 0;
    let gateFlash = 0;

    const trail = engine.createTrail(0x3ee0b0, 200);

    // 能量参考：以最低点势能为 0
    function energy(th, om) {
      const h = L * (1 - Math.cos(th));
      const v = L * om;
      return 0.5 * m * v * v + m * g * h;
    }
    const E0 = energy(theta, 0);

    liveSlider(ui, params, 'length', {
      id: 'length',
      label: '摆长 L',
      min: 0.6,
      max: 2.4,
      step: 0.05,
      unit: ' m',
    });
    liveSlider(ui, params, 'angleDeg', {
      id: 'angle',
      label: '初始摆角 θ₀',
      min: 3,
      max: 70,
      step: 1,
      unit: '°',
    });
    liveSlider(ui, params, 'mass', {
      id: 'mass',
      label: '摆球质量 m',
      min: 0.2,
      max: 3,
      step: 0.1,
      unit: ' kg',
    });
    liveSlider(ui, params, 'damping', {
      id: 'damping',
      label: '空气阻尼 c',
      min: 0,
      max: 0.4,
      step: 0.01,
      unit: '',
    });

    const T0 = 2 * Math.PI * Math.sqrt(L / g);
    const th0 = (params.angleDeg * Math.PI) / 180;
    // 大角度修正：T ≈ T0 (1 + (1/16)θ₀² + (11/3072)θ₀⁴)
    const Tlarge =
      T0 *
      (1 + (1 / 16) * th0 * th0 + (11 / 3072) * th0 * th0 * th0 * th0);

    setFormula(
      ui.formula,
      `<strong>单摆</strong><br/>
       小角度近似：<code>T = 2π√(l/g)</code> ≈ <strong>${formatNum(T0, 3)} s</strong><br/>
       角加速度：<code>α = −(g/l) sinθ</code>（回复力矩）<br/>
       大角度时周期略大：≈ <strong>${formatNum(Tlarge, 3)} s</strong><br/>
       <span style="opacity:.85">实测周期取多次过平衡位置平均</span>`
    );

    function bobPosition(th) {
      return new THREE.Vector3(
        pivot.x + L * Math.sin(th),
        pivot.y - L * Math.cos(th),
        0
      );
    }

    function placeVisual(th) {
      const p = bobPosition(th);
      bobGroup.position.copy(p);

      // 摆线：从 pivot 到球顶吊环
      const top = pivot.clone();
      const bot = p.clone();
      bot.y += rVis * 0.9;
      const mid = top.clone().add(bot).multiplyScalar(0.5);
      const dir = bot.clone().sub(top);
      const len = dir.length();
      stringMesh.scale.set(1, len, 1);
      stringMesh.position.copy(mid);
      if (len > 1e-6) {
        stringMesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize()
        );
      }
      knot.position.copy(top);

      // 角度指针：绕圆心旋转，0° 朝下与摆线共线
      pointer.rotation.z = th;
    }

    /** θ̈ = −(g/L) sinθ − c ω */
    function accel(th, om, c) {
      return -(g / L) * Math.sin(th) - c * om;
    }

    function rk4Step(th, om, dt, c) {
      const k1th = om;
      const k1om = accel(th, om, c);
      const k2th = om + 0.5 * dt * k1om;
      const k2om = accel(th + 0.5 * dt * k1th, om + 0.5 * dt * k1om, c);
      const k3th = om + 0.5 * dt * k2om;
      const k3om = accel(th + 0.5 * dt * k2th, om + 0.5 * dt * k2om, c);
      const k4th = om + dt * k3om;
      const k4om = accel(th + dt * k3th, om + dt * k3om, c);
      const nth = th + (dt / 6) * (k1th + 2 * k2th + 2 * k3th + k4th);
      const nom = om + (dt / 6) * (k1om + 2 * k2om + 2 * k3om + k4om);
      return { th: nth, om: nom };
    }

    placeVisual(theta);

    function softReset() {
      released = false;
      theta = (params.angleDeg * Math.PI) / 180;
      omega = 0;
      lastTheta = theta;
      lastCrossT = null;
      periodSamples = [];
      periodAvg = null;
      crossCount = 0;
      gateFlash = 0;
      lastSimT = 0;
      engine.clearTrail(trail);
      placeVisual(theta);
      return true;
    }

    return {
      getParams: () => ({ ...params }),
      hostAction(action) {
        if (action === 'reset') return softReset();
        return false;
      },
      tick(_dt, t) {
        const frameDt = Math.max(0, Math.min(t - lastSimT, 0.05));
        lastSimT = t;
        const c = params.damping;

        if (!released && t >= releaseAt) {
          released = true;
          omega = 0;
          theta = (params.angleDeg * Math.PI) / 180;
          lastTheta = theta;
        }

        if (released && frameDt > 0) {
          // 固定子步 RK4，保证稳定性
          const sub = Math.max(1, Math.ceil(frameDt / (1 / 240)));
          const h = frameDt / sub;
          for (let i = 0; i < sub; i++) {
            const s = rk4Step(theta, omega, h, c);
            theta = s.th;
            omega = s.om;
          }

          // 过零检测（同向）：θ 从负到正，ω > 0
          if (lastTheta < 0 && theta >= 0 && omega > 0) {
            if (lastCrossT != null) {
              const T = t - lastCrossT;
              if (T > 0.2 && T < 8) {
                periodSamples.push(T);
                if (periodSamples.length > 8) periodSamples.shift();
                periodAvg =
                  periodSamples.reduce((a, b) => a + b, 0) / periodSamples.length;
              }
            }
            lastCrossT = t;
            crossCount += 1;
            gateFlash = 0.15;
          }
          lastTheta = theta;

          placeVisual(theta);
          const p = bobPosition(theta);
          engine.pushTrail(trail, p.x, p.y, p.z);
        } else if (!released) {
          placeVisual(theta);
        }

        if (gateFlash > 0) {
          gateFlash -= frameDt;
          beam.material.opacity = 0.95;
        } else {
          beam.material.opacity = 0.4;
        }

        const angDeg = (theta * 180) / Math.PI;
        const speed = Math.abs(L * omega);
        const E = energy(theta, omega);
        const Tsmall = 2 * Math.PI * Math.sqrt(L / g);
        const th0r = (params.angleDeg * Math.PI) / 180;
        const Tcorr =
          Tsmall *
          (1 + (1 / 16) * th0r * th0r + (11 / 3072) * th0r ** 4);

        setReadouts(ui.readouts, [
          { label: '时间 t', value: `${formatNum(Math.max(0, t - releaseAt), 2)} s` },
          { label: '摆角 θ', value: `${formatNum(angDeg, 2)}°` },
          { label: '角速度 ω', value: `${formatNum(omega, 3)} rad/s` },
          { label: '线速度 v', value: `${formatNum(speed, 3)} m/s` },
          {
            label: '测量周期 T̄',
            value: periodAvg == null ? '测量中…' : `${formatNum(periodAvg, 3)} s`,
          },
          { label: '小角理论 T₀', value: `${formatNum(Tsmall, 3)} s` },
          { label: '大角修正 T', value: `${formatNum(Tcorr, 3)} s` },
          { label: '机械能 E', value: `${formatNum(E, 3)} J  (初值 ${formatNum(E0, 3)})` },
          { label: '过零次数', value: String(crossCount) },
        ]);
      },
    };
  },
};
