/**
 * Geometric optics core — ported from guangxue-source `optics.ts`.
 * Single source of truth for ray–mesh intersection, Snell / reflection, and Cauchy n(λ).
 *
 * Performance notes:
 *  - intersectMesh reuses scratch vectors and early-outs on bounding sphere.
 *  - Bounce caps keep multi-ray rebuilds (dispersion / fan beams) under a frame budget.
 */
import * as THREE from 'three';

/** Wavelength (nm) → approximate RGB for visible spectrum visualization */
export function wavelengthToRGB(nm) {
  let r = 0;
  let g = 0;
  let b = 0;

  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380);
    b = 1;
  } else if (nm >= 440 && nm < 490) {
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm >= 490 && nm < 510) {
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
  } else if (nm >= 580 && nm < 645) {
    r = 1;
    g = -(nm - 645) / (645 - 580);
  } else if (nm >= 645 && nm <= 780) {
    r = 1;
  }

  let factor = 1;
  if (nm >= 380 && nm < 420) factor = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700 && nm <= 780) factor = 0.3 + (0.7 * (780 - nm)) / 80;

  const gamma = 0.85;
  return new THREE.Color(
    Math.pow(r * factor, gamma),
    Math.pow(g * factor, gamma),
    Math.pow(b * factor, gamma),
  );
}

/** Cauchy's equation: n(λ) = A + B/λ²  (λ in μm), anchored at sodium D. */
export function cauchyIOR(baseIOR, nm, strength) {
  const lambdaUm = nm / 1000;
  const B = 0.008 * strength;
  const A = baseIOR - B / (0.589 * 0.589);
  return A + B / (lambdaUm * lambdaUm);
}

// ── Scratch pool (intersect is hot path: no per-triangle allocations) ──
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _pvec = new THREE.Vector3();
const _tvec = new THREE.Vector3();
const _qvec = new THREE.Vector3();
const _nScratch = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _localOrigin = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _invMatrix = new THREE.Matrix4();
const _normalMatrix = new THREE.Matrix3();
const _hitPoint = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _sphereCenter = new THREE.Vector3();
const _oc = new THREE.Vector3();
const _I = new THREE.Vector3();
const _N = new THREE.Vector3();
const _R = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();

function rayTriangle(origin, dir, v0, v1, v2, tMin, tMax) {
  const eps = 1e-8;
  _e1.subVectors(v1, v0);
  _e2.subVectors(v2, v0);
  _pvec.crossVectors(dir, _e2);
  const det = _e1.dot(_pvec);
  if (Math.abs(det) < eps) return null;
  const invDet = 1 / det;
  _tvec.subVectors(origin, v0);
  const u = _tvec.dot(_pvec) * invDet;
  if (u < 0 || u > 1) return null;
  _qvec.crossVectors(_tvec, _e1);
  const v = dir.dot(_qvec) * invDet;
  if (v < 0 || u + v > 1) return null;
  const t = _e2.dot(_qvec) * invDet;
  if (t < tMin || t > tMax) return null;

  _nScratch.crossVectors(_e1, _e2).normalize();
  if (_nScratch.dot(dir) > 0) _nScratch.negate();

  return {
    point: origin.clone().addScaledVector(dir, t),
    normal: _nScratch.clone(),
    distance: t,
  };
}

/** Write hit into reusable buffers; returns true on hit (no alloc on miss). */
function rayTriangleInto(origin, dir, v0, v1, v2, tMin, tMax, out) {
  const eps = 1e-8;
  _e1.subVectors(v1, v0);
  _e2.subVectors(v2, v0);
  _pvec.crossVectors(dir, _e2);
  const det = _e1.dot(_pvec);
  if (Math.abs(det) < eps) return false;
  const invDet = 1 / det;
  _tvec.subVectors(origin, v0);
  const u = _tvec.dot(_pvec) * invDet;
  if (u < 0 || u > 1) return false;
  _qvec.crossVectors(_tvec, _e1);
  const v = dir.dot(_qvec) * invDet;
  if (v < 0 || u + v > 1) return false;
  const t = _e2.dot(_qvec) * invDet;
  if (t < tMin || t > tMax) return false;

  _nScratch.crossVectors(_e1, _e2).normalize();
  if (_nScratch.dot(dir) > 0) _nScratch.negate();
  out.t = t;
  out.nx = _nScratch.x;
  out.ny = _nScratch.y;
  out.nz = _nScratch.z;
  return true;
}

const _triHit = { t: 0, nx: 0, ny: 0, nz: 0 };

/** Ray vs sphere early-out in local space (geom.boundingSphere). */
function rayHitsLocalSphere(origin, dir, center, radius, tMax) {
  _oc.subVectors(origin, center);
  const b = _oc.dot(dir);
  const c = _oc.dot(_oc) - radius * radius;
  if (c > 0 && b > 0) return false;
  const disc = b * b - c;
  if (disc < 0) return false;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t <= tMax;
}

