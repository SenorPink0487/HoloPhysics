import * as THREE from 'three';
import { BODY_TYPE } from '../../runtime/threading/physicsBackend.js';
import { Mats, makeLabSphere, makeLabBlock } from './materials.js';

/**
 * Modern laboratory props — furniture, stands, instruments.
 * All visual-only unless a physics body is returned.
 *
 * Physics bodies go through engine.addPhysicsBody / engine.physics when the
 * host SourceEngineAdapter is present; LabEngine (standalone) still exposes
 * engine.world for transitional adoptBody paths.
 */

function registerBody(engine, desc, mesh = null) {
  if (typeof engine.addPhysicsBody === 'function') {
    return engine.addPhysicsBody(desc, mesh);
  }
  // Standalone LabEngine: adopt via raw cannon if physics backend is absent.
  if (engine.physics?.addBody) {
    const bodyId = engine.physics.addBody(desc);
    const body = engine.physics.getHandle(bodyId);
    engine.bodies.push(body);
    if (mesh) {
      mesh.userData.bodyId = bodyId;
      mesh.userData.body = body;
    }
    return { bodyId, body };
  }
  throw new Error('labkit: engine has no PhysicsBackend (addPhysicsBody/physics)');
}

/** Simple ground plane + grid (no room / walls / furniture scene) */
export function addSimpleGround(engine, { size = 40, color = 0x121a2c } = {}) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0,
      roughness: 0.95,
      envMapIntensity: 0,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  engine.addStaticMesh(floor);

  const grid = new THREE.GridHelper(size, size / 2, 0x3a4d78, 0x1e2a42);
  grid.position.y = 0.002;
  engine.addHelper(grid);

  const { body, bodyId } = registerBody(engine, {
    shape: 'plane',
    type: BODY_TYPE.STATIC,
    mass: 0,
    position: [0, 0, 0],
  });

  return { floor, floorBody: body, bodyId, surfaceY: 0 };
}

export function addLabBench(engine, {
  width = 8,
  depth = 3.2,
  height = 0.92,
  position = [0, 0, 0],
  withShelf = true,
} = {}) {
  const g = new THREE.Group();
  const [px, py, pz] = position;

  // Legs (square tube steel)
  const legMat = Mats.darkMetal();
  const legW = 0.08;
  const inset = 0.12;
  const legH = height - 0.06;
  for (const x of [-width / 2 + inset, width / 2 - inset]) {
    for (const z of [-depth / 2 + inset, depth / 2 - inset]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), legMat);
      leg.position.set(x, legH / 2, z);
      leg.castShadow = true;
      g.add(leg);
      // foot pad
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 16), Mats.rubber());
      foot.position.set(x, 0.02, z);
      g.add(foot);
    }
  }

  // Cross braces
  const brace = new THREE.Mesh(
    new THREE.BoxGeometry(width - inset * 2, 0.04, 0.04),
    legMat
  );
  brace.position.set(0, 0.28, 0);
  g.add(brace);

  // Cabinet body
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.2, height * 0.55, depth - 0.25),
    Mats.labPlastic(0x2a3142)
  );
  cab.position.set(0, height * 0.32, 0);
  cab.castShadow = true;
  cab.receiveShadow = true;
  g.add(cab);

  // Cabinet doors with handles
  const doorW = (width - 0.35) / 3;
  for (let i = 0; i < 3; i++) {
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(doorW - 0.04, height * 0.48, 0.04),
      Mats.labPlastic(0x343c50)
    );
    door.position.set(-width / 2 + 0.25 + doorW * (i + 0.5), height * 0.32, depth / 2 - 0.14);
    g.add(door);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), Mats.chrome());
    handle.position.set(door.position.x + doorW * 0.3, door.position.y, door.position.z + 0.04);
    g.add(handle);
  }

  // Countertop (phenolic resin look)
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.08, 0.06, depth + 0.08),
    new THREE.MeshPhysicalMaterial({
      color: 0x1c2436,
      metalness: 0.1,
      roughness: 0.25,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
    })
  );
  top.position.set(0, height, 0);
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);

  // Edge strip
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.1, 0.03, 0.03),
    Mats.anodizedBlue()
  );
  edge.position.set(0, height + 0.02, depth / 2 + 0.02);
  g.add(edge);

  // Under-shelf
  if (withShelf) {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.4, 0.03, depth - 0.4),
      Mats.brushedAluminum()
    );
    shelf.position.set(0, 0.18, 0);
    g.add(shelf);
  }

  g.position.set(px, py, pz);
  engine.addStaticMesh(g);

  // Physics top as box
  const { body, bodyId } = registerBody(engine, {
    shape: 'box',
    type: BODY_TYPE.STATIC,
    mass: 0,
    size: [width, 0.06, depth],
    position: [px, height + 0.03, pz],
  });

  return { group: g, surfaceY: height + 0.03, body, bodyId, width, depth };
}

