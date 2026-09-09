import * as THREE from 'three';
import { createPhysicsBackend } from '../../runtime/threading/physicsBackend.js';
import { collision } from '../../mechanics-source/experiments/collision.js';
import { freeFall } from '../../mechanics-source/experiments/freeFall.js';
import { inclinedPlane } from '../../mechanics-source/experiments/inclinedPlane.js';
import { pendulum } from '../../mechanics-source/experiments/pendulum.js';
import { projectile } from '../../mechanics-source/experiments/projectile.js';
import { viscosity } from '../../mechanics-source/experiments/viscosity.js';

export const SOURCE_MECHANICS_EXPERIMENTS = Object.freeze({
  [freeFall.id]: freeFall,
  [inclinedPlane.id]: inclinedPlane,
  [pendulum.id]: pendulum,
  [collision.id]: collision,
  [projectile.id]: projectile,
  [viscosity.id]: viscosity,
});

const LAYOUTS = Object.freeze({
  // z≈-3.0 leaves the sitting-edge strip (z≈-2.24) free for desk sliders.
  'free-fall': { position: [-4.2, 0.905, -3.0], scale: 0.25 },
  'inclined-plane': { position: [-5.45, 0.905, -3.0], scale: 0.34 },
  pendulum: { position: [-4.2, 0.905, -3.0], scale: 0.68 },
  collision: { position: [-4.2, 0.905, -3.0], scale: 0.26 },
  projectile: { position: [-5.45, 0.905, -3.0], scale: 0.28 },
  viscosity: { position: [-4.2, 0.055, -3.0], scale: 0.94 },
});

function disposeObject(root) {
  root.traverse?.((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material?.dispose?.());
    else object.material?.dispose?.();
  });
}

/**
 * Host room already has sun + hemisphere + soft shadows.
 * Source modules used a full local light rig with an extra 1024 shadow map —
 * that second soft-shadow pass made camera look/strafe hitch on the mechanics desk.
 * Keep a cheap fill only (no castShadow) so materials stay readable.
 */
function addSourceLights(scene) {
  const hemi = new THREE.HemisphereLight(0xdde7ff, 0x1a2030, 0.35);
  const fill = new THREE.DirectionalLight(0xfff6ea, 0.55);
  fill.position.set(4, 10, 6);
  fill.castShadow = false;
  const ambient = new THREE.AmbientLight(0x6a7a98, 0.28);
  scene.add(hemi, fill, ambient);
}

/** Host sun already casts room shadows — skip per-mesh casters on dense source rigs. */
function stripSourceShadowCasters(root) {
  root.traverse((object) => {
    if (object.isLight) {
      object.castShadow = false;
      return;
    }
    if (object.isMesh) {
      object.castShadow = false;
      // Keep receiveShadow so the host sun still grounds props on the table.
    }
  });
}

class SourceEngineAdapter {
  constructor({ scene, camera, renderer, physicsMode } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    // The source viscosity module installs its native orbit-canvas drag path.
    // A detached canvas keeps that path isolated; the host forwards its own
    // pointer-lock/AR drag lifecycle through explicit source hooks instead.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 8;
    this.canvas.height = 8;
    this.controls = { enabled: false };
    // PhysicsBackend owns the Cannon world. Leave `mode` undefined unless the
    // caller explicitly overrides it so the host-level mode can take effect.
    // This matters in iPad WKWebView, where the host forces the deterministic
    // main backend because module workers can stop returning pose batches.
    // Formula-only labs still skip empty world.step via dynamicCount===0.
    this.physics = createPhysicsBackend({ mode: physicsMode });
    const physics = this.physics;
    this.world = {
      gravity: {
        set: (x, y, z) => physics.setGravity(x, y, z),
        get x() { return physics.getGravity()[0]; },
        get y() { return physics.getGravity()[1]; },
        get z() { return physics.getGravity()[2]; },
      },
    };
    this.meshes = [];
    this.bodies = [];
    this.helpers = [];
    this.trails = [];
    this.fixedTimeStep = this.physics.fixedDt;
    this.onPreStep = null;
    this.sourceCamera = null;
  }