/** Find nearest intersection of a ray with a BufferGeometry mesh */
export function intersectMesh(origin, dir, mesh, tMin = 1e-4, tMax = 100) {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  if (!pos) return null;

  if (!geom.boundingSphere) geom.computeBoundingSphere();
  const bs = geom.boundingSphere;

  _invMatrix.copy(mesh.matrixWorld).invert();
  _localOrigin.copy(origin).applyMatrix4(_invMatrix);
  _localDir.copy(dir).transformDirection(_invMatrix).normalize();

  if (bs) {
    _sphereCenter.copy(bs.center);
    // Slightly pad so numerical error near silhouette does not miss.
    if (!rayHitsLocalSphere(_localOrigin, _localDir, _sphereCenter, bs.radius * 1.02, tMax)) {
      return null;
    }
  }

  let bestT = tMax;
  let bestNx = 0;
  let bestNy = 0;
  let bestNz = 0;
  let found = false;
  const index = geom.index;
  const posArr = pos.array;
  const indexArr = index ? index.array : null;
  const triCount = index ? index.count / 3 : pos.count / 3;

  for (let i = 0; i < triCount; i++) {
    let i0; let i1; let i2;
    if (indexArr) {
      i0 = indexArr[i * 3] * 3;
      i1 = indexArr[i * 3 + 1] * 3;
      i2 = indexArr[i * 3 + 2] * 3;
    } else {
      i0 = i * 9;
      i1 = i0 + 3;
      i2 = i0 + 6;
    }
    _v0.set(posArr[i0], posArr[i0 + 1], posArr[i0 + 2]);
    _v1.set(posArr[i1], posArr[i1 + 1], posArr[i1 + 2]);
    _v2.set(posArr[i2], posArr[i2 + 1], posArr[i2 + 2]);

    if (!rayTriangleInto(_localOrigin, _localDir, _v0, _v1, _v2, tMin, bestT, _triHit)) continue;
    bestT = _triHit.t;
    bestNx = _triHit.nx;
    bestNy = _triHit.ny;
    bestNz = _triHit.nz;
    found = true;
  }

  if (!found) return null;

  _hitPoint.copy(_localOrigin).addScaledVector(_localDir, bestT).applyMatrix4(mesh.matrixWorld);
  _hitNormal.set(bestNx, bestNy, bestNz);
  _normalMatrix.getNormalMatrix(mesh.matrixWorld);
  _hitNormal.applyMatrix3(_normalMatrix).normalize();
  if (_hitNormal.dot(dir) > 0) _hitNormal.negate();

  return {
    point: _hitPoint.clone(),
    normal: _hitNormal.clone(),
    distance: _hitPoint.distanceTo(origin),
  };
}

/** Snell's law refraction. Returns null on total internal reflection. */
export function refract(incident, normal, n1, n2) {
  _I.copy(incident).normalize();
  _N.copy(normal).normalize();
  let eta = n1 / n2;
  let cosi = -_I.dot(_N);

  if (cosi < 0) {
    cosi = -cosi;
    _N.negate();
    eta = n2 / n1;
  }

  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;

  return _I.multiplyScalar(eta).addScaledVector(_N, eta * cosi - Math.sqrt(k)).normalize().clone();
}

export function reflect(incident, normal) {
  _I.copy(incident).normalize();
  _N.copy(normal).normalize();
  return _I.sub(_N.multiplyScalar(2 * _I.dot(_N))).normalize().clone();
}

/** Dielectric bounce cap — pedagogy-complete for prism/lens without 8× mesh walks. */
const MAX_BOUNCES = 5;
const RAY_LENGTH = 12;

function angleFromNormal(dir, normal) {
  const cosi = Math.abs(_tmpDir.copy(dir).normalize().dot(_N.copy(normal).normalize()));
  return Math.acos(Math.min(1, Math.max(0, cosi))) * (180 / Math.PI);
}

function traceMirrorRay(origin, direction, mesh, color, options) {
  const maxBounces = options.mirrorBounces ?? 3;
  const segments = [];
  let pos = origin.clone();
  let dir = direction.clone().normalize();
  let firstIncidentAngle = null;
  let firstReflectAngle = null;
  let bounce = 0;

  while (bounce <= maxBounces) {
    const hit = intersectMesh(pos, dir, mesh);
    if (!hit) {
      segments.push({
        start: pos.clone(),
        end: pos.clone().addScaledVector(dir, RAY_LENGTH),
        color: bounce === 0
          ? color.clone()
          : color.clone().lerp(new THREE.Color(0xa8d4ff), 0.12),
        kind: bounce === 0 ? 'incident' : 'reflected',
        intensity: bounce === 0 ? 1 : 0.95,
      });
      break;
    }

    segments.push({
      start: pos.clone(),
      end: hit.point.clone(),
      color: bounce === 0
        ? color.clone()
        : color.clone().lerp(new THREE.Color(0xa8d4ff), 0.12),
      kind: bounce === 0 ? 'incident' : 'reflected',
      intensity: bounce === 0 ? 1 : 0.92,
    });

    if (bounce >= maxBounces) break;

    const N = hit.normal.clone();
    const incidentAngle = angleFromNormal(dir, N);
    if (firstIncidentAngle === null) firstIncidentAngle = incidentAngle;

    const R = reflect(dir, N);
    const reflectAngle = angleFromNormal(R, N);
    if (firstReflectAngle === null) firstReflectAngle = reflectAngle;

    dir = R;
    pos = hit.point.clone().addScaledVector(dir, 1e-3);
    bounce++;
  }

  return {
    segments,
    firstIncidentAngle,
    firstRefractAngle: null,
    firstReflectAngle,
  };
}

