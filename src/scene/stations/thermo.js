/** Host adapter for the original reli-source thermodynamics apparatus. */

import { createEquipmentRuntime } from '../../runtime/experimentRuntime.js';

const THERMO_EXPERIMENT_IDS = Object.freeze([
  'calorimetry',
  'convection',
  'heat-conduction',
  'ideal-gas',
  'thermal-expansion',
]);

/**
 * Host room already has a key light + shadow map. Source casters (thermal-expansion
 * heater coils especially) make the *first* open re-fill the shadow map and freeze
 * the view for a frame. Keep source self-lighting (PointLight) but never cast.
 */
function stripSourceShadowCasters(root) {
  if (!root?.traverse) return;
  root.traverse((object) => {
    if (object.isLight) {
      object.castShadow = false;
      return;
    }
    if (object.castShadow) object.castShadow = false;
    // Receive is cheap enough for contact grounding; leave as authored.
  });
}

/**
 * O(1) mount/unmount — never freeze-walk thermo source trees on open.
 * Detached rigs are free for updateMatrixWorld and picking.
 */
function mountRig(parent, rig, on) {
  if (!parent || !rig) return;
  if (on) {
    // Source experiments initially parent their rig to a private Scene. The
    // host must reparent it even when that source parent is still present;
    // checking only for a null parent leaves a visible rig outside WebGL's
    // live station graph.
    if (rig.parent !== parent) parent.add(rig);
    rig.visible = true;
  } else {
    rig.visible = false;
    if (rig.parent) rig.parent.remove(rig);
  }
}

