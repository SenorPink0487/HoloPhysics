import * as THREE from 'three';
import { BODY_TYPE } from '../../runtime/threading/physicsBackend.js';
import { liveSlider, setReadouts, setFormula } from '../core/ui.js';
import { formatNum } from '../core/engine.js';
import { Mats } from '../core/materials.js';
import { addSimpleGround, createPhysicsBlock } from '../core/labkit.js';

export const inclinedPlane = {
  id: 'inclined-plane',
  name: '斜面运动',
  meta: '可调倾角与摩擦系数 · a = g(sinθ − μ cosθ)',
  description:
    '木块从斜面顶端由静止释放。调节倾角 θ 与动摩擦因数 μ，观察下滑加速度，并与理论公式对比。当 θ 过小或 μ 过大时，木块保持静止。',

  setup(engine, ui, overrides = {}) {
    const params = {
      angleDeg: 30,
      mu: 0.12,
      mass: 2,
      length: 8,
      g: 9.81,
      ...overrides,
    };

    engine.world.gravity.set(0, -params.g, 0);
    const { surfaceY } = addSimpleGround(engine, { size: 32 });
    engine.setCamera([8, 5, 10], [2.5, 1.5, 0]);

    const theta = (params.angleDeg * Math.PI) / 180;
    const L = params.length;
    const thickness = 0.14;
    const width = 1.2;
    const by0 = surfaceY;

    // 斜面中心（底端靠近原点）
    const cx = (L / 2) * Math.cos(theta);
    const cy = by0 + (L / 2) * Math.sin(theta) + (thickness / 2) * Math.cos(theta);

    // 视觉斜面
    const rampGroup = new THREE.Group();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(L, thickness, width),
      new THREE.MeshStandardMaterial({
        color: 0xc4a574,
        metalness: 0,
        roughness: 0.85,
        envMapIntensity: 0,
      })
    );
    deck.castShadow = true;
    deck.receiveShadow = true;
    rampGroup.add(deck);

    for (const z of [-width / 2 + 0.05, width / 2 - 0.05]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(L, 0.08, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x6b7c99,
          metalness: 0.15,
          roughness: 0.65,
          envMapIntensity: 0,
        })
      );
      rail.position.set(0, thickness / 2 + 0.03, z);
      rail.castShadow = true;
      rampGroup.add(rail);
    }

    const scale = new THREE.Mesh(
      new THREE.BoxGeometry(L - 0.2, 0.012, 0.07),
      Mats.warningYellow()
    );
    scale.position.set(0, thickness / 2 + 0.004, -width / 2 + 0.14);
    rampGroup.add(scale);

    rampGroup.position.set(cx, cy, 0);
    rampGroup.rotation.z = theta;
    engine.addStaticMesh(rampGroup);

    // 铰链底座
    const hinge = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.12, 1.3),
      new THREE.MeshStandardMaterial({
        color: 0x3a4250,
        metalness: 0.2,
        roughness: 0.65,
        envMapIntensity: 0,
      })
    );
    hinge.position.set(0.1, by0 + 0.06, 0);
    hinge.castShadow = true;
    engine.addStaticMesh(hinge);

    // 远端支撑
    const jackH = Math.max(L * Math.sin(theta), 0.15);
    const jack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, jackH, 16),
      new THREE.MeshStandardMaterial({
        color: 0x9aa6b8,
        metalness: 0.25,
        roughness: 0.5,
        envMapIntensity: 0,
      })
    );
    jack.position.set(L * Math.cos(theta) * 0.9, by0 + jackH / 2, 0);
    jack.castShadow = true;
    engine.addStaticMesh(jack);

    // 角度弧
    const arcPts = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * theta;
      arcPts.push(new THREE.Vector3(0.7 * Math.cos(a), by0 + 0.12 + 0.7 * Math.sin(a), 0.75));
    }
    engine.addHelper(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(arcPts),
        new THREE.LineBasicMaterial({ color: 0xffb454 })
      )
    );

    // 滑块：沿斜面坐标 s（底端 s=0，顶端 s=L）
    const bx = 0.5;
    const by = 0.28;
    const bz = 0.42;
    const startS = L - 0.55;
    const minS = 0.45;

    /** 斜面顶面上、距底端 s 处、高出表面 heightAbove 的点 */
    function surfacePoint(s, heightAbove = 0) {
      const alongX = Math.cos(theta);
      const alongY = Math.sin(theta);
      const nx = -Math.sin(theta);
      const ny = Math.cos(theta);
      const base = thickness / 2 + heightAbove;
      return {
        x: s * alongX + base * nx,
        y: by0 + s * alongY + base * ny,
      };
    }

    const startPos = surfacePoint(startS, by / 2 + 0.01);
    const block = createPhysicsBlock(engine, {
      size: [bx, by, bz],
      position: [startPos.x, startPos.y, 0],
      mass: 1,
      colorMat: Mats.ballBlue(),
      restitution: 0,
      friction: 0,
      rotation: [0, 0, theta],
    });
    // 运动由公式驱动，不走刚体碰撞求解（避免盒-盒摩擦卡死）
    block.body.type = BODY_TYPE.KINEMATIC;
    block.body.collisionResponse = false;
    block.body.velocity.set(0, 0, 0);

    let released = false;
    const releaseAt = 0.35;
    let currentS = startS;
    let currentV = 0; // 沿斜面向下为正
    let maxSpeed = 0;
    let stopped = false;
    let lastSimT = 0;
    const trail = engine.createTrail(0x3ee0b0, 180);

    liveSlider(ui, params, 'angleDeg', {
      id: 'angle',
      label: '倾角 θ',
      min: 5,
      max: 50,
      step: 1,
      unit: '°',
    });
    liveSlider(ui, params, 'mu', {
      id: 'mu',
      label: '动摩擦因数 μ',
      min: 0,
      max: 0.8,
      step: 0.01,
      unit: '',
    });
    liveSlider(ui, params, 'mass', {
      id: 'mass',
      label: '木块质量 m',
      min: 0.5,
      max: 8,
      step: 0.5,
      unit: ' kg',
    });

    const a0 = params.g * (Math.sin(theta) - params.mu * Math.cos(theta));
    setFormula(
      ui.formula,
      `<strong>斜面运动</strong><br/>
       沿斜面向下加速度：<code>a = g(sinθ − μ cosθ)</code><br/>
       当前理论 a ≈ <strong>${formatNum(Math.max(0, a0), 2)} m/s²</strong><br/>
       临界角：<code>θ_c = arctan μ</code> ≈ <strong>${formatNum(
         (Math.atan(params.mu) * 180) / Math.PI,
         1
       )}°</strong><br/>
       当 θ ≤ θ_c（即 a ≤ 0）时木块保持静止`
    );

    function placeBlock(s) {
      const p = surfacePoint(s, by / 2 + 0.01);
      block.body.position.set(p.x, p.y, 0);
      block.body.velocity.setZero();
      block.body.angularVelocity.setZero();
      block.body.quaternion.setFromEuler(0, 0, theta);
      block.mesh.position.set(p.x, p.y, 0);
      block.mesh.quaternion.copy(block.body.quaternion);
    }

    placeBlock(startS);

    function softReset() {
      released = false;
      currentS = startS;
      currentV = 0;
      maxSpeed = 0;
      stopped = false;
      lastSimT = 0;
      engine.clearTrail(trail);
      placeBlock(startS);
      return true;
    }

    return {
      getParams: () => ({ ...params }),
      hostAction(action) {
        if (action === 'reset') return softReset();
        return false;
      },
      tick(_dt, t) {
        // 用仿真时间差积分，与引擎多子步同步
        const frameDt = Math.max(0, Math.min(t - lastSimT, 0.05));
        lastSimT = t;

        // 几何在重置时固定；加速度用建造时的 θ，与画面一致
        const aTheory = params.g * (Math.sin(theta) - params.mu * Math.cos(theta));
        const canSlide = aTheory > 1e-4;

        if (!released && t >= releaseAt) {
          released = true;
          currentS = startS;
          currentV = 0;
          stopped = !canSlide;
        }

        if (released && !stopped && frameDt > 0) {
          // 沿斜面向下积分：s 减小
          currentV += aTheory * frameDt;
          currentS -= currentV * frameDt;

          if (currentS <= minS) {
            currentS = minS;
            currentV = 0;
            stopped = true;
          }

          placeBlock(currentS);
          maxSpeed = Math.max(maxSpeed, Math.abs(currentV));
          engine.pushTrail(
            trail,
            block.body.position.x,
            block.body.position.y,
            block.body.position.z
          );
        } else if (!released) {
          placeBlock(startS);
        }

        const thetaC = (Math.atan(params.mu) * 180) / Math.PI;
        const simT = Math.max(0, t - releaseAt);

        setReadouts(ui.readouts, [
          { label: '仿真时间 t', value: `${formatNum(simT, 2)} s` },
          { label: '沿斜面速度 v', value: `${formatNum(currentV, 2)} m/s` },
          { label: '理论加速度 a', value: `${formatNum(Math.max(0, aTheory), 2)} m/s²` },
          {
            label: '运动状态',
            value: !released
              ? '准备释放…'
              : !canSlide
                ? '静止（未达临界角）'
                : stopped
                  ? '已到达底端'
                  : '下滑中',
          },
          { label: '临界角 θ_c', value: `${formatNum(thetaC, 1)}°` },
          { label: '沿斜面位置 s', value: `${formatNum(currentS, 2)} m` },
          { label: '高度 y', value: `${formatNum(block.body.position.y - by0, 2)} m` },
          { label: '最大速度', value: `${formatNum(maxSpeed, 2)} m/s` },
        ]);
      },
    };
  },
};