export function addSupportStand(engine, {
  position = [0, 0, 0],
  height = 1.6,
  baseSize = 0.55,
} = {}) {
  const g = new THREE.Group();
  const [px, , pz] = position;

  // Heavy base plate
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(baseSize, baseSize * 1.08, 0.06, 48),
    Mats.darkMetal()
  );
  base.position.y = 0.03;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  // Rubber feet ring
  const feet = new THREE.Mesh(
    new THREE.TorusGeometry(baseSize * 0.85, 0.025, 10, 40),
    Mats.rubber(0x111318)
  );
  feet.rotation.x = Math.PI / 2;
  feet.position.y = 0.02;
  g.add(feet);

  // Center boss
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.08, 24), Mats.chrome());
  boss.position.y = 0.1;
  g.add(boss);

  // Vertical rod
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, height, 20),
    Mats.chrome()
  );
  rod.position.y = height / 2 + 0.08;
  rod.castShadow = true;
  g.add(rod);

  // Rod tip
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), Mats.matteBlack());
  tip.position.y = height + 0.08;
  g.add(tip);

  g.position.set(px, 0, pz);
  engine.addStaticMesh(g);
  return { group: g, rodTop: height + 0.08, rodRadius: 0.028 };
}

export function addBossHeadClamp(engine, {
  position = [0, 1, 0],
  armLength = 0.35,
  rotationY = 0,
} = {}) {
  const g = new THREE.Group();
  // clamp body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.12), Mats.matteBlack());
  g.add(body);
  // thumb screw
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 16), Mats.chrome());
  screw.rotation.z = Math.PI / 2;
  screw.position.set(0.07, 0, 0);
  g.add(screw);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), Mats.anodizedOrange());
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.12, 0, 0);
  g.add(knob);
  // horizontal arm
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, armLength, 12),
    Mats.chrome()
  );
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-armLength / 2, 0, 0);
  g.add(arm);
  // jaw
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), Mats.darkMetal());
  jaw.position.set(-armLength, 0, 0);
  g.add(jaw);

  g.position.set(...position);
  g.rotation.y = rotationY;
  engine.addStaticMesh(g);
  return g;
}

export function addDigitalPanel(engine, {
  position = [0, 1.2, 0],
  width = 0.9,
  height = 0.55,
  title = 'DAQ-X1',
} = {}) {
  const g = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.08),
    Mats.labPlastic(0x1a1f2b)
  );
  shell.castShadow = true;
  g.add(shell);

  // bezel
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.92, height * 0.55, 0.02),
    Mats.matteBlack()
  );
  bezel.position.set(0, height * 0.08, 0.05);
  g.add(bezel);

  // screen
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.84, height * 0.42),
    Mats.screen()
  );
  screen.position.set(0, height * 0.08, 0.062);
  g.add(screen);

  // status LEDs
  const colors = [0x3ee0b0, 0x5b8cff, 0xffb454];
  colors.forEach((c, i) => {
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12), Mats.led(c));
    led.position.set(-width * 0.35 + i * 0.08, -height * 0.32, 0.042);
    g.add(led);
  });

  // buttons
  for (let i = 0; i < 4; i++) {
    const btn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.02, 16),
      i === 0 ? Mats.anodizedTeal() : Mats.labPlastic(0x3a4458)
    );
    btn.rotation.x = Math.PI / 2;
    btn.position.set(width * 0.15 + i * 0.1, -height * 0.32, 0.05);
    g.add(btn);
  }

  // brand strip
  const brand = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.35, 0.04, 0.01),
    Mats.anodizedBlue()
  );
  brand.position.set(-width * 0.22, height * 0.38, 0.045);
  g.add(brand);

  g.position.set(...position);
  g.userData.title = title;
  g.userData.screen = screen;
  engine.addStaticMesh(g);
  return g;
}

export function addGantryFrame(engine, {
  width = 3,
  height = 4,
  depth = 1.2,
  position = [0, 0, 0],
} = {}) {
  const g = new THREE.Group();
  const mat = Mats.brushedAluminum();
  const tube = 0.07;

  const posts = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [-width / 2, depth / 2],
    [width / 2, depth / 2],
  ];
  for (const [x, z] of posts) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(tube, height, tube), mat);
    p.position.set(x, height / 2, z);
    p.castShadow = true;
    g.add(p);
    // foot
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.18), Mats.darkMetal());
    f.position.set(x, 0.025, z);
    g.add(f);
  }

  // top beams
  for (const z of [-depth / 2, depth / 2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, tube, tube), mat);
    beam.position.set(0, height - tube / 2, z);
    beam.castShadow = true;
    g.add(beam);
  }
  for (const x of [-width / 2, width / 2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(tube, tube, depth), mat);
    beam.position.set(x, height - tube / 2, 0);
    g.add(beam);
  }

  // mid crossbar
  const mid = new THREE.Mesh(new THREE.BoxGeometry(width, tube * 0.8, tube * 0.8), mat);
  mid.position.set(0, height * 0.55, -depth / 2);
  g.add(mid);

  // branding plate
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.02), Mats.matteBlack());
  plate.position.set(0, height * 0.55, -depth / 2 - 0.04);
  g.add(plate);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.01), Mats.led(0x5b8cff));
  led.position.set(0, height * 0.55, -depth / 2 - 0.05);
  g.add(led);

  g.position.set(...position);
  engine.addStaticMesh(g);
  return { group: g, topY: height, width, depth };
}

