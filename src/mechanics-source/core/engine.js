import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createPhysicsBackend, BODY_TYPE } from '../../runtime/threading/physicsBackend.js';

export class LabEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1220);
    this.scene.fog = new THREE.FogExp2(0x0c1220, 0.012);
    // No environment map — avoids shiny reflections on balls/props
    this.scene.environment = null;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.08, 120);
    this.camera.position.set(8, 5, 10);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 28;
    this.controls.target.set(0, 1.2, 0);

    // Standalone source engine: auto prefers worker when available.
    this.physics = createPhysicsBackend({ mode: 'auto' });
    const physics = this.physics;
    // Gravity shim keeps experiment setup (engine.world.gravity.set) working.
    this.world = {
      gravity: {
        set: (x, y, z) => physics.setGravity(x, y, z),
        get x() { return physics.getGravity()[0]; },
        get y() { return physics.getGravity()[1]; },
        get z() { return physics.getGravity()[2]; },
      },
      addBody: (body) => physics.adoptBody(body),
      removeBody: (body) => {
        const id = body?.id;
        if (id != null) physics.removeBody(id);
      },
      addContactMaterial: (cm) => physics._world.addContactMaterial(cm),
      step: (dt) => physics._world.step(dt),
      get bodies() { return physics._world.bodies; },
    };

    this.meshes = [];
    this.bodies = [];
    this.helpers = [];
    this.labels = [];
    this.trails = [];

    this.clock = new THREE.Clock();
    this.paused = false;
    this.fixedTimeStep = this.physics.fixedDt;
    this.maxSubSteps = this.physics.maxSubSteps;
    this.onTick = null;
    this.onPreStep = null;

    this._lights = [];
    this._setupLights();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  get simTime() {
    return this.physics?.simTime || 0;
  }

  get accumulator() {
    return this.physics?.accumulator || 0;
  }

  addPhysicsBody(desc, mesh = null) {
    const bodyId = this.physics.addBody(desc);
    const body = this.physics.getHandle(bodyId);
    this.bodies.push(body);
    if (mesh) {
      mesh.userData.bodyId = bodyId;
      mesh.userData.body = body;
    }
    return { bodyId, body };
  }

  _setupLights() {
    // Clear previous dynamic lights if re-called
    for (const l of this._lights) this.scene.remove(l);
    this._lights = [];

    const hemi = new THREE.HemisphereLight(0xdde7ff, 0x1a2030, 0.55);
    this.scene.add(hemi);
    this._lights.push(hemi);

    // Main key — soft overhead lab light
    const key = new THREE.DirectionalLight(0xfff6ea, 1.35);
    key.position.set(6, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 55;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 2.5;
    this.scene.add(key);
    this._lights.push(key);

    // Cool fill from window side
    const fill = new THREE.DirectionalLight(0x8eb6ff, 0.45);
    fill.position.set(-10, 8, -4);
    this.scene.add(fill);
    this._lights.push(fill);

    // Warm rim
    const rim = new THREE.DirectionalLight(0xffc9a0, 0.28);
    rim.position.set(2, 4, -12);
    this.scene.add(rim);
    this._lights.push(rim);

    // Local instrument accent
    const accent = new THREE.PointLight(0x5b8cff, 0.55, 18, 2);
    accent.position.set(2, 2.5, 3);
    this.scene.add(accent);
    this._lights.push(accent);

    const accent2 = new THREE.PointLight(0x3ee0b0, 0.35, 14, 2);
    accent2.position.set(-3, 2, -2);
    this.scene.add(accent2);
    this._lights.push(accent2);

    // Soft ambient fill
    const amb = new THREE.AmbientLight(0x6a7a98, 0.22);
    this.scene.add(amb);
    this._lights.push(amb);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setCamera(pos, target = [0, 1.2, 0]) {
    this.camera.position.set(...pos);
    this.controls.target.set(...target);
    this.controls.update();
  }

  /** Snapshot orbit camera so rebuilds can restore the user's view */
  getCameraState() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
    };
  }

  setCameraState(state) {
    if (!state) return;
    this.camera.position.fromArray(state.position);
    this.controls.target.fromArray(state.target);
    this.controls.update();
  }

  clearScene() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.traverse?.((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
      mesh.geometry?.dispose?.();
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose?.());
      else mesh.material?.dispose?.();
    }
    for (const helper of this.helpers) {
      this.scene.remove(helper);
      helper.traverse?.((obj) => {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      });
      helper.geometry?.dispose?.();
      helper.material?.dispose?.();
    }
    for (const body of [...this.bodies]) {
      if (body?.id != null) this.physics.removeBody(body.id);
    }
    for (const trail of this.trails) {
      this.scene.remove(trail.line);
      trail.line.geometry.dispose();
      trail.line.material.dispose();
    }
    this.meshes = [];
    this.bodies = [];
    this.helpers = [];
    this.labels = [];
    this.trails = [];
    this.physics.resetClock();
    this.onPreStep = null;
    this.onTick = null;
    this.clock.getDelta();
  }

  /** @deprecated use addLabRoom from labkit — kept for simple floors */
  addGround({ size = 40, y = 0, color = 0x152038, receiveShadow = true } = {}) {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = receiveShadow;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const { body } = this.addPhysicsBody({
      shape: 'plane',
      type: BODY_TYPE.STATIC,
      mass: 0,
      position: [0, y, 0],
    }, mesh);
    return { mesh, body };
  }

  addBox({
    size = [1, 1, 1],
    position = [0, 0.5, 0],
    mass = 1,
    color = 0x5b8cff,
    restitution = 0.2,
    friction = 0.4,
    metalness = 0.35,
    roughness = 0.4,
    castShadow = true,
    material = null,
  } = {}) {
    const [sx, sy, sz] = size;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat =
      material ||
      new THREE.MeshPhysicalMaterial({
        color,
        metalness,
        roughness,
        clearcoat: 0.35,
        clearcoatRoughness: 0.3,
      });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.position.set(...position);
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const { body } = this.addPhysicsBody({
      shape: 'box',
      size: [sx, sy, sz],
      position,
      mass,
      friction,
      restitution,
    }, mesh);
    return { mesh, body };
  }

  addSphere({
    radius = 0.35,
    position = [0, 1, 0],
    mass = 1,
    color = 0xff6b8a,
    restitution = 0.35,
    friction = 0.3,
    metalness = 0,
    roughness = 0.92,
    material = null,
  } = {}) {
    const geo = new THREE.SphereGeometry(radius, 48, 36);
    const mat =
      material ||
      new THREE.MeshStandardMaterial({
        color,
        metalness,
        roughness,
        envMapIntensity: 0,
      });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(...position);
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const { body } = this.addPhysicsBody({
      shape: 'sphere',
      radius,
      position,
      mass,
      friction,
      restitution,
      linearDamping: 0.01,
      angularDamping: 0.05,
    }, mesh);
    return { mesh, body };
  }

  addStaticMesh(mesh, body = null) {
    this.scene.add(mesh);
    this.meshes.push(mesh);
    if (body) {
      if (body.id != null && this.physics.getHandle(body.id)) {
        mesh.userData.bodyId = body.id;
        mesh.userData.body = body;
        if (!this.bodies.includes(body)) this.bodies.push(body);
      } else {
        const bodyId = this.physics.adoptBody(body);
        const handle = this.physics.getHandle(bodyId);
        mesh.userData.bodyId = bodyId;
        mesh.userData.body = handle;
        this.bodies.push(handle);
        return { mesh, body: handle };
      }
    }
    return { mesh, body };
  }

  addHelper(object3d) {
    this.scene.add(object3d);
    this.helpers.push(object3d);
    return object3d;
  }

  createTrail(color = 0x3ee0b0, maxPoints = 200) {
    const positions = new Float32Array(maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    const trail = { line, positions, count: 0, maxPoints, index: 0 };
    this.trails.push(trail);
    return trail;
  }

  pushTrail(trail, x, y, z) {
    const { positions, maxPoints } = trail;
    if (trail.count < maxPoints) {
      const i = trail.count * 3;
      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = z;
      trail.count += 1;
      trail.line.geometry.setDrawRange(0, trail.count);
    } else {
      positions.copyWithin(0, 3);
      const i = (maxPoints - 1) * 3;
      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = z;
    }
    trail.line.geometry.attributes.position.needsUpdate = true;
  }

  clearTrail(trail) {
    trail.count = 0;
    trail.line.geometry.setDrawRange(0, 0);
  }

  makeContactMaterial(matA, matB, opts) {
    const cm = new CANNON.ContactMaterial(matA, matB, opts);
    this.physics._world.addContactMaterial(cm);
    return cm;
  }

  setPaused(v) {
    this.paused = v;
    if (!v) this.clock.getDelta();
  }

  syncMeshes() {
    this.physics.syncMeshes(this.meshes);
  }

  step(callback) {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.paused) {
      const result = this.physics.step(dt, {
        onPreStep: this.onPreStep
          ? (fixedDt, simTime) => this.onPreStep(fixedDt, simTime)
          : undefined,
      });
      this.syncMeshes();
      if (callback) callback(this.fixedTimeStep, result.simTime);
      if (this.onTick) this.onTick(this.fixedTimeStep, result.simTime);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.clearScene();
    this.physics?.dispose?.();
    this.renderer.dispose();
    this.controls.dispose();
  }
}

export function formatNum(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return Number(n).toFixed(digits);
}

export function vecSpeed(body) {
  const v = body.velocity;
  return Math.hypot(v.x, v.y, v.z);
}

export function kineticEnergy(body) {
  return 0.5 * body.mass * vecSpeed(body) ** 2;
}

export function potentialEnergy(body, g = 9.81, y0 = 0) {
  return body.mass * g * (body.position.y - y0);
}
