import * as THREE from 'three';

/**
 * Shared InstancedMesh helpers — pack many identical geometries into one draw call.
 *
 * Use for repeated particles, molecules, bolt rings, field-arrow shafts/heads, etc.
 * One InstancedMesh ≈ one GPU draw; N separate Mesh objects ≈ N draws.
 */

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _unitScale = new THREE.Vector3(1, 1, 1);

/**
 * @typedef {object} InstancedBatchOptions
 * @property {THREE.BufferGeometry} geometry
 * @property {THREE.Material} material
 * @property {number} capacity
 * @property {boolean} [dynamic=true]  DynamicDrawUsage for per-frame matrix updates
 * @property {boolean} [instanceColor=false]  Enable per-instance RGB (material.vertexColors not required)
 * @property {boolean} [castShadow=false]
 * @property {boolean} [receiveShadow=false]
 * @property {number} [renderOrder]
 * @property {boolean} [frustumCulled=true]
 * @property {string} [name]
 */

/**
 * Create a managed InstancedMesh batch.
 *
 * @param {InstancedBatchOptions} opts
 */
export function createInstancedBatch(opts) {
  const capacity = Math.max(1, opts.capacity | 0);
  const material = opts.material;
  if (opts.instanceColor) {
    // Three r152+: MeshStandard/Basic pick up instanceColor automatically once setColorAt runs.
    material.vertexColors = false;
  }

  const mesh = new THREE.InstancedMesh(opts.geometry, material, capacity);
  mesh.instanceMatrix.setUsage(opts.dynamic === false ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage);
  mesh.castShadow = !!opts.castShadow;
  mesh.receiveShadow = !!opts.receiveShadow;
  mesh.frustumCulled = opts.frustumCulled !== false;
  if (opts.renderOrder != null) mesh.renderOrder = opts.renderOrder;
  if (opts.name) mesh.name = opts.name;
  mesh.count = capacity;

  if (opts.instanceColor) {
    // Pre-allocate so setColorAt never allocates mid-frame.
    for (let i = 0; i < capacity; i += 1) mesh.setColorAt(i, _color.setHex(0xffffff));
    mesh.instanceColor.setUsage(opts.dynamic === false ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage);
  }

  // Start hidden so unused slots never flash at the origin.
  _dummy.position.set(0, 0, 0);
  _dummy.quaternion.identity();
  _dummy.scale.copy(_zeroScale);
  _dummy.updateMatrix();
  for (let i = 0; i < capacity; i += 1) mesh.setMatrixAt(i, _dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = 0;

  let activeCount = 0;
  let matricesDirty = false;
  let colorsDirty = false;

  function setTransform(index, {
    position,
    quaternion,
    rotation,
    scale,
    visible = true,
  } = {}) {
    if (index < 0 || index >= capacity) return;
    if (position) {
      if (Array.isArray(position)) _dummy.position.set(position[0], position[1], position[2]);
      else _dummy.position.copy(position);
    } else {
      _dummy.position.set(0, 0, 0);
    }
    if (quaternion) {
      if (Array.isArray(quaternion)) {
        _dummy.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      } else {
        _dummy.quaternion.copy(quaternion);
      }
    } else if (rotation) {
      if (Array.isArray(rotation)) _dummy.rotation.set(rotation[0], rotation[1], rotation[2]);
      else _dummy.rotation.copy(rotation);
    } else {
      _dummy.quaternion.identity();
      _dummy.rotation.set(0, 0, 0);
    }
    if (!visible) {
      _dummy.scale.copy(_zeroScale);
    } else if (scale == null) {
      _dummy.scale.copy(_unitScale);
    } else if (typeof scale === 'number') {
      _dummy.scale.setScalar(scale);
    } else if (Array.isArray(scale)) {
      _dummy.scale.set(scale[0], scale[1], scale[2]);
    } else {
      _dummy.scale.copy(scale);
    }
    _dummy.updateMatrix();
    mesh.setMatrixAt(index, _dummy.matrix);
    matricesDirty = true;
  }

  function setMatrix(index, matrix) {
    if (index < 0 || index >= capacity) return;
    mesh.setMatrixAt(index, matrix);
    matricesDirty = true;
  }

  function setColor(index, color) {
    if (!mesh.instanceColor || index < 0 || index >= capacity) return;
    if (typeof color === 'number') _color.setHex(color);
    else if (typeof color === 'string') _color.set(color);
    else _color.copy(color);
    mesh.setColorAt(index, _color);
    colorsDirty = true;
  }

  function hide(index) {
    setTransform(index, { visible: false });
  }

  /**
   * How many instances the GPU should draw (trailing slots are culled).
   * @param {number} count
   */
  function setCount(count) {
    activeCount = Math.max(0, Math.min(capacity, count | 0));
    mesh.count = activeCount;
  }

  function commit() {
    if (matricesDirty) {
      mesh.instanceMatrix.needsUpdate = true;
      matricesDirty = false;
    }
    if (colorsDirty && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
      colorsDirty = false;
    }
  }

  function dispose() {
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m?.dispose?.());
    else mesh.material?.dispose?.();
    mesh.dispose?.();
  }

  return {
    mesh,
    capacity,
    get count() { return activeCount; },
    setTransform,
    setMatrix,
    setColor,
    hide,
    setCount,
    commit,
    dispose,
  };
}

