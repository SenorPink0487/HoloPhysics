/** Host scene adapter for the six source-authored mechanics experiments. */
import {
  MechanicsSourceRuntime,
  SOURCE_MECHANICS_EXPERIMENTS,
} from './mechanicsSourceRuntime.js';
import { station as mechanicsCatalog } from '../../experiments/mechanics.js';
import { createEquipmentRuntime, getLeafPickSet, estimateObjectBytes } from '../../runtime/experimentRuntime.js';

const MECHANICS_DEFAULTS = Object.fromEntries(
  (mechanicsCatalog.experiments || []).map((exp) => [exp.id, { ...(exp.defaults || {}) }]),
);

export function createStationEquipment(ctx) {
  const { THREE, camera, renderer } = ctx;
  const root = new THREE.Group();
  root.name = 'mechanics-station';
  const runtimes = {};
  const runtimeIds = Object.keys(SOURCE_MECHANICS_EXPERIMENTS);
  let activeId = null;

  function createRuntime(id) {
    if (runtimes[id]) return runtimes[id];
    if (!SOURCE_MECHANICS_EXPERIMENTS[id]) return null;
    const runtime = new MechanicsSourceRuntime({ id, camera, renderer });
    root.add(runtime.root);
    runtimes[id] = runtime;
    return runtime;
  }

  function createExperimentRuntime(id) {
    const sourceRuntime = createRuntime(id);
    if (!sourceRuntime) return null;
    return createEquipmentRuntime({
      id,
      root: sourceRuntime.root,
      prepare: async (_prepareContext, signal) => {
        if (signal?.aborted) throw abortError();
        sourceRuntime.ensureBuilt(defaultsFor(id));
        // Keep the built content attached while the root stays hidden. The
        // shared GPU prewarm path must traverse the real meshes/materials;
        // detaching the content here made compileAsync warm only an empty
        // root, so the first visible frame still compiled all 205 mechanics
        // meshes and caused a multi-second hitch.
        sourceRuntime.setVisible(true);
        sourceRuntime.root.visible = false;
      },
      prepareRoot: () => sourceRuntime.root,
      activate: (initialState) => {
        sourceRuntime.setVisible(true);
        sourceRuntime.reset(initialState?.params || defaultsFor(id));
        activeId = id;
      },
      suspend: () => {
        sourceRuntime.setVisible(false);
        if (activeId === id) activeId = null;
      },
      unmount: () => sourceRuntime.setVisible(false),
      getPickSet: () => getLeafPickSet(sourceRuntime.content || sourceRuntime.root),
      estimateBytes: () => estimateObjectBytes(sourceRuntime.content || sourceRuntime.root),
      dispose: () => {
        sourceRuntime.disposeBuild();
        if (sourceRuntime.root.parent) sourceRuntime.root.parent.remove(sourceRuntime.root);
        delete runtimes[id];
        if (activeId === id) activeId = null;
      },
    });
  }

  function defaultsFor(id) {
    return { ...(MECHANICS_DEFAULTS[id] || {}) };
  }

  function ensure(id, params = {}) {
    const runtime = createRuntime(id);
    // Prefer host catalog defaults so first open matches prewarm (no rebuild).
    const initial = Object.keys(params || {}).length ? params : defaultsFor(id);
    runtime?.ensureBuilt(initial);
    return runtime;
  }

  function setMode(id, params = null, { reset = false, snapshot = true } = {}) {
    activeId = runtimeIds.includes(id) ? id : null;
    const resolved = params || (activeId ? defaultsFor(activeId) : {});
    // Ensure active rig exists before visibility pass so ensureBuilt can attach.
    const runtime = activeId ? ensure(activeId, resolved) : null;
    Object.entries(runtimes).forEach(([runtimeId, rt]) => {
      rt.setVisible(runtimeId === activeId);
    });
    if (runtime && reset) runtime.reset(resolved);
    // Snapshot is optional: switch path uses visibility-only first, then soft reset.
    if (!snapshot || !runtime) return null;
    return runtime.snapshot?.({ forceReadouts: !!reset }) || null;
  }

  const equipment = {
    setMode,
    createRuntime: createExperimentRuntime,
    prepareExperiment: (id, params = null) => ensure(id, params || defaultsFor(id)),
    /**
     * Keep the station visually complete while its menu is open. This builds
     * only the first source apparatus after station intent, never during boot.
     */
    showcase: () => {
      setMode(null, null, { reset: false, snapshot: false });
      return true;
    },
    shutdown: () => setMode(null, null, { reset: false, snapshot: false }),
    suspend: () => setMode(null, null, { reset: false, snapshot: false }),
    resume: () => { /* mode restored by experiment applyVisualDefaults */ },
    reset: (id, params) => ensure(id, params || defaultsFor(id))?.reset(params || defaultsFor(id)),
    setParam: (id, key, value) => ensure(id)?.setParam(key, value),
    setPaused: (id, paused) => ensure(id)?.setPaused(paused),
    action: (id, action) => ensure(id)?.action(action) || false,
    updateSource: (id, dt) => ensure(id)?.update(dt),
    snapshot: (id) => ensure(id)?.snapshot(),
    beginBallDrag: (diameterMm, context) => ensure('viscosity')?.beginBallDrag(diameterMm, context) || false,
    updateBallDrag: (totalX, totalY, context) => ensure('viscosity')?.updateBallDrag(totalX, totalY, context) || false,
    endBallDrag: (cancelled, context) => ensure('viscosity')?.endBallDrag(cancelled, context) || false,
    get activeId() { return activeId; },
    sourceRuntimes: new Proxy(runtimes, {
      get(target, property) {
        if (typeof property === 'string' && runtimeIds.includes(property)) {
          return target[property] || createRuntime(property);
        }
        return target[property];
      },
    }),
  };

  setMode(null);
  // Intent/open path owns compileAsync + 1×1 present; no boot prewarm map.
  return { root, equipment, animators: [], refs: runtimes };
}

function abortError() {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}
