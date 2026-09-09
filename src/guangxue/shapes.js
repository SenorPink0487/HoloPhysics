/**
 * Optical sample geometries — ported from guangxue-source `shapes.ts`.
 */
import * as THREE from 'three';

export function isMirrorShape(kind) {
  return kind === 'mirror' || kind === 'mirror-convex';
}

/** Equilateral triangular prism — lab-scale */
export function createPrismGeometry(size = 1.35, depth = 1.0) {
  const h = (Math.sqrt(3) / 2) * size;
  const shape = new THREE.Shape();
  const y0 = -h / 3;
  shape.moveTo(-size / 2, y0);
  shape.lineTo(size / 2, y0);
  shape.lineTo(0, y0 + h);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  geom.translate(0, 0, -depth / 2);
  geom.computeVertexNormals();
  return geom;
}

export function createSphereGeometry(radius = 0.7) {
  // detail 2 ≈ 320 tris (detail 4 ≈ 5120) — ray–mesh walk is O(tris×bounces×rays).
  const geom = new THREE.IcosahedronGeometry(radius, 2);
  geom.computeVertexNormals();
  return geom;
}

export function createBlockGeometry(w = 1.4, h = 0.95, d = 1.0) {
  const geom = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  geom.computeVertexNormals();
  return geom;
}

export function createCylinderGeometry(radius = 0.55, height = 1.2) {
  const geom = new THREE.CylinderGeometry(radius, radius, height, 28, 1, false);
  geom.rotateZ(Math.PI / 2);
  geom.computeVertexNormals();
  return geom;
}

export function createMirrorGeometry(height = 1.35, width = 1.15, thickness = 0.07) {
  const geom = new THREE.BoxGeometry(thickness, height, width, 1, 1, 1);
  geom.computeVertexNormals();
  return geom;
}

export function createConvexMirrorGeometry(radius = 0.72) {
  const geom = new THREE.IcosahedronGeometry(radius, 2);
  geom.computeVertexNormals();
  return geom;
}

export function createGeometry(kind) {
  switch (kind) {
    case 'sphere':
      return createSphereGeometry();
    case 'block':
      return createBlockGeometry();
    case 'cylinder':
      return createCylinderGeometry();
    case 'mirror':
      return createMirrorGeometry();
    case 'mirror-convex':
      return createConvexMirrorGeometry();
    case 'prism':
    default:
      return createPrismGeometry();
  }
}
