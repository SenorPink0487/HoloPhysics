/**
 * Optical bench apparatus — ported from guangxue-source `lab-bench.ts`.
 * Includes source floor island + desk-lamp point light for material/ray fidelity.
 * Host still owns global fog/camera; this group is a self-contained source lab island.
 */
import * as THREE from 'three';

const wood = 0xc4a882;
const woodDark = 0x9a7b58;
const metal = 0x8a9199;
const metalDark = 0x5c636b;
const metalLight = 0xb8c0c8;
const blackPlastic = 0x2a2e32;
const cream = 0xf2ebe0;
const brass = 0xc9a05a;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.15,
    ...opts,
  });
}

function box(w, h, d, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rTop, rBot, h, segs, color, opts) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, segs),
    mat(color, opts),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Lab room floor + soft wall strip — source `createLabFloor` (island under bench). */
export function createLabFloor() {
  const g = new THREE.Group();
  g.name = 'geo-lab-floor';

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 28),
    mat(0xe8e2d6, { roughness: 0.92, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.85;
  floor.receiveShadow = true;
  g.add(floor);

  const grid = new THREE.GridHelper(36, 36, 0xd4cbb8, 0xddd4c4);
  grid.position.y = -1.84;
  const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMats.forEach((m) => {
    m.transparent = true;
    if ('opacity' in m) m.opacity = 0.35;
  });
  g.add(grid);

  const wall = box(36, 8, 0.15, 0xf0ebe3, { roughness: 0.95, metalness: 0 });
  wall.position.set(0, 2.1, -8);
  wall.receiveShadow = true;
  g.add(wall);

  const skirt = box(36, 0.18, 0.2, 0xd8cfc0, { roughness: 0.8 });
  skirt.position.set(0, -1.72, -7.9);
  g.add(skirt);

  return g;
}

/** Main optical bench table with scale rail */
export function createOpticalBench() {
  const g = new THREE.Group();
  g.name = 'geo-optical-bench';

  // Narrow the tabletop crosswise to preserve a clear sitting-edge lane for
  // the host's physical parameter panel.
  const top = box(14.5, 0.18, 2.4, wood, { roughness: 0.65, metalness: 0.02 });
  top.position.y = -1.35;
  g.add(top);

  const trim = box(14.7, 0.08, 2.55, woodDark, { roughness: 0.55 });
  trim.position.y = -1.47;
  g.add(trim);

  const legPositions = [
    [-6.5, -1.3],
    [6.5, -1.3],
    [-6.5, 1.3],
    [6.5, 1.3],
  ];
  for (const [x, z] of legPositions) {
    const leg = box(0.22, 0.55, 0.22, woodDark, { roughness: 0.7 });
    leg.position.set(x, -1.7, z);
    g.add(leg);
  }

  const railBase = box(13.2, 0.08, 0.55, metalDark, { metalness: 0.55, roughness: 0.4 });
  railBase.position.set(0, -1.22, 0);
  g.add(railBase);

  const railTop = box(13.2, 0.06, 0.28, metal, { metalness: 0.65, roughness: 0.35 });
  railTop.position.set(0, -1.15, 0);
  g.add(railTop);

  for (let i = -6; i <= 6; i++) {
    const isMajor = i % 2 === 0;
    const tick = box(0.02, isMajor ? 0.07 : 0.04, 0.12, cream, { roughness: 0.5 });
    tick.position.set(i, -1.1, 0.22);
    g.add(tick);
    if (isMajor) {
      const plate = box(0.28, 0.01, 0.16, 0xf5f0e6);
      plate.position.set(i, -1.095, 0.42);
      g.add(plate);
    }
  }

  const stopL = box(0.12, 0.28, 0.7, metalDark, { metalness: 0.5, roughness: 0.4 });
  stopL.position.set(-6.7, -1.1, 0);
  g.add(stopL);
  const stopR = stopL.clone();
  stopR.position.x = 6.7;
  g.add(stopR);

  const label = box(2.4, 0.04, 0.35, 0xf7f2e8);
  label.position.set(0, -1.22, 1.05);
  g.add(label);

  return g;
}

/** Ray box / laser light source on a rider */
export function createRayBox() {
  const g = new THREE.Group();
  g.name = 'geo-ray-box';

  const base = box(1.1, 0.14, 1.0, metalDark, { metalness: 0.5, roughness: 0.45 });
  base.position.y = -1.05;
  g.add(base);

  const screw = cyl(0.06, 0.06, 0.2, 12, brass, { metalness: 0.7, roughness: 0.3 });
  screw.position.set(0.35, -0.92, 0.35);
  g.add(screw);
  const knob = cyl(0.1, 0.1, 0.06, 16, brass, { metalness: 0.7, roughness: 0.35 });
  knob.position.set(0.35, -0.8, 0.35);
  g.add(knob);

  const body = box(0.85, 0.7, 0.75, blackPlastic, { roughness: 0.5, metalness: 0.1 });
  body.position.set(0, -0.55, 0);
  g.add(body);

  const bezel = box(0.12, 0.55, 0.6, metal, { metalness: 0.55, roughness: 0.4 });
  bezel.position.set(0.48, -0.55, 0);
  g.add(bezel);

  const slit = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.32, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xffe0a0,
      emissive: 0xffb040,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    }),
  );
  slit.position.set(0.55, -0.55, 0);
  g.add(slit);

  for (let i = -1; i <= 1; i++) {
    const vent = box(0.5, 0.02, 0.04, metalDark);
    vent.position.set(0, -0.18, i * 0.12);
    g.add(vent);
  }

  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0x40ff80,
      emissive: 0x20c060,
      emissiveIntensity: 1.5,
    }),
  );
  led.position.set(-0.25, -0.18, 0.3);
  g.add(led);

  const switchBody = box(0.2, 0.08, 0.12, metalLight, { metalness: 0.4, roughness: 0.4 });
  switchBody.position.set(-0.2, -0.18, -0.25);
  g.add(switchBody);

  const plate = box(0.5, 0.02, 0.18, 0xe8e4dc);
  plate.position.set(0, -0.35, 0.38);
  g.add(plate);

  g.userData.slit = slit;
  g.userData.interactive = true;
  g.userData.role = 'geo_source';
  return g;
}