/**
 * Build a static bolt / stud ring as a single InstancedMesh (one draw call).
 *
 * @param {object} opts
 * @param {number} opts.radius
 * @param {number} [opts.count=8]
 * @param {number} [opts.z=0]
 * @param {number} [opts.boltRadius=0.035]
 * @param {number} [opts.boltHeight=0.04]
 * @param {THREE.Material} [opts.material]
 * @returns {THREE.InstancedMesh}
 */
export function createBoltRingInstanced({
  radius,
  count = 8,
  z = 0,
  boltRadius = 0.035,
  boltHeight = 0.04,
  material,
} = {}) {
  const n = Math.max(1, count | 0);
  const geo = new THREE.CylinderGeometry(boltRadius, boltRadius, boltHeight, 8);
  const mat = material || new THREE.MeshStandardMaterial({
    color: 0x3a4250,
    metalness: 0.85,
    roughness: 0.4,
  });
  const batch = createInstancedBatch({
    geometry: geo,
    material: mat,
    capacity: n,
    dynamic: false,
    castShadow: false,
    receiveShadow: false,
    name: 'bolt-ring',
  });
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    batch.setTransform(i, {
      position: [Math.cos(a) * radius, Math.sin(a) * radius, z],
      rotation: [Math.PI / 2, 0, 0],
    });
  }
  batch.setCount(n);
  batch.commit();
  return batch.mesh;
}

/**
 * Two-mesh instanced arrow field (shaft + head) for large vector lattices.
 * Replaces N× ArrowHelper (2 draws each) with 2 draws total.
 *
 * Length is fixed at create time (matches Faraday / induced-E teaching style).
 * Hide an arrow with setVisible(i, false) (zero scale). Color via instanceColor.
 *
 * @param {object} opts
 * @param {number} opts.capacity
 * @param {number} [opts.shaftRadius=0.012]
 * @param {number} [opts.length=1]
 * @param {number} [opts.headLength]  defaults to ~0.2 * length
 * @param {number} [opts.headWidth]   defaults to ~2.5 * shaftRadius * 4
 * @param {number} [opts.color=0xffffff]
 * @param {boolean} [opts.transparent=true]
 * @param {number} [opts.opacity=0.95]
 * @param {number} [opts.renderOrder=2]
 */
