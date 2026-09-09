import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Create shared geometry helpers while keeping material ownership with callers. */
export function createPrimitives() {
  function rbox(w, h, d, material, radius = 0.03, segments = 3) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, radius), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function box(w, h, d, material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function cyl(rTop, rBot, h, material, segs = 32) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function sphere(r, material, segs = 32) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, segs, segs), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function torus(r, tube, material, rs = 12, ts = 32) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, rs, ts), material);
    m.castShadow = true;
    return m;
  }


  return { rbox, box, cyl, sphere, torus };
}