/** Collimating slit / diaphragm on rider */
export function createSlitHolder() {
  const g = new THREE.Group();
  g.name = 'geo-slit-holder';

  const base = box(0.7, 0.12, 0.85, metalDark, { metalness: 0.5, roughness: 0.45 });
  base.position.y = -1.06;
  g.add(base);

  const post = cyl(0.05, 0.05, 0.85, 12, metal, { metalness: 0.6, roughness: 0.35 });
  post.position.y = -0.6;
  g.add(post);

  const frame = box(0.12, 0.7, 0.55, blackPlastic, { roughness: 0.55 });
  frame.position.set(0, -0.45, 0);
  g.add(frame);

  const opening = box(0.04, 0.4, 0.04, 0x111111);
  opening.position.set(0.08, -0.45, 0);
  g.add(opening);

  const kn = cyl(0.05, 0.05, 0.08, 12, brass, { metalness: 0.7, roughness: 0.3 });
  kn.rotation.z = Math.PI / 2;
  kn.position.set(0, -0.15, 0.2);
  g.add(kn);

  g.userData.interactive = true;
  g.userData.role = 'geo_slit';
  return g;
}

/** Prism table / sample stage with protractor */
export function createPrismTable() {
  const g = new THREE.Group();
  g.name = 'geo-prism-table';

  const base = box(1.4, 0.14, 1.3, metalDark, { metalness: 0.5, roughness: 0.45 });
  base.position.y = -1.05;
  g.add(base);

  const col = cyl(0.14, 0.18, 0.35, 24, metal, { metalness: 0.55, roughness: 0.4 });
  col.position.y = -0.85;
  g.add(col);

  const disc = cyl(0.85, 0.85, 0.05, 64, 0xf5f0e6, { roughness: 0.7, metalness: 0.05 });
  disc.position.y = -0.65;
  g.add(disc);

  const tickGroup = new THREE.Group();
  for (let deg = 0; deg < 360; deg += 5) {
    const major = deg % 30 === 0;
    const rad = (deg * Math.PI) / 180;
    const r0 = major ? 0.68 : 0.75;
    const r1 = 0.83;
    const x0 = Math.cos(rad) * r0;
    const z0 = Math.sin(rad) * r0;
    const x1 = Math.cos(rad) * r1;
    const z1 = Math.sin(rad) * r1;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x0, 0, z0),
      new THREE.Vector3(x1, 0, z1),
    ]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: major ? 0x5a5048 : 0xa89888,
        transparent: true,
        opacity: major ? 0.85 : 0.45,
      }),
    );
    tickGroup.add(line);
  }
  tickGroup.position.y = -0.62;
  g.add(tickGroup);

  const index = box(0.03, 0.02, 0.12, 0xc04030);
  index.position.set(0, -0.61, -0.9);
  g.add(index);

  const platform = cyl(0.55, 0.55, 0.06, 32, metalLight, { metalness: 0.4, roughness: 0.45 });
  platform.position.y = -0.58;
  g.add(platform);

  const rotKnob = cyl(0.12, 0.12, 0.08, 16, brass, { metalness: 0.7, roughness: 0.3 });
  rotKnob.position.set(0.55, -0.95, 0.45);
  g.add(rotKnob);

  g.userData.platformY = -0.45;
  g.userData.interactive = true;
  g.userData.role = 'geo_sample';
  return g;
}