  get simTime() {
    return this.physics?.simTime || 0;
  }

  get accumulator() {
    return this.physics?.accumulator || 0;
  }

  setCamera(position, target) {
    this.sourceCamera = { position: [...position], target: [...target] };
  }

  /**
   * Register a body description on the backend and link it to a mesh.
   * @returns {{ bodyId: number, body: object }}
   */
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

  addStaticMesh(mesh, body = null) {
    // The host already supplies the complete laboratory floor and room. Keep
    // source floor physics but hide only the duplicate 20–48 m visual plane.
    const planeSize = mesh?.geometry?.type === 'PlaneGeometry'
      ? Math.max(Number(mesh.geometry.parameters?.width || 0), Number(mesh.geometry.parameters?.height || 0))
      : 0;
    if (planeSize > 10) mesh.visible = false;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    if (body) {
      // Legacy path: raw Cannon body or already-backed handle.
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

  addHelper(object) {
    if (object?.type === 'GridHelper') object.visible = false;
    this.scene.add(object);
    this.helpers.push(object);
    return object;
  }

  createTrail(color = 0x3ee0b0, maxPoints = 200) {
    const positions = new Float32Array(maxPoints * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    const trail = { line, positions, count: 0, maxPoints };
    this.trails.push(trail);
    return trail;
  }

  pushTrail(trail, x, y, z) {
    const { positions, maxPoints } = trail;
    if (trail.count < maxPoints) {
      const index = trail.count * 3;
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = z;
      trail.count += 1;
      trail.line.geometry.setDrawRange(0, trail.count);
    } else {
      positions.copyWithin(0, 3);
      const index = (maxPoints - 1) * 3;
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = z;
    }
    trail.line.geometry.attributes.position.needsUpdate = true;
  }

  clearTrail(trail) {
    trail.count = 0;
    trail.line.geometry.setDrawRange(0, 0);
  }

  syncMeshes() {
    this.physics.syncMeshes(this.meshes);
  }

  step(dt, tick) {
    // Cap frame contribution and substeps so a hitch cannot spiral into dozens
    // of Cannon steps + readout DOM writes on the next frame (力学卡顿主因之一).
    // Backend skips world.step when dynamicCount===0 (formula-only labs).
    const result = this.physics.step(dt, {
      onPreStep: this.onPreStep
        ? (fixedDt, simTime) => this.onPreStep(fixedDt, simTime)
        : undefined,
    });
    this.syncMeshes();
    tick?.(this.fixedTimeStep, result.simTime);
  }

  /** Hard clock reset used by soft experiment re-entry. */
  resetClock() {
    this.physics.resetClock();
  }

  disposePhysics() {
    this.physics?.dispose?.();
    this.bodies = [];
  }
}

function createHiddenUi(requestRebuild) {
  return {
    controls: document.createElement('div'),
    readouts: document.createElement('div'),
    formula: document.createElement('div'),
    requestRebuild,
  };
}

function parseReadouts(container) {
  if (!container?.querySelectorAll) return [];
  return [...container.querySelectorAll('.readout')].map((row) => ({
    label: row.querySelector?.('.k')?.textContent?.trim() || '',
    value: row.querySelector?.('.v')?.textContent?.trim() || '',
  }));
}

export class MechanicsSourceRuntime {
  /**
   * @param {{
   *   id: string,
   *   camera: import('three').Camera,
   *   renderer: import('three').WebGLRenderer,
   *   physicsMode?: 'main' | 'worker' | 'auto',
   * }} opts
   */
  constructor({ id, camera, renderer, physicsMode }) {
    this.id = id;
    this.source = SOURCE_MECHANICS_EXPERIMENTS[id];
    this.camera = camera;
    this.renderer = renderer;
    /** @type {'main' | 'worker' | 'auto'} */
    this.physicsMode = physicsMode;
    this.root = new THREE.Group();
    this.root.name = `mechanics-source-${id}`;
    this.root.userData.interactive = true;
    this.root.userData.role = 'mechanics_source';
    this.root.userData.sourceExperimentId = id;
    const layout = LAYOUTS[id];
    this.root.position.set(...layout.position);
    this.root.scale.setScalar(layout.scale);
    this.root.visible = false;
    this.content = null;
    this.engine = null;
    this.ui = null;
    this.instance = null;
    this.params = {};
    this.paused = false;
    this.overlays = [];
    this._readoutCache = [];
    this._readoutCacheAt = -Infinity;
    this._workflowStep = -1;
    this._attached = false;
    /** @type {boolean | undefined} */
    this._frozen = undefined;
    /** Cancels in-flight chunked freeze when setVisible is re-entered. */
    this._freezeGen = 0;
  }

  build(overrides = {}) {
    this.disposeBuild();
    this.content = new THREE.Group();
    this.content.name = `${this.root.name}-content`;
    // Always parent under root while building so world matrices are correct.
    this.root.add(this.content);
    this._attached = true;
    addSourceLights(this.content);
    this.engine = new SourceEngineAdapter({
      scene: this.content,
      camera: this.camera,
      renderer: this.renderer,
      physicsMode: this.physicsMode,
    });
    this.ui = createHiddenUi(() => {});
    this.instance = this.source.setup(this.engine, this.ui, overrides);
    this.params = this.instance?.getParams?.() || { ...overrides };
    // Legacy DOM speed-tag nodes (if any older build left them) — keep out of the way.
    this.overlays = [...document.querySelectorAll('.collision-speed-tags')];
    this.overlays.forEach((node) => node.remove());
    this.content.traverse((object) => {
      if (!object.userData) return;
      object.userData.sourceExperimentId = this.id;
    });
    // Host sun owns shadows; source casters were a major look-around cost.
    stripSourceShadowCasters(this.content);
    this._readoutCache = [];
    this._readoutCacheAt = -Infinity;
    this._workflowStep = -1;
    // Default build leaves the rig hidden until setMode activates it.
    if (!this.root.visible) this.detachContent();
    return this;
  }

  disposeBuild() {
    this.instance?.dispose?.();
    this.overlays.forEach((node) => node.remove());
    this.overlays = [];
    if (this.content) {
      this.root.remove(this.content);
      disposeObject(this.content);
    }
    this.engine?.disposePhysics?.();
    this.content = null;
    this.engine = null;
    this.ui = null;
    this.instance = null;
  }

  ensureBuilt(overrides = {}) {
    if (!this.instance) this.build(overrides || {});
    return this;
  }

  reset(overrides = null) {
    const next = overrides || this.params || {};
    this.paused = false;
    if (!this.instance) {
      this.build(next);
      return this.snapshot({ forceReadouts: true });
    }
    // Experiment open path must NEVER dispose+rebuild when the host defaults
    // already match prewarm state. Hard rebuild of viscosity/projectile was a
    // multi-second main-thread freeze (architecture: eager full reactivation).
    // Compare only keys provided by the host defaults — source getParams() may
    // include extra internal fields that would false-trigger a hard rebuild.
    const cur = this.instance.getParams?.() || this.params || {};
    let same = true;
    for (const key of Object.keys(next)) {
      // Skip host-only bookkeeping fields that should not force a rebuild.
      if (key.startsWith('_')) continue;
      if (String(cur[key]) !== String(next[key])) {
        same = false;
        break;
      }
    }
    if (same) {
      try {
        // Soft reset when available; ignore false (e.g. missing button ids).
        this.instance.hostAction?.('reset');
      } catch {
        /* soft path only */
      }
      // Critical: rewind fixed-step clock so release timers do not fire immediately.
      try { this.engine?.resetClock?.(); } catch { /* ignore */ }
      this.params = this.instance.getParams?.() || { ...cur, ...next };
      return this.snapshot({ forceReadouts: true });
    }
    // Params actually changed (user applied new conditions) — rebuild once.
    this.build(next);
    return this.snapshot({ forceReadouts: true });
  }

  /** Drop content from the graph so hidden rigs do not burn matrix updates. */
  detachContent() {
    if (this.content?.parent) this.content.parent.remove(this.content);
    this._attached = false;
    this._frozen = true;
  }

  attachContent() {
    if (!this.content) return;
    if (!this.content.parent) this.root.add(this.content);
    this._attached = true;
    this._frozen = false;
  }

  /**
   * O(1) attach/detach — no matrix freeze walks on open.
   * @param {boolean} visible
   * @param {{ sync?: boolean }} [opts] sync kept for call-site compat (ignored)
   */
  setVisible(visible, _opts = {}) {
    const on = !!visible;
    this.root.visible = on;
    if (!this.content) return;
    if (on) {
      if (!this.content.parent) this.root.add(this.content);
      this.content.visible = true;
      this._attached = true;
      this._frozen = false;
    } else {
      this.content.visible = false;
      if (this.content.parent) this.content.parent.remove(this.content);
      this._attached = false;
      this._frozen = true;
    }
  }

  setPaused(paused) {
    this.paused = !!paused;
  }

  setParam(key, value) {
    const next = { ...(this.instance?.getParams?.() || this.params), [key]: value };
    if (this.id === 'collision' && key === 'mode') {
      if (value === 'elastic') {
        next.e = 1;
        if (Math.abs(Number(next.m1) - Number(next.m2)) < 1e-6) {
          next.m1 = 3;
          next.m2 = 1.5;
        }
      } else if (value === 'inelastic') next.e = 0.4;
      else if (value === 'sticky') next.e = 0.05;
      else if (value === 'exchange') Object.assign(next, { e: 1, m1: 2, m2: 2 });
    }
    if (this.id === 'viscosity' && key === 'diameterMm') next._placedBallMm = Number(value);
    return this.reset(next);
  }

  action(action) {
    if (action === 'pause') {
      this.setPaused(!this.paused);
      return true;
    }
    if (action === 'reset') {
      this.reset();
      return true;
    }
    return !!this.instance?.hostAction?.(action);
  }

  beginBallDrag(diameterMm, context = {}) {
    return !!this.instance?.beginHostBallDrag?.(diameterMm, context, this.root);
  }

  updateBallDrag(totalX, totalY, context = {}) {
    return !!this.instance?.updateHostBallDrag?.(totalX, totalY, context, this.root);
  }

  endBallDrag(cancelled, context = {}) {
    return !!this.instance?.endHostBallDrag?.(cancelled, context, this.root);
  }

  update(dt) {
    if (!this.instance) return this.snapshot({ light: true });
    if (this.paused) return this.snapshot({ light: true });
    this.engine.step(dt, (fixedDt, simTime) => this.instance?.tick?.(fixedDt, simTime));
    // Avoid allocating a params object every frame when the instance keeps one.
    const live = this.instance?.getParams?.();
    if (live) this.params = live;
    // Light snapshot most frames (no DOM); full parse is throttled for HUD.
    return this.snapshot({ light: false });
  }

  /**
   * @param {{ light?: boolean, forceReadouts?: boolean }} [opts]
   *   light: skip DOM readout parse (camera look / quiet frames)
   */
  snapshot(opts = {}) {
    const light = opts.light === true;
    const forceReadouts = opts.forceReadouts === true;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const params = this.instance?.getParams?.() || this.params || {};

    // Readouts are only for the host hologram — 5 Hz is plenty; DOM parse every
    // frame was a major mechanics hitch (setReadouts → innerHTML → querySelector).
    if (forceReadouts || (!light && now - this._readoutCacheAt > 200)) {
      try {
        this._readoutCache = parseReadouts(this.ui?.readouts || { querySelectorAll: () => [] });
        const steps = this.ui?.controls?.querySelectorAll?.('.workflow-step');
        if (steps && steps.length) {
          this._workflowStep = [...steps].findIndex((node) => node.classList.contains('active'));
        }
      } catch {
        /* keep previous cache */
      }
      this._readoutCacheAt = now;
    }

    return {
      params,
      readouts: this._readoutCache,
      formula: this.ui?.formula?.textContent?.replace(/\s+/g, ' ').trim() || '',
      paused: this.paused,
      sourceTime: this.engine?.simTime || 0,
      workflowStep: this._workflowStep,
    };
  }
}