function traceDielectricRay(origin, direction, mesh, ior, color, options) {
  const showReflect = options.showReflect ?? true;
  const airIOR = options.airIOR ?? 1.0;
  const segments = [];
  let pos = origin.clone();
  let dir = direction.clone().normalize();
  let inside = false;
  let firstIncidentAngle = null;
  let firstRefractAngle = null;
  let firstReflectAngle = null;

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    const hit = intersectMesh(pos, dir, mesh);
    const endFar = pos.clone().addScaledVector(dir, RAY_LENGTH);

    if (!hit) {
      segments.push({
        start: pos.clone(),
        end: endFar,
        color: color.clone(),
        kind: inside ? 'refracted' : bounce === 0 ? 'incident' : 'refracted',
        intensity: inside ? 0.85 : 1,
      });
      break;
    }

    segments.push({
      start: pos.clone(),
      end: hit.point.clone(),
      color: color.clone(),
      kind: bounce === 0 ? 'incident' : inside ? 'refracted' : 'incident',
      intensity: inside ? 0.9 : 1,
    });

    const n1 = inside ? ior : airIOR;
    const n2 = inside ? airIOR : ior;
    const N = hit.normal.clone();
    const incidentAngle = angleFromNormal(dir, N);

    if (firstIncidentAngle === null && !inside) {
      firstIncidentAngle = incidentAngle;
    }

    if (showReflect) {
      const R = reflect(dir, N);
      const reflectAngle = angleFromNormal(R, N);
      if (firstReflectAngle === null && !inside) firstReflectAngle = reflectAngle;
      const reflectEnd = hit.point.clone().addScaledVector(R, RAY_LENGTH * 0.55);
      const cosi = Math.abs(dir.dot(N));
      const fresnel = Math.pow(1 - cosi, 2) * 0.35 + 0.08;
      segments.push({
        start: hit.point.clone(),
        end: reflectEnd,
        color: color.clone().lerp(new THREE.Color(0xffffff), 0.25),
        kind: 'reflected',
        intensity: fresnel,
      });
    }

    const T = refract(dir, N, n1, n2);
    if (!T) {
      dir = reflect(dir, N);
      pos = hit.point.clone().addScaledVector(dir, 1e-3);
      continue;
    }

    if (firstRefractAngle === null && !inside) {
      firstRefractAngle = angleFromNormal(T, N);
    }

    inside = !inside;
    dir = T;
    pos = hit.point.clone().addScaledVector(dir, 1e-3);
  }

  return { segments, firstIncidentAngle, firstRefractAngle, firstReflectAngle };
}

/**
 * Trace a light ray through a refractive mesh or off a mirror using geometric optics.
 * mode: 'dielectric' | 'mirror'
 */
export function traceRay(origin, direction, mesh, ior, color, options = {}) {
  const mode = options.mode ?? 'dielectric';
  if (mode === 'mirror') {
    return traceMirrorRay(origin, direction, mesh, color, options);
  }
  return traceDielectricRay(origin, direction, mesh, ior, color, options);
}

/** Sample wavelengths across visible spectrum */
export function spectrumWavelengths(count) {
  if (count <= 1) return [580];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(400 + (700 - 400) * (i / (count - 1)));
  }
  return out;
}

/** Ideal Snell ratio from air into medium (for table verification). */
export function snellRatio(theta1Deg, theta2Deg) {
  if (theta2Deg == null || !Number.isFinite(theta2Deg) || theta2Deg <= 0.05) return null;
  const s1 = Math.sin((theta1Deg * Math.PI) / 180);
  const s2 = Math.sin((theta2Deg * Math.PI) / 180);
  if (Math.abs(s2) < 1e-9) return null;
  return s1 / s2;
}

/** Critical angle (deg) from denser n1 into air n2≈1. */
export function criticalAngleDeg(n1, n2 = 1) {
  if (!(n1 > n2) || n1 <= 0) return null;
  const s = n2 / n1;
  if (s >= 1) return null;
  return (Math.asin(s) * 180) / Math.PI;
}

// Keep rayTriangle export surface free of unused lint if tests import internals.
export const __test = { rayTriangle };