export function createInstancedArrowField(opts = {}) {
  const capacity = Math.max(1, opts.capacity | 0);
  const length = Number(opts.length) > 0 ? Number(opts.length) : 1;
  const headLength = Number(opts.headLength) > 0 ? Number(opts.headLength) : length * 0.2;
  const shaftLength = Math.max(1e-4, length - headLength);
  const shaftRadius = Number(opts.shaftRadius) > 0 ? Number(opts.shaftRadius) : 0.004;
  const headWidth = Number(opts.headWidth) > 0 ? Number(opts.headWidth) : shaftRadius * 3.5;
  const color = opts.color != null ? opts.color : 0xffffff;
  const transparent = opts.transparent !== false;
  const opacity = opts.opacity != null ? opts.opacity : 0.95;
  const renderOrder = opts.renderOrder != null ? opts.renderOrder : 2;
  const radialSegments = Number(opts.radialSegments) > 0 ? Math.max(8, opts.radialSegments | 0) : 16;

  // Cylinder default axis = +Y; Cone default = +Y tip. Smooth 16-segment radial geometry.
  const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, radialSegments, 1);
  // Shift so base sits at origin and tip points +Y through shaftLength.
  shaftGeo.translate(0, shaftLength * 0.5, 0);
  const headGeo = new THREE.ConeGeometry(headWidth * 0.5, headLength, radialSegments);
  headGeo.translate(0, shaftLength + headLength * 0.5, 0);

  // When instanceColor is used, material base color MUST be pure white (0xffffff)
  // so instance colors are not multiplied/corrupted by a non-white base color.
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  const headMat = shaftMat.clone();

  const shaft = createInstancedBatch({
    geometry: shaftGeo,
    material: shaftMat,
    capacity,
    dynamic: true,
    instanceColor: true,
    frustumCulled: false,
    renderOrder,
    name: opts.name ? `${opts.name}-shaft` : 'instanced-arrow-shaft',
  });
  const head = createInstancedBatch({
    geometry: headGeo,
    material: headMat,
    capacity,
    dynamic: true,
    instanceColor: true,
    frustumCulled: false,
    renderOrder: renderOrder + 1,
    name: opts.name ? `${opts.name}-head` : 'instanced-arrow-head',
  });

  if (color != null) {
    for (let i = 0; i < capacity; i += 1) {
      shaft.setColor(i, color);
      head.setColor(i, color);
    }
    shaft.commit();
    head.commit();
  }

  const group = new THREE.Group();
  group.name = opts.name || 'instanced-arrow-field';
  group.add(shaft.mesh, head.mesh);

  const _origin = new THREE.Vector3();
  const _dir = new THREE.Vector3(0, 1, 0);
  const _quat = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const visibleFlags = new Uint8Array(capacity);
  visibleFlags.fill(1);

  function setArrow(index, {
    origin,
    direction,
    color: arrowColor,
    visible = true,
  } = {}) {
    if (index < 0 || index >= capacity) return;
    visibleFlags[index] = visible ? 1 : 0;
    if (!visible) {
      shaft.hide(index);
      head.hide(index);
      return;
    }
    if (origin) {
      if (Array.isArray(origin)) _origin.set(origin[0], origin[1], origin[2]);
      else _origin.copy(origin);
    } else {
      _origin.set(0, 0, 0);
    }
    if (direction) {
      if (Array.isArray(direction)) _dir.set(direction[0], direction[1], direction[2]);
      else _dir.copy(direction);
    } else {
      _dir.set(0, 1, 0);
    }
    if (_dir.lengthSq() < 1e-12) {
      shaft.hide(index);
      head.hide(index);
      visibleFlags[index] = 0;
      return;
    }
    _dir.normalize();
    _quat.setFromUnitVectors(_yAxis, _dir);
    shaft.setTransform(index, { position: _origin, quaternion: _quat, visible: true });
    head.setTransform(index, { position: _origin, quaternion: _quat, visible: true });
    const finalColor = arrowColor != null ? arrowColor : color;
    if (finalColor != null) {
      shaft.setColor(index, finalColor);
      head.setColor(index, finalColor);
    }
  }

  function setVisible(index, visible) {
    if (!visible) {
      setArrow(index, { visible: false });
      return;
    }
    // Caller must re-set transform after unhiding if it was zero-scaled.
    visibleFlags[index] = 1;
  }

  function setColor(index, arrowColor) {
    shaft.setColor(index, arrowColor);
    head.setColor(index, arrowColor);
  }

  function setCount(count) {
    shaft.setCount(count);
    head.setCount(count);
  }

  function setOpacity(value) {
    const o = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
    shaftMat.opacity = o;
    headMat.opacity = o;
  }

  function commit() {
    shaft.commit();
    head.commit();
  }

  function dispose() {
    group.remove(shaft.mesh, head.mesh);
    shaft.dispose();
    head.dispose();
  }

  // Expose full capacity as drawable; hide unused with zero scale.
  setCount(capacity);
  commit();

  return {
    group,
    capacity,
    length,
    setArrow,
    setVisible,
    setColor,
    setCount,
    setOpacity,
    commit,
    dispose,
    /** @deprecated alias */
    mesh: group,
  };
}