export function addTrackRail(engine, {
  length = 12,
  width = 0.9,
  height = 0.12,
  position = [0, 0.1, 0],
  color = 0x2a3548,
} = {}) {
  const g = new THREE.Group();

  // Main extrusion profile
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, width),
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.55,
      roughness: 0.35,
      clearcoat: 0.3,
    })
  );
  bed.castShadow = true;
  bed.receiveShadow = true;
  g.add(bed);

  // Center guide groove
  const groove = new THREE.Mesh(
    new THREE.BoxGeometry(length - 0.1, 0.03, width * 0.35),
    Mats.matteBlack()
  );
  groove.position.y = height / 2 + 0.01;
  g.add(groove);

  // Side rails (anodized)
  for (const z of [-width / 2 + 0.04, width / 2 - 0.04]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.08, 0.06),
      Mats.anodizedBlue()
    );
    rail.position.set(0, height / 2 + 0.04, z);
    rail.castShadow = true;
    g.add(rail);
  }

  // Scale marks
  const markMat = Mats.warningYellow();
  for (let i = 0; i <= Math.floor(length); i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.12), markMat);
    m.position.set(-length / 2 + i, height / 2 + 0.02, width / 2 - 0.15);
    g.add(m);
  }

  // End caps
  for (const x of [-length / 2, length / 2]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.08, height + 0.1, width + 0.05), Mats.darkMetal());
    cap.position.set(x, 0.02, 0);
    g.add(cap);
  }

  g.position.set(...position);
  engine.addStaticMesh(g);
  return g;
}

export function addLaserSensor(engine, position = [0, 0.5, 0], color = 0xff3355) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.18), Mats.matteBlack());
  body.castShadow = true;
  g.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16), Mats.led(color));
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.1;
  g.add(lens);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.6, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
  );
  beam.rotation.x = Math.PI / 2;
  beam.position.z = 0.4;
  g.add(beam);
  g.position.set(...position);
  engine.addStaticMesh(g);
  return g;
}

export function addCable(engine, points, color = 0x22262e) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, 32, 0.012, 8, false);
  const mesh = new THREE.Mesh(geo, Mats.rubber(color));
  mesh.castShadow = true;
  engine.addStaticMesh(mesh);
  return mesh;
}

export function createPhysicsSphere(engine, {
  radius = 0.3,
  position = [0, 1, 0],
  mass = 1,
  colorMat = null,
  restitution = 0.3,
  friction = 0.3,
} = {}) {
  const mat = colorMat || Mats.anodizedBlue();
  const visual = makeLabSphere(radius, mat);
  visual.position.set(...position);

  const { body, bodyId } = registerBody(engine, {
    shape: 'sphere',
    radius,
    position,
    mass,
    restitution,
    friction,
    linearDamping: 0.01,
    angularDamping: 0.08,
  }, visual);

  engine.scene.add(visual);
  engine.meshes.push(visual);

  return { mesh: visual, body, bodyId, radius };
}

export function createPhysicsBlock(engine, {
  size = [0.6, 0.4, 0.5],
  position = [0, 1, 0],
  mass = 1,
  colorMat = null,
  restitution = 0.1,
  friction = 0.4,
  rotation = [0, 0, 0],
} = {}) {
  const [sx, sy, sz] = size;
  const mat = colorMat || Mats.anodizedBlue();
  const visual = makeLabBlock(sx, sy, sz, mat);
  visual.position.set(...position);
  visual.rotation.set(...rotation);

  const { body, bodyId } = registerBody(engine, {
    shape: 'box',
    size: [sx, sy, sz],
    position,
    mass,
    restitution,
    friction,
    rotation,
  }, visual);

  engine.scene.add(visual);
  engine.meshes.push(visual);

  return { mesh: visual, body, bodyId, size };
}

/** Soft glowing trajectory ribbon */
export function createGlowTrail(engine, color = 0x3ee0b0, maxPoints = 240) {
  const positions = new Float32Array(maxPoints * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    linewidth: 2,
  });
  const line = new THREE.Line(geo, mat);
  engine.scene.add(line);
  const trail = { line, positions, count: 0, maxPoints };
  engine.trails.push(trail);
  return trail;
}