/** Observation screen for spectrum / ray spots */
export function createScreen() {
  const g = new THREE.Group();
  g.name = 'geo-screen';

  const base = box(0.9, 0.12, 1.1, metalDark, { metalness: 0.5, roughness: 0.45 });
  base.position.y = -1.06;
  g.add(base);

  for (const z of [-0.4, 0.4]) {
    const post = cyl(0.04, 0.04, 1.5, 10, metal, { metalness: 0.55, roughness: 0.4 });
    post.position.set(0, -0.3, z);
    g.add(post);
  }

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1.35, 1.6),
    new THREE.MeshStandardMaterial({
      color: 0xfaf6ef,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  board.position.set(0, -0.25, 0);
  board.castShadow = true;
  board.receiveShadow = true;
  board.name = 'screenBoard';
  g.add(board);

  const frameMat = mat(metalDark, { metalness: 0.5, roughness: 0.4 });
  const ft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 1.7), frameMat);
  ft.position.set(0, 0.45, 0);
  g.add(ft);
  const fb = ft.clone();
  fb.position.y = -0.95;
  g.add(fb);

  const scaleGroup = new THREE.Group();
  const hLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.045, -0.25, -0.72),
      new THREE.Vector3(0.045, -0.25, 0.72),
    ]),
    new THREE.LineBasicMaterial({ color: 0xb0a090, transparent: true, opacity: 0.5 }),
  );
  scaleGroup.add(hLine);

  for (let i = -5; i <= 5; i++) {
    const major = i % 5 === 0;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.045, -0.25, i * 0.12),
      new THREE.Vector3(0.045, -0.25 + (major ? 0.1 : 0.05), i * 0.12),
    ]);
    scaleGroup.add(
      new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: major ? 0x6a6058 : 0xb0a090,
          transparent: true,
          opacity: 0.55,
        }),
      ),
    );
  }
  g.add(scaleGroup);

  const plate = box(0.5, 0.1, 0.02, 0xe8e0d4);
  plate.position.set(0, 0.55, 0);
  g.add(plate);

  g.userData.board = board;
  g.userData.interactive = true;
  g.userData.role = 'geo_screen';
  return g;
}

export function createLabAccessories() {
  const g = new THREE.Group();
  g.name = 'geo-accessories';

  // Park notes / pen on the back half of the board (local −Z) so the host
  // sitting-edge desk panel has a clear front strip on the optics table.
  const note = box(1.2, 0.04, 0.9, 0xf7f4ec, { roughness: 0.8 });
  note.position.set(4.2, -1.23, -1.15);
  note.rotation.y = -0.12;
  g.add(note);

  const noteLine = box(1.0, 0.005, 0.02, 0xd0c8b8);
  noteLine.position.set(4.2, -1.20, -1.30);
  noteLine.rotation.y = -0.12;
  g.add(noteLine);

  const pen = cyl(0.025, 0.025, 0.7, 8, 0x3a6a8a, { roughness: 0.4, metalness: 0.2 });
  pen.rotation.z = Math.PI / 2;
  pen.rotation.y = -0.35;
  pen.position.set(3.4, -1.2, -1.05);
  g.add(pen);

  // Instrument case on the back-right — clear of the front control zone.
  const boxMesh = box(0.9, 0.35, 0.6, 0x6a8a9a, { roughness: 0.5, metalness: 0.15 });
  boxMesh.position.set(5.4, -1.1, -1.05);
  g.add(boxMesh);
  const lid = box(0.92, 0.04, 0.62, 0x5a7a8a, { roughness: 0.45 });
  lid.position.set(5.4, -0.9, -1.05);
  g.add(lid);

  return g;
}

export function createDeskLamp() {
  const g = new THREE.Group();
  g.name = 'geo-desk-lamp';
  g.position.set(5.8, -1.26, -1.3);

  const base = cyl(0.25, 0.3, 0.08, 20, metalDark, { metalness: 0.5, roughness: 0.4 });
  g.add(base);

  const arm = cyl(0.035, 0.035, 1.1, 10, metal, { metalness: 0.55, roughness: 0.35 });
  arm.position.set(0, 0.55, 0);
  arm.rotation.z = 0.25;
  g.add(arm);

  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.35, 20, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xf0e6d4,
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  shade.position.set(-0.25, 1.05, 0);
  shade.rotation.z = Math.PI + 0.4;
  g.add(shade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xfff0d0,
      emissive: 0xffd080,
      emissiveIntensity: 1.2,
    }),
  );
  bulb.position.set(-0.2, 0.95, 0);
  g.add(bulb);

  // Local key on the optical bench only; short range prevents leaking into lab room
  const light = new THREE.PointLight(0xffe8c8, 0.45, 2.2, 2);
  light.position.copy(bulb.position);
  light.userData.sourceDeskLamp = true;
  g.add(light);

  return g;
}

/** Source rail positions along X (lab local). */
export const GEO_POS = Object.freeze({
  source: -5.2,
  slit: -3.6,
  sample: 0,
  screen: 4.6,
});
