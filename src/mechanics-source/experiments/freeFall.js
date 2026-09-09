import * as THREE from 'three';
import { BODY_TYPE } from '../../runtime/threading/physicsBackend.js';
import { liveSlider, setReadouts, setFormula } from '../core/ui.js';
import { formatNum, vecSpeed } from '../core/engine.js';
import { Mats } from '../core/materials.js';
import {
  addSimpleGround,
  addGantryFrame,
  addDigitalPanel,
  addLaserSensor,
  addCable,
  createPhysicsSphere,
} from '../core/labkit.js';

export const freeFall = {
  id: 'free-fall',
  name: '自由落体',
  meta: '真空落塔模组 · 双通道计时',
  description:
    '现代落体实验塔：电磁释放夹具同时释放两球。忽略空气阻力时，下落加速度与质量无关。可调节高度与重力，对比实测与理论落地时间。',

  setup(engine, ui, overrides = {}) {
    const params = {
      height: 5.5,
      massA: 1,
      massB: 5,
      g: 9.81,
      ...overrides,
    };

    engine.world.gravity.set(0, -params.g, 0);
    const { surfaceY } = addSimpleGround(engine, { size: 30 });

    addGantryFrame(engine, {
      width: 2.6,
      height: params.height + 1.4,
      depth: 1.4,
      position: [0, surfaceY, 0],
    });

    engine.setCamera([6.5, 4.5, 8.5], [0, surfaceY + params.height * 0.45, 0]);

    // Electromagnetic release head
    const headY = surfaceY + params.height + 0.55;
    const head = new THREE.Group();
    const headBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.22, 0.55),
      Mats.labPlastic(0x1e2433)
    );
    headBody.castShadow = true;
    head.add(headBody);
    const headPlate = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.04, 0.45),
      Mats.brushedAluminum()
    );
    headPlate.position.y = -0.12;
    head.add(headPlate);
    // EM coils
    for (const x of [-0.45, 0.45]) {
      const coil = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.1, 24),
        Mats.anodizedOrange()
      );
      coil.position.set(x, -0.18, 0);
      head.add(coil);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), Mats.chrome());
      core.position.set(x, -0.22, 0);
      head.add(core);
    }
    // Status LED bar
    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.04), Mats.led(0x3ee0b0));
    ledBar.position.set(0, 0.08, 0.28);
    head.add(ledBar);
    head.position.set(0, headY, 0);
    engine.addStaticMesh(head);

    // Landing pad with foam damper
    const pad = new THREE.Group();
    const padBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.0, 0.08, 48),
      Mats.darkMetal()
    );
    padBase.receiveShadow = true;
    pad.add(padBase);
    const foam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 0.05, 48),
      Mats.rubber(0x2a303c)
    );
    foam.position.y = 0.055;
    pad.add(foam);
    // target rings
    for (const [r, c] of [
      [0.55, 0xff6b8a],
      [0.35, 0xffffff],
      [0.15, 0xff6b8a],
    ]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.04, r, 40),
        new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.085;
      pad.add(ring);
    }
    pad.position.set(0, surfaceY + 0.04, 0);
    engine.addStaticMesh(pad);

    // Photogates
    addLaserSensor(engine, [-1.15, surfaceY + 0.35, 0.35], 0xff3355);
    addLaserSensor(engine, [-1.15, headY - 0.5, 0.35], 0x33ff88);

    // Height scale (precision ruler)
    const ruler = new THREE.Group();
    const rulerBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, params.height + 0.4, 0.03),
      Mats.brushedAluminum()
    );
    rulerBody.position.set(-1.35, surfaceY + (params.height + 0.4) / 2, 0);
    ruler.add(rulerBody);
    for (let h = 0; h <= Math.ceil(params.height); h++) {
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.015, 0.02),
        h % 1 === 0 ? Mats.warningYellow() : Mats.matteBlack()
      );
      tick.position.set(-1.28, surfaceY + h, 0.02);
      ruler.add(tick);
    }
    engine.addStaticMesh(ruler);

    addDigitalPanel(engine, {
      position: [2.4, surfaceY + 0.45, 0.9],
      width: 0.85,
      height: 0.5,
      title: 'TIMER-2CH',
    });

    addCable(
      engine,
      [
        [1.9, surfaceY + 0.45, 0.9],
        [1.2, surfaceY + 0.2, 0.5],
        [0.5, headY - 0.2, 0.3],
        [0.2, headY, 0.1],
      ],
      0x1a1e28
    );

    const rA = 0.22;
    const rB = 0.3;
    const dropY = headY - 0.35;

    const ballA = createPhysicsSphere(engine, {
      radius: rA,
      position: [-0.45, dropY, 0],
      mass: params.massA,
      colorMat: Mats.ballBlue(),
      restitution: 0.08,
      friction: 0.2,
    });
    const ballB = createPhysicsSphere(engine, {
      radius: rB,
      position: [0.45, dropY, 0],
      mass: params.massB,
      colorMat: Mats.ballRed(),
      restitution: 0.08,
      friction: 0.2,
    });

    ballA.body.type = BODY_TYPE.KINEMATIC;
    ballB.body.type = BODY_TYPE.KINEMATIC;
    ballA.body.velocity.set(0, 0, 0);
    ballB.body.velocity.set(0, 0, 0);

    let released = false;
    let landTimeA = null;
    let landTimeB = null;
    const releaseAt = 0.45;
    const trailA = engine.createTrail(0x5b8cff, 140);
    const trailB = engine.createTrail(0xff6b8a, 140);
    const landY = surfaceY + 0.1;
    const startA = { x: -0.45, y: dropY, z: 0 };
    const startB = { x: 0.45, y: dropY, z: 0 };
    const idleLed = Mats.led(0x3ee0b0);
    const fireLed = Mats.led(0xff6b8a);

    function holdKinematic(ball, pos) {
      ball.body.type = BODY_TYPE.KINEMATIC;
      ball.body.velocity.set(0, 0, 0);
      ball.body.angularVelocity.set(0, 0, 0);
      ball.body.position.set(pos.x, pos.y, pos.z);
      ball.body.wakeUp();
      ball.mesh.position.set(pos.x, pos.y, pos.z);
    }

    function freezeOnPad(ball, x, radius) {
      ball.body.type = BODY_TYPE.KINEMATIC;
      ball.body.velocity.set(0, 0, 0);
      ball.body.angularVelocity.set(0, 0, 0);
      ball.body.position.set(x, landY + radius, 0);
      ball.mesh.position.set(x, landY + radius, 0);
    }

    function softReset() {
      released = false;
      landTimeA = null;
      landTimeB = null;
      engine.clearTrail(trailA);
      engine.clearTrail(trailB);
      holdKinematic(ballA, startA);
      holdKinematic(ballB, startB);
      ledBar.material = idleLed;
      return true;
    }

    liveSlider(ui, params, 'height', {
      id: 'height',
      label: '释放高度 h',
      min: 2.5,
      max: 7,
      step: 0.5,
      unit: ' m',
    });
    liveSlider(ui, params, 'massA', {
      id: 'massA',
      label: '蓝球质量 m₁',
      min: 0.5,
      max: 10,
      step: 0.5,
      unit: ' kg',
    });
    liveSlider(ui, params, 'massB', {
      id: 'massB',
      label: '红球质量 m₂',
      min: 0.5,
      max: 10,
      step: 0.5,
      unit: ' kg',
    });
    liveSlider(ui, params, 'g', {
      id: 'g',
      label: '重力加速度 g',
      min: 1.6,
      max: 20,
      step: 0.1,
      unit: ' m/s²',
    });

    setFormula(
      ui.formula,
      `<strong>自由落体</strong><br/>
       加速度：<code>a = g</code>（与质量无关）<br/>
       下落时间：<code>t = √(2h/g)</code><br/>
       落地速度：<code>v = √(2gh)</code>`
    );

    return {
      getParams: () => ({ ...params }),
      hostAction(action) {
        if (action === 'reset') return softReset();
        return false;
      },
      tick(_dt, t) {
        if (!released && t >= releaseAt) {
          released = true;
          // flash release LED
          ledBar.material = fireLed;
          ballA.body.type = BODY_TYPE.DYNAMIC;
          ballB.body.type = BODY_TYPE.DYNAMIC;
          ballA.body.mass = params.massA;
          ballB.body.mass = params.massB;
          ballA.body.updateMassProperties();
          ballB.body.updateMassProperties();
          ballA.body.velocity.set(0, 0, 0);
          ballB.body.velocity.set(0, 0, 0);
          ballA.body.angularVelocity.set(0, 0, 0);
          ballB.body.angularVelocity.set(0, 0, 0);
          ballA.body.wakeUp();
          ballB.body.wakeUp();
        }

        if (released) {
          // Still free-falling: trail. Once landed: freeze so balls never roll
          // off the pad forever (host soft-reset previously left them DYNAMIC).
          if (landTimeA === null) {
            engine.pushTrail(trailA, ballA.body.position.x, ballA.body.position.y, ballA.body.position.z);
            if (ballA.body.position.y <= landY + rA && ballA.body.velocity.y > -1) {
              landTimeA = t - releaseAt;
              freezeOnPad(ballA, startA.x, rA);
            }
          }
          if (landTimeB === null) {
            engine.pushTrail(trailB, ballB.body.position.x, ballB.body.position.y, ballB.body.position.z);
            if (ballB.body.position.y <= landY + rB && ballB.body.velocity.y > -1) {
              landTimeB = t - releaseAt;
              freezeOnPad(ballB, startB.x, rB);
            }
          }
        }

        const va = landTimeA == null ? vecSpeed(ballA.body) : 0;
        const vb = landTimeB == null ? vecSpeed(ballB.body) : 0;
        const theoryT = Math.sqrt((2 * params.height) / params.g);
        const theoryV = Math.sqrt(2 * params.g * params.height);

        setReadouts(ui.readouts, [
          { label: '仿真时间 t', value: `${formatNum(Math.max(0, t - releaseAt), 2)} s` },
          { label: '理论落地时间', value: `${formatNum(theoryT, 2)} s` },
          { label: '蓝球速度 |v₁|', value: `${formatNum(va, 2)} m/s` },
          { label: '红球速度 |v₂|', value: `${formatNum(vb, 2)} m/s` },
          { label: '理论落地速度', value: `${formatNum(theoryV, 2)} m/s` },
          {
            label: 'CH1 / CH2 计时',
            value: `${landTimeA == null ? '…' : formatNum(landTimeA, 2)} / ${
              landTimeB == null ? '…' : formatNum(landTimeB, 2)
            } s`,
          },
        ]);
      },
    };
  },
};
