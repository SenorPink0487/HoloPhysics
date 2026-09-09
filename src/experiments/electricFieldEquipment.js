import * as THREE from 'three';
import { createInstancedArrowField } from '../scene/shared/instancedBatch.js';
import { K_COULOMB, CHARGE_UI_TO_C, formatPhysicsNumber, drawMathFormula } from '../physicsFormula.js';
import { labFrameScheduler } from '../frameBudget.js';
import { getIrregularBump } from './electro.js';

const WORLD_PER_SOURCE_UNIT = 0.13;
const CHARGE_LIMIT = 12;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
/** SI 预因子 k·(μC→C)，场线/箭头只依赖方向与相对强弱 */
const COULOMB_SCALE = K_COULOMB * CHARGE_UI_TO_C;
function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
    child.material?.map?.dispose?.();
  });
}

/**
 * Frameless billboard above the probe charge.
 * Lines: q₀, optional r, |E|, |F| (force from F = q₀E).
 */
function createFloatingHudLabel({ worldScale = 1 } = {}) {
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: 512, height: 280, getContext: () => null };
  canvas.width = 512;
  canvas.height = 280;
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 1,
  }));
  // Bottom-center pivot so the tag sits on top of the sphere.
  sprite.center.set(0.5, 0);
  const baseW = 0.40 * worldScale;
  const heightFor = (n) => (0.040 + 0.038 * Math.max(1, n)) * worldScale;
  sprite.scale.set(baseW, heightFor(2), 1);
  sprite.renderOrder = 24;
  sprite.raycast = () => {};
  let lastKey = '';

  /**
   * @param {string} qText
   * @param {string} eText
   * @param {string} [accent]
   * @param {string|null} [rText]
   * @param {string|null} [fText]
   */
  function setQE(qText, eText, accent = '#fde68a', rText = null, fText = null) {
    const key = `${accent}|${qText}|${eText}|${rText || ''}|${fText || ''}`;
    if (key === lastKey) return;
    lastKey = key;
    sprite.userData.hudKey = key;
    sprite.userData.qText = qText;
    sprite.userData.eText = eText;
    sprite.userData.rText = rText;
    sprite.userData.fText = fText;
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawLine = (text, y, size, color) => {
      if (!text) return;
      ctx.font = `bold ${size}px "Microsoft YaHei", sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeText(text, W / 2, y);
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
    };
    const lines = [
      qText ? { text: qText, color: '#38bdf8', size: 32 } : null,
      rText ? { text: rText, color: '#cbd5e1', size: 32 } : null,
      { text: eText, color: '#f8fafc', size: 32 },
      fText ? { text: fText, color: '#cbd5e1', size: 32 } : null,
    ].filter(Boolean);
    sprite.scale.set(baseW, heightFor(lines.length), 1);
    const lineSpacing = 42;
    const centerY = H * 0.50;
    const startY = centerY - ((lines.length - 1) * lineSpacing) / 2;
    lines.forEach((line, i) => {
      const y = startY + i * lineSpacing;
      drawLine(line.text, y, line.size, line.color);
    });
    texture.needsUpdate = true;
  }

  return { sprite, setQE };
}

function formatPotentialVoltage(volts) {
  const v = Number(volts || 0);
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : (v < 0 ? '−' : '');
  if (abs >= 1000) {
    return `${sign}${(abs / 1000).toFixed(1)} kV`;
  }
  return `${sign}${abs.toFixed(0)} V`;
}

function createEquipotLabelSprite(text, color = '#38bdf8') {
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: 256, height: 64, getContext: () => null };
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (ctx) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(16, 10, 224, 44, 22);
    } else {
      ctx.rect(16, 10, 224, 44);
    }
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 0.95,
  }));
  sprite.scale.set(0.20, 0.05, 1);
  sprite.renderOrder = 30;
  sprite.raycast = () => {};
  return sprite;
}

function createHoloSphereGrid(radius, numLat = 4, numLon = 8, color = 0x67e8f9, opacity = 0.4) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });

  // Latitude circles
  for (let i = 1; i <= numLat; i += 1) {
    const phi = (i / (numLat + 1) - 0.5) * Math.PI * 0.80;
    const rRing = radius * Math.cos(phi);
    const yRing = radius * Math.sin(phi);
    const segs = 48;
    const pts = [];
    for (let s = 0; s <= segs; s += 1) {
      const theta = (s / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(rRing * Math.cos(theta), yRing, rRing * Math.sin(theta)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, mat);
    line.raycast = () => {};
    group.add(line);
  }

  // Longitude meridians
  for (let j = 0; j < numLon; j += 1) {
    const theta = (j / numLon) * Math.PI;
    const segs = 48;
    const pts = [];
    for (let s = 0; s <= segs; s += 1) {
      const phi = (s / segs) * Math.PI * 2;
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);
      pts.push(new THREE.Vector3(x, y, z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, mat);
    line.raycast = () => {};
    group.add(line);
  }

  return group;
}

function sourceDirs(count) {
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (index / Math.max(1, count - 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * index;
    return new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial);
  });
}

/** Scratch vectors — field integration must stay allocation-free in hot loops. */
const _field = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _point = new THREE.Vector3();
const _chargePos = new THREE.Vector3();
const _forceDir = new THREE.Vector3();
const _arrowOrigin = new THREE.Vector3();
const _arrowDir = new THREE.Vector3();
const _lerpA = new THREE.Color();
const _lerpB = new THREE.Color();

function fieldAtInto(charges, point, out) {
  out.set(0, 0, 0);
  for (let i = 0; i < charges.length; i += 1) {
    const charge = charges[i];
    const q = Number(charge?.q || 0);
    if (Math.abs(q) < 1e-6) continue;
    _delta.set(
      point.x - Number(charge.x || 0),
      point.y - Number(charge.y || 0),
      point.z - Number(charge.z || 0),
    );
    const r2 = _delta.lengthSq();
    if (r2 < 0.04 ** 2) continue;
    // E = kQ r̂ / r²，Q 以 μC 界面读数换算
    out.addScaledVector(_delta, (COULOMB_SCALE * q) / (r2 * Math.sqrt(r2)));
  }
  return out;
}

function fieldAt(charges, point) {
  return fieldAtInto(charges, point, new THREE.Vector3());
}

function potentialAt(charges, point) {
  let value = 0;
  for (let i = 0; i < charges.length; i += 1) {
    const charge = charges[i];
    const distance = Math.max(0.04, Math.hypot(
      point.x - Number(charge.x || 0),
      point.y - Number(charge.y || 0),
      point.z - Number(charge.z || 0),
    ));
    value += (COULOMB_SCALE * Number(charge?.q || 0)) / distance;
  }
  return value;
}

const _tempColor = new THREE.Color();
const _redColor = new THREE.Color(0xff3b3b);
const _blueColor = new THREE.Color(0x1c9bff);

function colorAtPoint(charges, point, targetColor = _tempColor) {
  let minPosD2 = Infinity;
  let minNegD2 = Infinity;
  for (let i = 0; i < charges.length; i += 1) {
    const c = charges[i];
    const q = Number(c.q || 0);
    if (Math.abs(q) < 1e-4) continue;
    const dx = point.x - Number(c.x || 0);
    const dy = point.y - Number(c.y || 0);
    const dz = point.z - Number(c.z || 0);
    const d2 = dx * dx + dy * dy + dz * dz;
    if (q > 0) {
      if (d2 < minPosD2) minPosD2 = d2;
    } else {
      if (d2 < minNegD2) minNegD2 = d2;
    }
  }
  if (minPosD2 === Infinity && minNegD2 === Infinity) {
    return targetColor.setHex(0xadb5bd);
  }
  return targetColor.setHex(minPosD2 <= minNegD2 ? 0xff3b3b : 0x1c9bff);
}

function colorForCharge(q) {
  // Saturated hues so field lines stay readable on the light lab bench.
  if (q > 0.05) return 0xff3b3b;
  if (q < -0.05) return 0x1c9bff;
  return 0xadb5bd;
}

function nearAnyCharge(charges, point, minDist) {
  const minDistSq = minDist * minDist;
  for (let i = 0; i < charges.length; i += 1) {
    const charge = charges[i];
    const dx = point.x - Number(charge.x || 0);
    const dy = point.y - Number(charge.y || 0);
    const dz = point.z - Number(charge.z || 0);
    if (dx * dx + dy * dy + dz * dz < minDistSq) return true;
  }
  return false;
}

export function createElectricFieldEquipment() {
  const root = new THREE.Group();
  root.name = 'electric-field-equipment';
  root.visible = false;
  root.position.y = 0.42;

  const chargeGroup = new THREE.Group();
  const lineGroup = new THREE.Group();
  const arrowGroup = new THREE.Group();
  const gaussSurfaceGroup = new THREE.Group();
  const equipotGroup = new THREE.Group();
  const probeGroup = new THREE.Group();
  const arrowBatch = createInstancedArrowField({
    capacity: 400,
    length: 0.024,
    shaftRadius: 0.0005,
    headLength: 0.024,
    headWidth: 0.012,
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    renderOrder: 26,
  });
  arrowGroup.add(arrowBatch.group);

  const gaussSurfaceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.28,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    roughness: 0.10,
    metalness: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const gaussWireMaterial = new THREE.LineBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.70,
    depthWrite: false,
  });

  const concentricMaterials = [
    {
      mesh: new THREE.MeshPhysicalMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.35,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
        roughness: 0.15,
        metalness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      wire: new THREE.LineBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    },
    {
      mesh: new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.28,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
        roughness: 0.12,
        metalness: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      wire: new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.70,
        depthWrite: false,
      }),
    },
    {
      mesh: new THREE.MeshPhysicalMaterial({
        color: 0x818cf8,
        transparent: true,
        opacity: 0.22,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
        roughness: 0.10,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      wire: new THREE.LineBasicMaterial({
        color: 0xc084fc,
        transparent: true,
        opacity: 0.60,
        depthWrite: false,
      }),
    },
  ];

  disablePick(gaussSurfaceGroup);
  gaussSurfaceGroup.visible = false;

  let concentricShellGroups = [];
  let lastGaussRadius = NaN;
  let lastGaussShape = '';
  let lastGaussMode = '';
  let lastGaussSeed = NaN;

  function createGaussGeometry(shape, worldR, seed = 0) {
    if (shape === 'cube') {
      const s = worldR * 1.7;
      return new THREE.BoxGeometry(s, s, s, 16, 16, 16);
    }
    if (shape === 'cylinder') {
      const r = worldR * 0.95;
      const h = worldR * 2.0;
      return new THREE.CylinderGeometry(r, r, h, 36, 16);
    }
    if (shape === 'irregular') {
      const geo = new THREE.SphereGeometry(worldR, 48, 32);
      const pos = geo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i);
        const dir = v.clone().normalize();
        const theta = Math.atan2(dir.z, dir.x);
        const phi = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
        const bump = getIrregularBump(theta, phi, seed);
        v.copy(dir).multiplyScalar(worldR * bump);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      return geo;
    }
    return new THREE.SphereGeometry(worldR, 48, 32);
  }

  function clearGaussGroup() {
    while (gaussSurfaceGroup.children.length > 0) {
      const child = gaussSurfaceGroup.children[gaussSurfaceGroup.children.length - 1];
      gaussSurfaceGroup.remove(child);
      child.traverse?.((node) => {
        if (node.geometry) node.geometry.dispose();
      });
    }
    concentricShellGroups = [];
  }

  function updateGaussSurface(radius, visible, shape = 'sphere', mode = 'single', seed = 0) {
    gaussSurfaceGroup.visible = visible;
    if (!visible) return;
    const r = Number(radius || 2.4);
    const s = String(shape || 'sphere');
    const m = String(mode || 'single');
    const seedNum = Number(seed || 0);
    if (Math.abs(r - lastGaussRadius) > 1e-5 || s !== lastGaussShape || m !== lastGaussMode || (s === 'irregular' && seedNum !== lastGaussSeed)) {
      const worldR = r * WORLD_PER_SOURCE_UNIT;
      clearGaussGroup();

      if (m === 'concentric') {
        const scales = [0.38, 0.68, 1.0];
        scales.forEach((scaleFactor, idx) => {
          const shellR = worldR * scaleFactor;
          const geo = createGaussGeometry(s, shellR, seedNum);
          const wireGeo = new THREE.WireframeGeometry(geo);
          const matConfig = concentricMaterials[idx] || concentricMaterials[1];

          const shellMesh = new THREE.Mesh(geo, matConfig.mesh);
          shellMesh.renderOrder = 22;
          shellMesh.userData.interactive = true;
          shellMesh.userData.role = 'gauss_surface';

          const wireMesh = new THREE.LineSegments(wireGeo, matConfig.wire);
          wireMesh.renderOrder = 23;

          const shellGroup = new THREE.Group();
          shellGroup.add(shellMesh, wireMesh);
          gaussSurfaceGroup.add(shellGroup);
          concentricShellGroups.push(shellGroup);
        });
      } else {
        const mainGeo = createGaussGeometry(s, worldR, seedNum);
        const gaussSurfaceMesh = new THREE.Mesh(mainGeo, gaussSurfaceMaterial);
        gaussSurfaceMesh.renderOrder = 22;
        gaussSurfaceMesh.userData.interactive = true;
        gaussSurfaceMesh.userData.role = 'gauss_surface';

        const gaussWireMesh = new THREE.LineSegments(
          new THREE.WireframeGeometry(mainGeo),
          gaussWireMaterial,
        );
        gaussWireMesh.renderOrder = 23;
        gaussSurfaceGroup.add(gaussSurfaceMesh, gaussWireMesh);
      }

      lastGaussRadius = r;
      lastGaussShape = s;
      lastGaussMode = m;
      lastGaussSeed = seedNum;
    }
  }

  const chargeSlots = [];
  for (let index = 0; index < CHARGE_LIMIT; index += 1) {
    const slot = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 20, 14),
      new THREE.MeshStandardMaterial({ emissiveIntensity: 0.8, roughness: 0.25, metalness: 0.18 }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 14, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false }),
    );
    halo.renderOrder = 22;
    const outer = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 14, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.055, depthWrite: false }),
    );
    outer.renderOrder = 21;
    const hit = new THREE.Mesh(
      // Slightly larger than the outer glow only — oversized grab spheres used
      // to extend across the floating content screen and steal aim from UI /
      // empty space (and from the other charge).
      new THREE.SphereGeometry(0.17, 16, 10),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    slot.add(outer, halo, core, hit);
    slot.userData = { interactive: true, role: 'electric_charge', core, halo, outer, hit };
    // Tag every mesh so resolveInteractive can stop on the first hit surface
    // without losing the charge id (hit proxy, core, and glow shells alike).
    [slot, outer, halo, core, hit].forEach((node) => {
      node.userData.interactive = true;
      node.userData.role = 'electric_charge';
    });
    slot.userData.core = core;
    slot.userData.halo = halo;
    slot.userData.outer = outer;
    slot.userData.hit = hit;
    chargeGroup.add(slot);
    chargeSlots.push(slot);
  }

  // Probe is smaller than source charges so it reads as a test charge, not a peer source.
  const probe = new THREE.Group();
  probe.frustumCulled = false;
  probeGroup.frustumCulled = false;
  const probeCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 18, 12),
    new THREE.MeshStandardMaterial({ color: 0xffd43b, emissive: 0xffb000, emissiveIntensity: 0.90 }),
  );
  probeCore.renderOrder = 28;
  probeCore.frustumCulled = false;
  const probeHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.052, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.35, depthTest: true, depthWrite: false }),
  );
  probeHalo.renderOrder = 27;
  probeHalo.frustumCulled = false;
  const probeHit = new THREE.Mesh(
    // Tight grab: ~1.7× halo so aim must land near the small sphere.
    new THREE.SphereGeometry(0.09, 14, 10),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  probe.add(probeHalo, probeCore, probeHit);
  probe.userData = { interactive: true, role: 'electric_probe', hit: probeHit };
  [probe, probeHalo, probeCore, probeHit].forEach((node) => {
    node.userData.interactive = true;
    node.userData.role = 'electric_probe';
  });
  probe.userData.hit = probeHit;
  const probeHud = createFloatingHudLabel({ worldScale: WORLD_PER_SOURCE_UNIT * 6.8 });
  probeHud.sprite.position.set(0, 0.085, 0);
  probeHud.sprite.renderOrder = 29;
  probeHud.sprite.frustumCulled = false;
  probe.add(probeHud.sprite);
  probeGroup.add(probe);

  const aimMarkerGroup = new THREE.Group();
  aimMarkerGroup.name = 'aim-marker-ring';
  aimMarkerGroup.visible = false;

  const ringGeo = new THREE.RingGeometry(0.024, 0.034, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMesh = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  const dotGeo = new THREE.CircleGeometry(0.008, 16);
  dotGeo.rotateX(-Math.PI / 2);
  const dotMesh = new THREE.Mesh(
    dotGeo,
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  aimMarkerGroup.add(ringMesh, dotMesh);
  disablePick(aimMarkerGroup);

  const axisGuidesGroup = new THREE.Group();
  axisGuidesGroup.name = 'charge-axis-guides';
  disablePick(axisGuidesGroup);

  const axisRadius = 0.0035;
  const axisLength = 0.55;

  // Bold X Axis (Red)
  const xAxisGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 12);
  xAxisGeo.rotateZ(-Math.PI / 2);
  const xAxisMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0x991b1b,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.2,
    transparent: true,
    opacity: 0.88,
  });
  const xAxisMesh = new THREE.Mesh(xAxisGeo, xAxisMat);
  xAxisMesh.renderOrder = 24;

  // Bold Y Axis (Depth, Green)
  const yAxisGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 12);
  yAxisGeo.rotateX(Math.PI / 2);
  const yAxisMat = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    emissive: 0x166534,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.2,
    transparent: true,
    opacity: 0.88,
  });
  const yAxisMesh = new THREE.Mesh(yAxisGeo, yAxisMat);
  yAxisMesh.renderOrder = 24;

  // Bold Z Axis (Height, Blue)
  const zAxisGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 12);
  const zAxisMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x1e40af,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.2,
    transparent: true,
    opacity: 0.88,
  });
  const zAxisMesh = new THREE.Mesh(zAxisGeo, zAxisMat);
  zAxisMesh.renderOrder = 24;
  const coneGeo = new THREE.ConeGeometry(axisRadius * 2.2, 0.024, 12);

  const xCone = new THREE.Mesh(coneGeo, xAxisMat);
  xCone.rotation.z = -Math.PI / 2;
  xCone.position.x = axisLength / 2;
  xCone.renderOrder = 24;

  const yCone = new THREE.Mesh(coneGeo, yAxisMat);
  yCone.rotation.x = Math.PI / 2;
  yCone.position.z = axisLength / 2;
  yCone.renderOrder = 24;

  const zCone = new THREE.Mesh(coneGeo, zAxisMat);
  zCone.position.y = axisLength / 2;
  zCone.renderOrder = 24;

  function createAxisLabelSprite(text, colorStr = '#ffffff') {
    if (typeof document === 'undefined') {
      const sprite = new THREE.Sprite();
      sprite.scale.set(0.065, 0.065, 1);
      sprite.raycast = () => {};
      return sprite;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = colorStr;
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.fillStyle = colorStr;
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 66);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.065, 0.065, 1);
    sprite.raycast = () => {};
    return sprite;
  }

  const xLabel = createAxisLabelSprite('X', '#ef4444');
  xLabel.position.set(axisLength / 2 + 0.035, 0, 0);

  const yLabel = createAxisLabelSprite('Y', '#22c55e');
  yLabel.position.set(0, 0, axisLength / 2 + 0.035);

  const zLabel = createAxisLabelSprite('Z', '#3b82f6');
  zLabel.position.set(0, axisLength / 2 + 0.035, 0);

  axisGuidesGroup.add(xAxisMesh, yAxisMesh, zAxisMesh, xCone, yCone, zCone, xLabel, yLabel, zLabel);

  // Ground drop & projection lines (Yellow dashed)
  const projPositions = new Float32Array(18);
  const projGeo = new THREE.BufferGeometry();
  projGeo.setAttribute('position', new THREE.BufferAttribute(projPositions, 3));
  const projLinesMesh = new THREE.LineSegments(
    projGeo,
    new THREE.LineDashedMaterial({
      color: 0xfde047,
      dashSize: 0.015,
      gapSize: 0.01,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  projLinesMesh.renderOrder = 24;

  const groundProjGroup = new THREE.Group();
  groundProjGroup.name = 'ground-proj-lines';
  groundProjGroup.add(projLinesMesh);
  disablePick(groundProjGroup);

  function updateAxisGuides(charge, axisOrigin = null, data = null) {
    if (!charge || !data?.showAxes) {
      axisGuidesGroup.visible = false;
      groundProjGroup.visible = false;
      return;
    }
    axisGuidesGroup.visible = true;
    groundProjGroup.visible = true;

    // Anchor axis frame at axisOrigin (start position during drag, re-centers on drag end)
    const originSrc = axisOrigin || charge;
    const ox = Number(originSrc.x || 0) * WORLD_PER_SOURCE_UNIT;
    const oy = Number(originSrc.z || 0) * WORLD_PER_SOURCE_UNIT;
    const oz = Number(originSrc.y || 0) * WORLD_PER_SOURCE_UNIT;

    axisGuidesGroup.position.set(ox, oy, oz);

    // Current dynamic charge position
    const cx = Number(charge.x || 0) * WORLD_PER_SOURCE_UNIT;
    const cy = Number(charge.z || 0) * WORLD_PER_SOURCE_UNIT;
    const cz = Number(charge.y || 0) * WORLD_PER_SOURCE_UNIT;

    const pos = projGeo.attributes.position.array;
    // Charge (cx, cy, cz) down to Ground (cx, 0, cz)
    pos[0] = cx; pos[1] = cy; pos[2] = cz;
    pos[3] = cx; pos[4] = 0;  pos[5] = cz;

    // Ground (cx, 0, cz) to Origin X-axis line (cx, 0, oz)
    pos[6] = cx; pos[7] = 0; pos[8] = cz;
    pos[9] = cx; pos[10] = 0; pos[11] = oz;

    // Ground (cx, 0, cz) to Origin Y-axis line (ox, 0, cz)
    pos[12] = cx; pos[13] = 0; pos[14] = cz;
    pos[15] = ox; pos[16] = 0; pos[17] = cz;

    projGeo.attributes.position.needsUpdate = true;
    projLinesMesh.computeLineDistances();
  }

  // The station activates this root as a single mode group. All visual layers
  // must be parented here or their state will update without reaching render.
  root.add(
    equipotGroup,
    lineGroup,
    arrowGroup,
    chargeGroup,
    gaussSurfaceGroup,
    probeGroup,
    aimMarkerGroup,
    axisGuidesGroup,
    groundProjGroup,
  );

  let forceArrow = null;
  let lastFieldSignature = '';
  let lastForceSignature = '';
  let lastResetView = -1;
  let lastSlotMetaSignature = '';
  let pendingDecoration = false;
  let decoJobGen = 0;
  /** Throttle floating probe canvas while dragging (texture upload is costly). */
  let lastHudPaintMs = 0;
  const DECO_JOB_ID = 'electric-field:deco';

  function clearGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      disposeObject(child);
    }
  }

  /** Field decorations must never steal charge/probe picks (esp. AR frontmost). */
  function disablePick(object) {
    object?.traverse?.((child) => {
      if (child.isMesh || child.isLine || child.isLineSegments) child.raycast = () => {};
    });
  }

  function traceFieldLines(charges) {
    if (!charges.length) return [];
    let totalAbs = 0;
    for (let i = 0; i < charges.length; i += 1) totalAbs += Math.abs(Number(charges[i].q || 0));
    const lineCount = THREE.MathUtils.clamp(Math.round(18 + totalAbs * 10), 12, 72);
    const lineDataList = [];
    for (let c = 0; c < charges.length; c += 1) {
      const charge = charges[c];
      if (Math.abs(Number(charge.q || 0)) < 0.05) continue;
      const sign = charge.q > 0 ? 1 : -1;
      const share = Math.max(6, Math.round(lineCount * Math.min(Math.abs(charge.q), 2.5) / Math.max(charges.length, 1)));
      const dirs = sourceDirs(share);
      for (let d = 0; d < dirs.length; d += 1) {
        const direction = dirs[d];
        _point.set(charge.x, charge.y, charge.z).addScaledVector(direction, 0.26);
        const points = [_point.clone()];
        for (let step = 0; step < 90; step += 1) {
          fieldAtInto(charges, _point, _field);
          const magnitude = _field.length();
          if (magnitude < 1e-5) break;
          _point.addScaledVector(_field, sign * 0.09 / magnitude);
          if (_point.length() > 9 || nearAnyCharge(charges, _point, 0.2)) break;
          points.push(_point.clone());
        }
        if (points.length >= 2) {
          lineDataList.push({ charge, points });
        }
      }
    }
    return lineDataList;
  }

  function rebuildLines(charges, lineDataList) {
    clearGroup(lineGroup);
    const lines = lineDataList || traceFieldLines(charges);
    if (!lines.length) return;
    const lineCol = new THREE.Color();

    for (let i = 0; i < lines.length; i += 1) {
      const { points } = lines[i];
      const worldPositions = new Float32Array(points.length * 3);
      const worldColors = new Float32Array(points.length * 3);

      for (let j = 0; j < points.length; j += 1) {
        const p = points[j];
        worldPositions[j * 3] = p.x * WORLD_PER_SOURCE_UNIT;
        worldPositions[j * 3 + 1] = p.z * WORLD_PER_SOURCE_UNIT;
        worldPositions[j * 3 + 2] = p.y * WORLD_PER_SOURCE_UNIT;

        colorAtPoint(charges, p, lineCol);
        worldColors[j * 3] = lineCol.r;
        worldColors[j * 3 + 1] = lineCol.g;
        worldColors[j * 3 + 2] = lineCol.b;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(worldPositions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(worldColors, 3));

      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        }),
      );
      line.renderOrder = 25;
      line.frustumCulled = false;
      disablePick(line);
      lineGroup.add(line);
    }
  }

  function rebuildArrows(charges, lineDataList) {
    const lines = lineDataList || traceFieldLines(charges);
    if (!lines.length) {
      arrowBatch.setCount(0);
      return;
    }

    const arrowLenWorld = 0.024;
    const arrowCol = new THREE.Color();

    let arrowIndex = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const { points } = lines[i];
      const N = points.length;
      if (N < 4) continue;

      const sampleIndices = N >= 28 ? [Math.floor(N * 0.3), Math.floor(N * 0.7)] : [Math.floor(N * 0.45)];

      for (let s = 0; s < sampleIndices.length; s += 1) {
        const idx = sampleIndices[s];
        const srcPoint = points[idx];
        fieldAtInto(charges, srcPoint, _field);
        const magnitude = _field.length();
        if (magnitude < 1e-5) continue;

        _arrowDir.set(_field.x, _field.z, _field.y).normalize();
        _arrowOrigin
          .set(srcPoint.x, srcPoint.z, srcPoint.y)
          .multiplyScalar(WORLD_PER_SOURCE_UNIT)
          .addScaledVector(_arrowDir, -arrowLenWorld * 0.5);

        colorAtPoint(charges, srcPoint, arrowCol);
        arrowBatch.setArrow(arrowIndex, {
          origin: _arrowOrigin,
          direction: _arrowDir,
          color: arrowCol,
          visible: true,
        });
        arrowIndex++;
      }
    }

    arrowBatch.setCount(arrowIndex);
    arrowBatch.commit();

    // Hide unused slots (zero scale)
    for (let i = arrowIndex; i < 400; i += 1) {
      arrowBatch.setArrow(i, { visible: false });
    }
  }

  /**
   * Equipotential fill on the horizontal mid-plane (z = 0 in source space).
   *
   * Single point charge → concentric smooth circles (φ = kQ/r is radial).
   * Color is a vivid rainbow across equipotential levels:
   *   −φ → blue/cyan, φ≈0 → green/yellow, +φ → orange/red.
   *
   * Soft-quantized bands + LinearFilter keep rings circular (no LEGO stairs)
   * while each level still reads as a distinct color (not a washed yellow slab).
   */
  function rebuildEquipotential(charges, data = {}) {
    clearGroup(equipotGroup);
    if (!charges.length || !data.showEquipot) return;

    // 2D 平面等势线：在电荷所在水平面上进行连续电势 φ 场采样并绘制等势线/等势带
    const extent = 4.0;
    const minX = -extent;
    const maxX = extent + 2 * extent; // 右侧拓展一块相同跨度的区域 (总宽度 16.0，覆盖右侧工作台)
    const minY = -extent;
    const maxY = extent;
    const width = maxX - minX;
    const height = maxY - minY;
    const sizeX = 512;
    const sizeY = 256;
    const rFloor = 0.22;
    const values = new Float32Array(sizeX * sizeY);
    let minV = Infinity;
    let maxV = -Infinity;

    const activeCharges = [];
    for (let c = 0; c < charges.length; c += 1) {
      const ch = charges[c];
      const q = Number(ch?.q || 0);
      if (Math.abs(q) >= 1e-6) {
        activeCharges.push({
          x: Number(ch.x || 0),
          y: Number(ch.y || 0),
          scaledQ: COULOMB_SCALE * q,
          z2: Number(ch.z || 0) ** 2,
        });
      }
    }

    for (let iy = 0; iy < sizeY; iy += 1) {
      const sy = maxY - (height * (iy + 0.5)) / sizeY;
      const rowOffset = iy * sizeX;
      for (let ix = 0; ix < sizeX; ix += 1) {
        // Cell centers → isotropic sampling on fixed horizontal plane (physics Z = 0).
        const sx = minX + (width * (ix + 0.5)) / sizeX;
        let phi = 0;
        for (let c = 0; c < activeCharges.length; c += 1) {
          const ch = activeCharges[c];
          const dx = sx - ch.x;
          const dy = sy - ch.y;
          const r = Math.max(rFloor, Math.sqrt(dx * dx + dy * dy + ch.z2));
          phi += ch.scaledQ / r;
        }
        // Mild compression; keep more mid-range contrast than pure asinh(φ·0.002).
        const v = Math.asinh(phi * 0.008);
        values[rowOffset + ix] = v;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV) || maxV - minV < 1e-8) return;

    // Both signs → symmetric about 0. Single sign → stretch [min,max] across a
    // vivid half-spectrum so a lone +Q is green→yellow→orange→red (not all yellow).
    const absMax = Math.max(Math.abs(minV), Math.abs(maxV), 1e-8);
    const hasBothSigns = minV < -1e-4 && maxV > 1e-4;
    const span = Math.max(maxV - minV, 1e-8);
    const bandCount = 12;
    const rgba = new Uint8Array(sizeX * sizeY * 4);

    const bandColors = [];
    for (let b = 0; b < bandCount; b += 1) {
      const u = b / (bandCount - 1);
      const h = (1 - u) * 0.70;
      const c = new THREE.Color();
      c.setHSL(h, 0.94, 0.50);
      bandColors.push(c);
    }

    /** Map compressed φ → palette coordinate u ∈ [0, 1]. */
    function phiToU(v) {
      if (hasBothSigns) {
        const t = THREE.MathUtils.clamp(v / absMax, -1, 1);
        return (t + 1) * 0.5;
      }
      // Single-sign field: use full local range so outer rings still change color.
      const local = THREE.MathUtils.clamp((v - minV) / span, 0, 1);
      if (maxV > 0 && minV >= -1e-4) {
        // + only: green (far, low φ) → red (near, high φ)
        return 0.32 + 0.68 * local;
      }
      // − only: blue (near, more negative) → cyan/green (far)
      return 0.68 * local;
    }

    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      const u = phiToU(v);

      // Soft band index in continuous φ-space → circular boundaries after LinearFilter.
      const bandF = u * (bandCount - 1);
      const b0 = Math.floor(bandF);
      const b1 = Math.min(bandCount - 1, b0 + 1);
      const edge = THREE.MathUtils.smoothstep(bandF - b0, 0.12, 0.88);
      const c0 = bandColors[b0];
      const c1 = bandColors[b1];

      // Darken band boundaries slightly so equipotential rings read clearly.
      const boundary = Math.exp(-((bandF - Math.round(bandF)) ** 2) / (2 * 0.06 ** 2));
      const mult = 1 - 0.20 * boundary;
      const rVal = (c0.r + (c1.r - c0.r) * edge) * mult;
      const gVal = (c0.g + (c1.g - c0.g) * edge) * mult;
      const bVal = (c0.b + (c1.b - c0.b) * edge) * mult;

      // Outer rings stay clearly tinted (not a pale yellow wash).
      const alpha = THREE.MathUtils.clamp(110 + 100 * u + 35 * boundary, 100, 235);
      const pIdx = i * 4;
      rgba[pIdx] = Math.round(THREE.MathUtils.clamp(rVal, 0, 1) * 255);
      rgba[pIdx + 1] = Math.round(THREE.MathUtils.clamp(gVal, 0, 1) * 255);
      rgba[pIdx + 2] = Math.round(THREE.MathUtils.clamp(bVal, 0, 1) * 255);
      rgba[pIdx + 3] = Math.round(alpha);
    }

    const texture = new THREE.DataTexture(rgba, sizeX, sizeY, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width * WORLD_PER_SOURCE_UNIT, height * WORLD_PER_SOURCE_UNIT),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(((minX + maxX) * 0.5) * WORLD_PER_SOURCE_UNIT, -0.012, 0);
    plane.renderOrder = 20;
    plane.frustumCulled = false;
    disablePick(plane);
    equipotGroup.add(plane);
  }

  /**
   * Unpack host SimBackend field-line buffer:
   *   [lineCount, n0, x,y,z…, n1, …]
   * Associate each polyline with the nearest charge (for color).
   * @param {Float32Array|ArrayLike<number>} packed
   * @param {Array} charges
   */
  function unpackHostFieldLines(packed, charges) {
    if (!packed?.length || !charges?.length) return null;
    const lineCount = packed[0] | 0;
    if (lineCount <= 0) return [];
    /** @type {Array<{charge: object, points: Array<{x:number,y:number,z:number}>}>} */
    const lines = [];
    let o = 1;
    for (let i = 0; i < lineCount; i += 1) {
      if (o >= packed.length) break;
      const n = packed[o] | 0;
      o += 1;
      const points = [];
      for (let j = 0; j < n; j += 1) {
        if (o + 2 >= packed.length) break;
        points.push({ x: packed[o], y: packed[o + 1], z: packed[o + 2] });
        o += 3;
      }
      if (points.length < 2) continue;
      const p0 = points[0];
      let best = charges[0];
      let bestD = Infinity;
      for (let c = 0; c < charges.length; c += 1) {
        const ch = charges[c];
        const dx = p0.x - Number(ch.x || 0);
        const dy = p0.y - Number(ch.y || 0);
        const dz = p0.z - Number(ch.z || 0);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = ch;
        }
      }
      lines.push({ charge: best, points });
    }
    return lines;
  }

  function rebuildDecorations(charges, data) {
    const needLines = data.showLines !== false;
    const needArrows = data.showArrows !== false;

    if (needLines || needArrows) {
      // Prefer host SimBackend packed polylines when present (off-thread trace).
      const hostLines = data._simFieldLines
        && (!data._simFieldLinesSignature || !data._simFieldSig || data._simFieldLinesSignature === data._simFieldSig)
        ? unpackHostFieldLines(data._simFieldLines, charges)
        : null;
      const lines = hostLines || traceFieldLines(charges);
      if (lines && lines.length) {
        if (needLines) rebuildLines(charges, lines);
        else clearGroup(lineGroup);

        if (needArrows) rebuildArrows(charges, lines);
        else arrowBatch.setCount(0);
      } else {
        if (!needLines) clearGroup(lineGroup);
        if (!needArrows) arrowBatch.setCount(0);
      }
    } else {
      clearGroup(lineGroup);
      clearGroup(arrowGroup);
    }

    if (Boolean(data.showEquipot)) rebuildEquipotential(charges, data);
    else clearGroup(equipotGroup);
    pendingDecoration = false;
  }

  /**
   * Field-line / arrow / equipotential rebuilds dispose + reallocate hundreds of
   * geometries. Never do that on the pre-render path (pointerup / drag end);
   * schedule after the frame presents so charge meshes stay smooth.
   */
  function scheduleDecorationRebuild(charges, data, signature) {
    pendingDecoration = false;
    lastFieldSignature = signature;
    const snapCharges = charges.map((c) => ({
      id: c.id,
      q: Number(c.q || 0),
      x: Number(c.x || 0),
      y: Number(c.y || 0),
      z: Number(c.z || 0),
    }));
    const snapFlags = {
      showLines: data.showLines !== false,
      showArrows: data.showArrows !== false,
      showEquipot: data.showEquipot,
      // Keep the worker-produced polyline buffer with the deferred job. The
      // previous code only copied visibility flags, so every release lost the
      // off-thread result and retraced field lines on the render thread.
      _simFieldLines: data._simFieldLines || null,
      _simFieldLinesSignature: data._simFieldLinesSignature || '',
      _simFieldSig: data._simFieldSig || '',
    };
    const gen = (decoJobGen += 1);
    // soft:false — rebuild is already post-render; do not arm soft-switch/rest
    // cooldowns that make the lab feel sticky right after releasing a charge.
    labFrameScheduler.schedule(DECO_JOB_ID, () => {
      pendingDecoration = false;
      if (gen !== decoJobGen) return;
      rebuildDecorations(snapCharges, snapFlags);
    }, { priority: 18, soft: false });
  }

  function cancelScheduledDecoration() {
    decoJobGen += 1;
    labFrameScheduler.cancel?.(DECO_JOB_ID);
  }

  function syncForceArrow(data, probeData) {
    const showProbe = data.showProbe !== false;
    const forceSignature = `${Number(data.force?.x || 0).toExponential(4)}:${Number(data.force?.y || 0).toExponential(4)}:${Number(data.force?.z || 0).toExponential(4)}:${probeData.x}:${probeData.y}:${probeData.z}:${showProbe}:${Number(probeData.q0 || 0).toFixed(2)}`;
    if (forceSignature === lastForceSignature) return;
    lastForceSignature = forceSignature;

    if (!showProbe) {
      if (forceArrow) {
        forceArrow.parent?.remove(forceArrow);
        disposeObject(forceArrow);
        forceArrow = null;
      }
      return;
    }

    const fx = Number(data.force?.x || 0);
    const fy = Number(data.force?.y || 0);
    const fz = Number(data.force?.z || 0);
    const mag = Math.hypot(fx, fy, fz);
    // SI 下试探电荷受力约 10⁻³～10⁻¹ N；过小则不画。
    if (mag < 1e-12) {
      if (forceArrow) {
        forceArrow.parent?.remove(forceArrow);
        disposeObject(forceArrow);
        forceArrow = null;
      }
      return;
    }

    _forceDir.set(fx, fz, fy).multiplyScalar(1 / mag);
    // World-space length: log-mapped so q₀ / 距离变化肉眼可见，且不被
    // WORLD_PER_SOURCE_UNIT 再缩成几毫米（旧实现几乎看不见）。
    const refN = 2e-3; // ~1 μC · 2 kN/C 量级
    const length = THREE.MathUtils.clamp(
      0.10 + Math.log1p(mag / refN) * 0.07,
      0.08,
      0.38,
    );
    const headLen = Math.min(0.09, length * 0.32);
    const headWidth = headLen * 0.55;
    if (!forceArrow) {
      forceArrow = new THREE.ArrowHelper(
        _forceDir.clone(),
        probe.position.clone(),
        length,
        0x4ade80,
        headLen,
        headWidth,
      );
      disablePick(forceArrow);
      // Draw above field lines / heatmap.
      forceArrow.traverse((child) => {
        if (child.isMesh || child.isLine) {
          child.renderOrder = 28;
          if (child.material) {
            child.material.depthTest = true;
            child.material.transparent = true;
            child.material.opacity = 0.98;
          }
        }
      });
      probeGroup.add(forceArrow);
    } else {
      forceArrow.position.copy(probe.position);
      forceArrow.setDirection(_forceDir);
      forceArrow.setLength(length, headLen, headWidth);
    }
  }

  root.userData.update = (data, dt = 0) => {
    if (!data) return;
    const charges = Array.isArray(data.charges) ? data.charges : [];
    const chargeSignature = charges.map((charge) => `${charge.id}:${charge.q}:${Number(charge.x).toFixed(2)}:${Number(charge.y).toFixed(2)}:${Number(charge.z).toFixed(2)}`).join('|');
    const slotMetaSignature = charges.map((charge) => `${charge.id}:${Number(charge.q || 0).toFixed(2)}`).join('|')
      + `|sel:${data.selectedId}|n:${charges.length}`;
    const metaChanged = slotMetaSignature !== lastSlotMetaSignature;
    if (metaChanged) lastSlotMetaSignature = slotMetaSignature;

    chargeSlots.forEach((slot, index) => {
      const charge = charges[index];
      slot.visible = !!charge;
      if (!charge) {
        if (metaChanged) {
          // Raycaster does not consistently inherit an invisible ancestor across
          // all Three.js versions. Disable stale slot hit meshes explicitly so an
          // unused slot can never steal the next drag gesture.
          slot.traverse((child) => {
            if (child.isMesh) child.raycast = () => {};
            if (child.userData) child.userData.chargeId = undefined;
          });
          slot.userData.chargeId = undefined;
        }
        return;
      }

      slot.position.set(charge.x, charge.z, charge.y).multiplyScalar(WORLD_PER_SOURCE_UNIT);
      slot.scale.setScalar(0.8 + Math.min(3, Math.abs(Number(charge.q || 0))) * 0.18);

      if (metaChanged) {
        const color = colorForCharge(Number(charge.q || 0));
        slot.traverse((child) => {
          if (child.isMesh) child.raycast = THREE.Mesh.prototype.raycast;
          if (child.userData) {
            child.userData.role = 'electric_charge';
            child.userData.interactive = true;
            child.userData.chargeId = charge.id;
          }
        });
        slot.userData.core.material.color.setHex(color);
        slot.userData.core.material.emissive.setHex(color);
        slot.userData.halo.material.color.setHex(color);
        slot.userData.outer.material.color.setHex(color);
      }
      slot.userData.halo.material.opacity = charge.id === data.selectedId ? 0.34 : 0.16;
    });

    const probeData = data.probe || { x: 0, y: 0, z: 0, q0: 1 };
    probe.position.set(probeData.x, probeData.z, probeData.y).multiplyScalar(WORLD_PER_SOURCE_UNIT);
    probe.visible = data.showProbe !== false;
    probeHit.raycast = data.showProbe !== false ? THREE.Mesh.prototype.raycast : () => {};
    probeHud.sprite.visible = data.showProbe !== false;
    const q0 = Number(probeData.q0 || 0);
    const qPos = q0 >= 0;
    probeCore.material.color.setHex(qPos ? 0xffd43b : 0x60a5fa);
    probeCore.material.emissive.setHex(qPos ? 0xffb000 : 0x2563eb);
    probeHalo.material.color.setHex(qPos ? 0xffd43b : 0x60a5fa);
    const dragging = !!data.dragging;
    // Canvas 2D + texture upload every frame while dragging is a common hitch.
    // Keep charge/probe meshes live; paint the probe tag at ~8 Hz during drag.
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const allowHudPaint = !dragging || (nowMs - lastHudPaintMs) >= 120;
    if (probe.visible && allowHudPaint) {
      lastHudPaintMs = nowMs;
      // Single source charge → show geometric distance r (source-space meters).
      let rText = null;
      if (charges.length === 1) {
        const src = charges[0];
        const r = Math.hypot(
          Number(probeData.x || 0) - Number(src.x || 0),
          Number(probeData.y || 0) - Number(src.y || 0),
          Number(probeData.z || 0) - Number(src.z || 0),
        );
        rText = `r = ${r.toFixed(2)} m`;
      }
      const q0Val = Number(probeData.q0 ?? 1);
      const q0Num = Math.abs(q0Val) < 1e-6 ? 0 : q0Val;
      const q0Sign = q0Num > 0 ? '+' : '';
      const q0Text = `q₀ = ${q0Sign}${q0Num.toFixed(1)} μC`;
      const fText = `|F| = ${formatPhysicsNumber(data.magnitudeF, { digits: 2, unit: 'N' })}`;
      probeHud.setQE(
        q0Text,
        `|E| = ${formatPhysicsNumber(data.magnitudeE, { digits: 2, unit: 'N/C' })}`,
        '#38bdf8',
        rText,
        fText,
      );
    }
    // Force arrow setDirection/setLength is cheap; keep it live every frame.
    syncForceArrow(data, probeData);

    lineGroup.visible = data.showLines !== false;
    arrowGroup.visible = data.showArrows !== false;
    const isGaussActive = Boolean(data.showGauss) || data.showGaussSurface === true || data.isGaussTheorem === true;
    const gaussMode = data.showGauss === 'concentric' ? 'concentric' : 'single';
    updateGaussSurface(
      data.radius || 2.4,
      isGaussActive && data.showSurface !== false,
      data.gaussShape || 'sphere',
      gaussMode,
      data.gaussSeed || 0,
    );

    // Heavy field decorations (lines / arrows / equipotential) allocate and
    // dispose hundreds of geometries. Doing that on every pointermove freezes
    // the main thread — keep charge/probe meshes live during drag, leave the
    // previous decorations in place, and rebuild once on release via the
    // post-render frame budget (never on the pre-render / pointerup stack).
    // Include visibility flags so toggling「等势」rebuilds even when charges are still.
    const decoSignature = `${chargeSignature}|L${data.showLines !== false ? 1 : 0}|A${data.showArrows !== false ? 1 : 0}|E${data.showEquipot || 0}`;
    // A worker snapshot may arrive after the drag started. It is still a
    // stale/intermediate decoration update from the input point of view, so
    // never let it force a synchronous geometry rebuild during the drag.
    const forceSyncDeco = data._forceDecorations === true
      && !dragging
      && decoSignature !== lastFieldSignature;
    const decorationDirty = decoSignature !== lastFieldSignature || forceSyncDeco;
    if (decorationDirty) {
      if (dragging) {
        // Drop any in-flight rebuild so release does not paint a mid-drag pose.
        cancelScheduledDecoration();
        pendingDecoration = true;
      } else {
        // Never rebuild geometry from the render/update path. Even a worker
        // snapshot marked as forced is coalesced into the post-render job.
        scheduleDecorationRebuild(charges, data, decoSignature);
      }
    } else if (pendingDecoration && !dragging) {
      scheduleDecorationRebuild(charges, data, decoSignature);
    }

    if (data.autoRotate && dt > 0) root.rotation.y += dt * 0.18;
    if (data.resetView !== lastResetView) {
      root.rotation.set(0, 0, 0);
      lastResetView = data.resetView || 0;
    }

    // Update 准星瞄准圆圈位置
    if (data._aimVisible && data._aimPoint) {
      aimMarkerGroup.position.set(data._aimPoint.x, 0.002, data._aimPoint.z);
      aimMarkerGroup.visible = true;
    } else {
      aimMarkerGroup.visible = false;
    }

    // Update 电荷 3D 坐标轴与虚线投影（拖动时坐标轴保持原位作为参照基准，拖动释放后重置中心）
    const activeCharge = charges.find((c) => c.id === data.selectedId) || charges[0] || (data.probe ? { ...data.probe, x: data.probe.x, y: data.probe.y, z: data.probe.z } : null);
    const axisOrigin = (data.dragging && data.dragStart) ? data.dragStart : activeCharge;
    updateAxisGuides(activeCharge, axisOrigin, data);
  };

  // The default electric-field layout is deterministic. Prepare its line and
  // arrow geometry while the experiment runtime is still off-screen so the
  // first visible open only updates transforms and materials.
  let defaultGpuPrewarmed = false;
  root.userData.prewarmGpu = () => {
    if (defaultGpuPrewarmed) return;
    const charges = [{ id: 1, q: 1, x: 0, y: 0, z: 0 }];
    const lines = traceFieldLines(charges);
    rebuildLines(charges, lines);
    rebuildArrows(charges, lines);
    lastFieldSignature = '1:1:0.00:0.00:0.00|L1|A1|E0';
    pendingDecoration = false;
    defaultGpuPrewarmed = true;
  };


  root.userData.setInteractive = (enabled) => {
    const raycast = enabled ? THREE.Mesh.prototype.raycast : () => {};
    chargeSlots.forEach((slot) => slot.traverse((child) => {
      if (child.isMesh) child.raycast = raycast;
    }));
    probeHit.raycast = enabled && probe.visible ? THREE.Mesh.prototype.raycast : () => {};
    axisGuidesGroup.traverse((child) => {
      if (child.isMesh) child.raycast = raycast;
    });
  };
  return root;
}
