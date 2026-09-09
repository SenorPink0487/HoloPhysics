import * as THREE from 'three';
import { chrome, darkMetal, metal, plastic, rubber } from './materials.js';

/** Flanged pipe segment */
export function makePipe(radius, length, color = 0x9aa3b2) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 32),
    metal(color, { roughness: 0.35 })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const flangeGeo = new THREE.CylinderGeometry(radius * 1.45, radius * 1.45, radius * 0.35, 32);
  const f1 = new THREE.Mesh(flangeGeo, darkMetal());
  f1.position.y = length / 2;
  const f2 = f1.clone();
  f2.position.y = -length / 2;
  g.add(f1, f2);
  return g;
}

/** Lab support stand with base + rod */
export function makeRetortStand(height = 2.8) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.08, 0.7),
    darkMetal(0x2a303c)
  );
  base.position.y = 0.04;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, height, 16),
    chrome()
  );
  rod.position.set(-0.35, height / 2 + 0.08, 0);
  rod.castShadow = true;
  g.add(rod);

  return g;
}

/** Digital readout panel (flat box + optional canvas texture) */
export function makeInstrumentPanel(w = 1.2, h = 0.7, depth = 0.12) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, depth),
    plastic(0x141a24)
  );
  shell.castShadow = true;
  g.add(shell);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.92, h * 0.72, 0.02),
    darkMetal(0x0d121a)
  );
  bezel.position.z = depth / 2 + 0.01;
  g.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.86, h * 0.62),
    new THREE.MeshStandardMaterial({
      color: 0x061018,
      emissive: 0x00c8a0,
      emissiveIntensity: 0.15,
      roughness: 0.3,
    })
  );
  screen.position.z = depth / 2 + 0.025;
  g.add(screen);
  g.userData.screen = screen;
  return g;
}

/** Bolt ring decoration on a face */
export function addBoltRing(parent, radius, count = 8, z = 0) {
  const boltGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8);
  const mat = darkMetal(0x3a4250);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = new THREE.Mesh(boltGeo, mat);
    b.rotation.x = Math.PI / 2;
    b.position.set(Math.cos(a) * radius, Math.sin(a) * radius, z);
    parent.add(b);
  }
}

/** Cable / hose between two points (simple tube) */
export function makeHose(points, radius = 0.04, color = 0x1e2430) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, 32, radius, 8, false);
  const mesh = new THREE.Mesh(geo, rubber(color));
  mesh.castShadow = true;
  return mesh;
}

/** Rounded table / optical bench surface */
export function makeLabBench(width = 8, depth = 3.2, height = 0.9) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.08, depth),
    new THREE.MeshStandardMaterial({
      color: 0x1c2433,
      metalness: 0.35,
      roughness: 0.45,
    })
  );
  top.position.y = height;
  top.receiveShadow = true;
  top.castShadow = true;
  g.add(top);

  // edge strip
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.04, 0.04, depth + 0.04),
    metal(0x5a6578, { roughness: 0.4 })
  );
  edge.position.y = height - 0.05;
  g.add(edge);

  // legs
  const legGeo = new THREE.BoxGeometry(0.1, height - 0.05, 0.1);
  const legMat = darkMetal(0x252b38);
  const offsets = [
    [width / 2 - 0.25, depth / 2 - 0.25],
    [-width / 2 + 0.25, depth / 2 - 0.25],
    [width / 2 - 0.25, -depth / 2 + 0.25],
    [-width / 2 + 0.25, -depth / 2 + 0.25],
  ];
  offsets.forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, (height - 0.05) / 2, z);
    leg.castShadow = true;
    g.add(leg);
  });

  // under-shelf
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.4, 0.04, depth - 0.3),
    plastic(0x161c28)
  );
  shelf.position.y = height * 0.35;
  g.add(shelf);

  g.userData.topY = height;
  return g;
}

/** Create a canvas-based digital display sprite/texture */
export function makeDigitalTexture(lines, w = 512, h = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const paint = (dataLines) => {
    ctx.fillStyle = '#041018';
    ctx.fillRect(0, 0, w, h);
    // scanlines
    ctx.fillStyle = 'rgba(0,200,160,0.04)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    // border glow
    ctx.strokeStyle = 'rgba(0, 212, 170, 0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.font = '600 28px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00e5b0';
    ctx.textBaseline = 'top';
    (dataLines || lines).forEach((line, i) => {
      ctx.fillText(line, 28, 28 + i * 42);
    });
  };
  paint(lines);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { texture: tex, canvas, ctx, paint, width: w, height: h };
}