export function createStationEquipment(ctx) {
  const { THREE, renderer, camera } = ctx;
  const root = new THREE.Group();
  root.name = 'thermo-station';
  // Source rigs are bench-sized.  The host station table is smaller, so scale
  // the complete source model uniformly; no geometry is substituted.
  // Keep the source bench-top height after uniform scaling (source rigs use
  // local y≈0.88, while the host tabletop is y≈0.93).
  // Nudge toward table center (−Z from sitting edge) so desk sliders on z≈3.13 stay clear.
  root.position.set(4.2, 0.60, 2.45);
  root.scale.setScalar(0.38);

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = 8;
  sourceCanvas.height = 8;
  sourceCanvas.style.touchAction = 'none';
  // Constructors arrive through the experiment-intent loader. Keeping this
  // station shell free of reli experiment imports makes station-menu loading
  // independent of all five source runtimes.
  const classes = { ...(ctx.experimentClasses || {}) };
  const experiments = {};
  const experimentIds = THERMO_EXPERIMENT_IDS;
  const animators = [];
  const lastParamSignatures = new Map();
  const runtimeRecords = new Map();
  /** @type {string | null} */
  let activeId = null;

  function ensureExperiment(id) {
    if (experiments[id]) return experiments[id];
    const Klass = classes[id];
    if (typeof Klass !== 'function') return null;
    const experiment = new Klass(renderer, sourceCanvas);
    experiment.setup();
    experiment.controls.enabled = false;
    experiment.rig.visible = false;
    experiment.rig.userData.sourceExperimentId = id;
    // Host owns room shadows — strip dense source casters (solid expansion coils…).
    stripSourceShadowCasters(experiment.rig);
    // Attach host semantic roles to source pick volumes so the existing
    // pointer-lock/AR resolver can operate on the original meshes.
    if (id === 'calorimetry') {
      experiment.hotBeaker.userData.interactive = true;
      experiment.hotBeaker.userData.role = 'thermo_hot_beaker';
      experiment.coldBeaker.userData.interactive = true;
      experiment.coldBeaker.userData.role = 'thermo_cold_beaker';
      experiment.rig.userData.interactive = true;
      experiment.rig.userData.role = 'thermo_calorimeter';
    } else if (id === 'ideal-gas') {
      experiment.piston.userData.interactive = true;
      experiment.piston.userData.role = 'thermo_piston';
    } else {
      experiment.rig.userData.interactive = true;
      experiment.rig.userData.role = `thermo_${id}`;
    }
    // Park detached — first open is O(1) parent.add, not a freeze walk.
    experiments[id] = experiment;
    if (id === 'heat-conduction') experiment._hostFieldOwned = true;
    if (id === 'ideal-gas' || id === 'convection') experiment._hostParticlesOwned = true;
    return experiment;
  }

  function estimateRuntimeBytes(experiment) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    let geometryBytes = 0;
    let textureBytes = 0;
    // The source scene owns legacy scaffolding, while the host renders only
    // `rig`. Measure the mounted graph so cache eviction reflects the same
    // resource surface as every other station runtime.
    (experiment?.rig || experiment?.scene)?.traverse?.((object) => {
      if (object.geometry && !geometries.has(object.geometry)) {
        geometries.add(object.geometry);
        for (const attribute of Object.values(object.geometry.attributes || {})) {
          geometryBytes += attribute.array?.byteLength || 0;
        }
        geometryBytes += object.geometry.index?.array?.byteLength || 0;
      }
      const values = Array.isArray(object.material) ? object.material : [object.material];
      values.forEach((material) => {
        if (!material || materials.has(material)) return;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (!value?.isTexture || textures.has(value)) continue;
          textures.add(value);
          const image = value.image;
          textureBytes += Math.max(1, image?.width || 1) * Math.max(1, image?.height || 1) * 4;
        }
      });
    });
    // Include the particle/state arrays and a small material/object overhead.
    const cpu = geometryBytes + (experiment?.particles?.length || 0) * 48 + materials.size * 512;
    const gpu = geometryBytes + textureBytes + materials.size * 256;
    return { cpu, gpu };
  }

  function markPick(object, role) {
    if (!object) return null;
    object.userData ||= {};
    object.userData.interactive = true;
    object.userData.role = role;
    return object;
  }

  function pickSetFor(id, experiment) {
    const sets = {
      calorimetry: [
        markPick(experiment?.hotBeaker, 'thermo_hot_beaker'),
        markPick(experiment?.coldBeaker, 'thermo_cold_beaker'),
      ],
      convection: [
        markPick(experiment?.plate, 'thermo_hot_plate'),
      ],
      'heat-conduction': [
        markPick(experiment?.hotBath, 'thermo_hot_bath'),
        markPick(experiment?.coldBath, 'thermo_cold_bath'),
        markPick(experiment?.tube, 'thermo_sample_tube'),
      ],
      'ideal-gas': [
        markPick(experiment?.piston, 'thermo_piston'),
      ],
      'thermal-expansion': [
        markPick(experiment?.rod, 'thermo_specimen_rod'),
        markPick(experiment?.heater, 'thermo_heater'),
      ],
    };
    return (sets[id] || []).filter(Boolean);
  }

  function disposeObjectTree(object) {
    if (!object?.traverse) return;
    const materials = new Set();
    const textures = new Set();
    object.traverse((node) => {
      node.geometry?.dispose?.();
      const values = Array.isArray(node.material) ? node.material : [node.material];
      values.forEach((material) => {
        if (!material || materials.has(material)) return;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture && !textures.has(value)) {
            textures.add(value);
            value.dispose?.();
          }
        }
        material.dispose?.();
      });
    });
    object.parent?.remove(object);
    while (object.children?.length) object.remove(object.children[0]);
  }

  /**
   * Give every source apparatus the same runtime boundary as mechanics,
   * optics and electro. The legacy class still owns its visual state; the
   * host owns its lifecycle, GPU compile and cache membership.
   */
  function createRuntime(id) {
    if (!THERMO_EXPERIMENT_IDS.includes(id)) return null;
    const existing = runtimeRecords.get(id);
    if (existing) return existing;

    const experiment = ensureExperiment(id);
    if (!experiment) return null;
    const runtime = createEquipmentRuntime({
      id,
      root: experiment.rig,
      getRoot: () => experiment.rig,
      prepare: async (_prepareContext, signal) => {
        if (signal?.aborted) throw abortError();
        // Source setup happens once in ensureExperiment. Keep this rig out of
        // the live graph until the shared prepareGpu path has compiled it.
        mountRig(root, experiment.rig, false);
        if (signal?.aborted) throw abortError();
      },
      prepareRoot: () => experiment.rig,
      mount: (_parent, rig) => mountRig(root, rig, true),
      activate: () => setMode(id),
      suspend: () => {
        if (activeId === id) setMode(null);
      },
      unmount: () => {
        if (activeId === id) setMode(null);
        else mountRig(root, experiment.rig, false);
      },
      getPickSet: () => pickSetFor(id, experiment),
      estimateBytes: () => estimateRuntimeBytes(experiment),
      dispose: () => {
        if (activeId === id) setMode(null);
        else mountRig(root, experiment.rig, false);
        // The source scene contains supporting objects outside the host rig.
        // Release the rig first, then allow the original class to dispose its
        // private scene and controls.
        disposeObjectTree(experiment.rig);
        experiment.dispose?.();
        delete experiments[id];
        lastParamSignatures.delete(id);
        runtimeRecords.delete(id);
      },
    });
    runtimeRecords.set(id, runtime);
    return runtime;
  }

  function setMode(expId) {
    const next = expId && classes[expId] ? expId : null;
    if (next) ensureExperiment(next);
    if (activeId === next) return;
    if (activeId && experiments[activeId]) {
      mountRig(root, experiments[activeId].rig, false);
    }
    activeId = next;
    if (next && experiments[next]) {
      mountRig(root, experiments[next].rig, true);
    }
  }

  function syncParams(expId, data, opts = {}) {
    const exp = ensureExperiment(expId);
    if (!exp || !data) return;
    const next = exp.params;
    const signatureKeys = expId === 'calorimetry'
      ? ['tHot', 'tCold', 'mHot', 'mCold']
      : expId === 'convection'
        ? ['tPlate', 'tAir', 'area', 'running']
        : expId === 'heat-conduction'
          ? ['tHot', 'tCold', 'conductivity', 'running']
          : expId === 'ideal-gas'
            ? ['temperature', 'volume']
            : ['temperature', 'length0', 'material'];
    const signature = signatureKeys.map((key) => `${key}:${data[key]}`).join('|');
    const changed = lastParamSignatures.get(expId) !== signature;
    lastParamSignatures.set(expId, signature);
    if (expId === 'calorimetry') {
      Object.assign(next, { tHot: data.tHot, tCold: data.tCold, mHot: data.mHot, mCold: data.mCold });
      // onParamChange resets mix when cups are full — only when user params change.
      if (changed) exp.onParamChange();
      // Let the source's phased approach → tilt/stream → return animation
      // commit the cup only when its own state machine reaches the end.
      if (data.cupHot && !exp.cup.hasHot && !exp.pour) exp._commitPour('hot');
      if (data.cupCold && !exp.cup.hasCold && !exp.pour) exp._commitPour('cold');
      // Host is single source of truth for mix clock (see updateSource).
      if (data.mixProgress != null) exp.mixProgress = Number(data.mixProgress);
      if (data.tCurrent != null) exp.tCurrent = data.tCurrent;
      // Visual paint is owned by updateSource so we do not double _syncVisuals
      // every frame (was a major thermo hitch + 2× mix advance path).
      if (opts.forceVisual) exp._syncVisuals?.();
    } else if (expId === 'convection') {
      Object.assign(next, { tPlate: data.tPlate, tAir: data.tAir, area: data.area, running: data.running });
      // Plate scale only depends on area; other params feed the live particle sim.
      if (changed) exp.onParamChange('area');
    } else if (expId === 'heat-conduction') {
      Object.assign(next, { tHot: data.tHot, tCold: data.tCold, conductivity: data.conductivity, running: data.running });
      if (changed) {
        exp.onParamChange('tHot');
        exp.onParamChange('tCold');
      }
      // Host owns the finite-difference field; copy into source for coloring.
      if (data.temps?.length && exp.temps?.length) {
        const n = Math.min(data.temps.length, exp.temps.length);
        for (let i = 0; i < n; i += 1) exp.temps[i] = data.temps[i];
      }
    } else if (expId === 'ideal-gas') {
      const prevT = next.temperature;
      const prevV = next.volume;
      Object.assign(next, { temperature: data.temperature, volume: data.volume });
      if (changed) {
        // Only rescale velocities / rebuild piston when the quantized value moved.
        if (prevT !== next.temperature) exp.onParamChange('temperature');
        if (prevV !== next.volume) exp.onParamChange('volume');
      }
    } else if (expId === 'thermal-expansion') {
      Object.assign(next, { temperature: data.temperature, length0: data.length0, material: data.material });
      if (changed) {
        exp.onParamChange('material');
        exp.onParamChange('length0');
      }
    }
  }

  function updateState(expId, data, opts = {}) {
    syncParams(expId, data, opts);
  }

  /**
   * Advance source visuals. Host manager owns discrete physics for calorimetry
   * mix + heat-conduction FD + ideal-gas particles (via SimBackend); source must
   * not re-integrate those (2× speed bug).
   */
  function updateSource(expId, dt) {
    const exp = ensureExperiment(expId);
    if (!exp) return;
    const h = Math.min(dt, 0.05);
    // Keep source clock alive for glow/pulse animations.
    exp.clock.getDelta();

    if (expId === 'calorimetry') {
      // Pour animation is source-owned; mix progress is host-owned.
      if (exp.pour) {
        exp._updatePour?.(h);
      } else {
        // Keep the stirrer alive while the host mix clock runs (source.update
        // no longer advances mix, so it would never spin otherwise).
        if (
          exp.cup?.hasHot
          && exp.cup?.hasCold
          && Number(exp.mixProgress || 0) < 0.98
          && exp.stirrer
        ) {
          const dT = Math.abs(Number(exp.params?.tHot || 0) - Number(exp.params?.tCold || 0));
          const stir = 3.2 + (dT / 60) * 2.5;
          exp.stirrer.rotation.y += h * stir;
        }
        exp._syncVisuals?.();
      }
      return;
    }

    if (expId === 'heat-conduction') {
      // Skip source FD (host already stepped d.temps and copied into exp.temps).
      exp._hostFieldOwned = true;
      exp.update?.(h);
      return;
    }

    if (expId === 'ideal-gas') {
      // Host SimBackend owns particle integrate; source only paints instances.
      exp._hostParticlesOwned = true;
      exp.update?.(h);
      return;
    }

    if (expId === 'convection') {
      // Host SimBackend owns plume integrate; source only paints smoke buffers.
      exp._hostParticlesOwned = true;
      exp.update?.(h);
      if (exp.smoke?.material?.uniforms) {
        const spriteScale = 0.45;
        const heat = THREE.MathUtils.clamp(
          Math.max(0, (exp.params?.tPlate || 650) - (exp.params?.tAir || 300)) / 520,
          0,
          1,
        );
        exp.smoke.material.uniforms.uScale.value = (300 + heat * 80) * spriteScale;
        exp.smoke.material.uniforms.uOpacity.value = (exp.params?.running === false ? 0.12 : 0.55) * 0.80;
      }
      return;
    }

    exp.update?.(h);
  }

  animators.push((_t) => {
    const state = ctx.getExperimentState?.();
    // Only drive the active experiment while running — never keep a leftover
    // visible rig integrating after cleanup (setMode null hides all).
    const activeId = state?.running && experiments[state.expId] ? state.expId : null;
    if (!activeId) return;
    updateSource(activeId, state?._dt || 1 / 60);
  });

  const equipment = {
    registerExperiment: (id, Klass) => {
      if (!THERMO_EXPERIMENT_IDS.includes(id) || typeof Klass !== 'function') return false;
      classes[id] = Klass;
      return true;
    },
    createRuntime,
    setMode,
    // Host-level recovery hook used after a legacy handler commits. Keeping it
    // on the station contract avoids a thermo-only lifecycle branch in the
    // lab shell.
    ensureActiveRuntime: (id) => {
      const experiment = ensureExperiment(id);
      if (!experiment) return false;
      setMode(id);
      experiment.rig.visible = true;
      return experiment.rig.parent === root;
    },
    // Intent prediction may construct a source rig without mounting it.
    prepareExperiment: (id) => ensureExperiment(id)?.rig || null,
    getExperimentRig: (id) => experiments[id]?.rig || null,
    /**
     * Active Station Runtime: clear the tabletop while the menu is open and no
     * experiment is selected. Apparatus only appears after a card is chosen.
     */
    showcase: () => {
      setMode(null);
      return true;
    },
    shutdown: () => setMode(null),
    suspend: () => setMode(null),
    resume: () => { /* mode restored by experiment applyVisualDefaults */ },
    updateState,
    updateSource,
    pour: (kind) => {
      const exp = ensureExperiment('calorimetry');
      const beaker = kind === 'hot' ? exp.hotBeaker : exp.coldBeaker;
      if (exp.cup?.[kind === 'hot' ? 'hasHot' : 'hasCold'] || exp.pour) return false;
      exp._beginPour(kind, beaker);
      return true;
    },
    getPourState: () => {
      const p = ensureExperiment('calorimetry')?.pour;
      return p ? { active: true, phase: p.phase, t: p.t } : { active: false };
    },
    reset: (expId) => {
      lastParamSignatures.delete(expId);
      const exp = ensureExperiment(expId);
      exp?.reset?.();
      // Host never uses OrbitControls on the dummy canvas.
      if (exp?.controls) exp.controls.enabled = false;
      if (exp) {
        exp._hostFieldOwned = expId === 'heat-conduction';
        exp._hostParticlesOwned = expId === 'ideal-gas' || expId === 'convection';
      }
    },
    /** Read live source counters (ideal-gas collisions) after visual tick. */
    getSourceMetrics: (expId) => {
      const exp = ensureExperiment(expId);
      if (!exp) return null;
      if (expId === 'ideal-gas') {
        return {
          collisionsPerSec: Number(exp.collisionsPerSec || 0),
          collisionWindow: Number(exp.collisionWindow || 0),
        };
      }
      return null;
    },
    sourceExperiments: new Proxy(experiments, {
      get(target, property) {
        if (typeof property === 'string' && classes[property]) {
          return target[property] || ensureExperiment(property);
        }
        return target[property];
      },
    }),
  };

  setMode(null);
  // Intent/open path owns compileAsync + 1×1 present; no boot prewarm map.
  return { root, equipment, animators, refs: experiments };
}

function abortError() {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}
