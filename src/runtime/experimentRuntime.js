import * as THREE from 'three';

/**
 * Transactional experiment lifecycle adapter. Runtime implementations may be
 * legacy handlers as long as they satisfy this boundary.
 */
export const RUNTIME_STATES = Object.freeze([
  'cold', 'loading', 'prepared', 'active', 'warm', 'disposing', 'error',
]);

/**
 * Adapt an existing host equipment group to the transactional runtime
 * contract. The station remains the owner of shared lighting/material pools;
 * an adapter owns only the selected mode's mount and lifecycle callbacks.
 */
export function createEquipmentRuntime({
  id,
  root,
  getRoot = () => root,
  prepare = async () => {},
  prepareRoot = () => root,
  prepareRenderTarget = null,
  activate = () => {},
  mount: mountEquipment = () => {},
  suspend = () => {},
  unmount = () => {},
  getPickSet,
  estimateBytes,
  dispose = () => {},
} = {}) {
  const resolveRoot = () => getRoot?.() || root;
  return createExperimentRuntime({
    id,
    prepare,
    prepareGpu: async (renderer, camera, prepareScene, signal, targetScene, renderTarget) => {
      const target = prepareRoot?.() || resolveRoot();
      const scene = typeof prepareScene === 'function' ? prepareScene() : prepareScene;
      const compileTargetScene = typeof targetScene === 'function' ? targetScene() : targetScene;
      const offscreenTarget = typeof renderTarget === 'function'
        ? renderTarget()
        : (renderTarget || (typeof prepareRenderTarget === 'function' ? prepareRenderTarget() : prepareRenderTarget));
      const gpuTrace = typeof window !== 'undefined' && (
        window.__LAB_TRACE
        || new URLSearchParams(window.location?.search || '').has('trace')
        || new URLSearchParams(window.location?.search || '').has('measure')
      );
      const previousParent = target?.parent || null;
      const previousVisible = target?.visible;
      // Some apparatuses have a deterministic, data-independent visual cache
      // (for example the default electric-field lines). Build it before GPU
      // compilation so the first live commit does not allocate decorations.
      try { target?.userData?.prewarmGpu?.(); } catch { /* optional visual cache */ }
      if (scene?.add && target && target.parent !== scene) scene.add(target);
      if (target) target.visible = true;
      target?.updateWorldMatrix?.(true, true);
      // The shared prepare scene also contains chrome clones for intent
      // prediction. They are useful for a focused card prewarm, but compiling
      // every station's controls for each runtime makes an active A→B switch
      // pay for hundreds of unrelated meshes. Isolate the incoming apparatus;
      // labShell compiles the committed chrome once after activation.
      const hiddenPrepareObjects = [];
      const belongsToTarget = (object) => {
        let parent = object;
        while (parent) {
          if (parent === target) return true;
          parent = parent.parent;
        }
        return false;
      };
      scene?.traverse?.((object) => {
        if (object === target || object.isLight || belongsToTarget(object)) return;
        if (!('visible' in object) || !object.visible) return;
        hiddenPrepareObjects.push([object, object.visible]);
        object.visible = false;
      });
      try {
        const compileStart = gpuTrace ? performance.now() : 0;
        const programCountBefore = gpuTrace ? (renderer?.info?.programs?.length || 0) : 0;
        if (typeof renderer?.compileAsync === 'function') {
          try { await renderer.compileAsync(scene || target, camera, compileTargetScene || undefined); }
          catch { renderer?.compile?.(scene || target, camera, compileTargetScene || undefined); }
        } else {
          renderer?.compile?.(scene || target, camera, compileTargetScene || undefined);
        }
        if (gpuTrace) {
          console.warn('[gpu-prewarm-trace]', JSON.stringify({
            id,
            ms: Number((performance.now() - compileStart).toFixed(1)),
            programsBefore: programCountBefore,
            programsAfter: renderer?.info?.programs?.length || 0,
            hasTargetScene: !!compileTargetScene,
            targetScene: compileTargetScene?.name || compileTargetScene?.type || null,
            meshCount: (() => {
              let count = 0;
              scene?.traverse?.((object) => { if (object.isMesh || object.isLine || object.isPoints || object.isSprite) count += 1; });
              return count;
            })(),
          }));
        }
      } finally {
        hiddenPrepareObjects.forEach(([object, value]) => { object.visible = value; });
        if (previousParent && target?.parent !== previousParent) previousParent.add(target);
        else if (!previousParent && target?.parent === scene) scene?.remove?.(target);
        if (target && previousVisible !== undefined) target.visible = previousVisible;
      }
      // compileAsync creates program objects, but ANGLE can still defer the
      // first actual draw/buffer upload until render(). Draw only the isolated
      // prepare scene here. Rendering compileTargetScene would traverse the
      // entire room on every experiment switch and turn a background GPU
      // prepare into a multi-second synchronous stall; labShell performs one
      // shared default-framebuffer warm draw after the final visual commit.
      if (offscreenTarget && compileTargetScene && typeof renderer?.render === 'function') {
        const previousTarget = renderer.getRenderTarget?.() || null;
        const previousViewport = renderer.getViewport?.(new THREE.Vector4()) || null;
        const previousScissor = renderer.getScissor?.(new THREE.Vector4()) || null;
        const previousScissorTest = renderer.getScissorTest?.();
        const hiddenPreviousVisible = target?.visible;
        const previousFrustumCulled = [];
        try {
          if (target) target.visible = true;
          // The real camera may not currently look at a side station. Disable
          // culling only for this 1x1 warm draw so every apparatus material
          // variant is touched; restore each flag before returning to input.
          target?.traverse?.((object) => {
            if (!('frustumCulled' in object)) return;
            previousFrustumCulled.push([object, object.frustumCulled]);
            object.frustumCulled = false;
          });
          target?.updateWorldMatrix?.(true, true);
          renderer.setRenderTarget?.(offscreenTarget);
          renderer.setViewport?.(0, 0, 1, 1);
          renderer.setScissorTest?.(false);
          renderer.clear?.();
          const hiddenRenderStart = gpuTrace ? performance.now() : 0;
          renderer.render(scene || compileTargetScene, camera);
          if (gpuTrace) {
            console.warn('[gpu-prewarm-render-trace]', JSON.stringify({
              id,
              ms: Number((performance.now() - hiddenRenderStart).toFixed(1)),
              programs: renderer?.info?.programs?.length || 0,
            }));
          }
        } finally {
          renderer.setRenderTarget?.(previousTarget);
          if (previousViewport) renderer.setViewport?.(previousViewport);
          if (previousScissor) renderer.setScissor?.(previousScissor);
          renderer.setScissorTest?.(!!previousScissorTest);
          previousFrustumCulled.forEach(([object, value]) => { object.frustumCulled = value; });
          if (target && hiddenPreviousVisible !== undefined) target.visible = hiddenPreviousVisible;
        }
      }
      if (signal?.aborted) throw abortError();
    },
    mount: (parent) => {
      const target = resolveRoot();
      if (target) target.visible = true;
      mountEquipment(parent, target);
    },
    activate,
    getPickSet: getPickSet || (() => getLeafPickSet(resolveRoot())),
    suspend,
    unmount,
    estimateBytes: estimateBytes || (() => estimateObjectBytes(resolveRoot())),
    dispose,
  });
}

export function getLeafPickSet(root) {
  if (!root?.traverse) return [];
  const leaves = [];
  root.traverse((object) => {
    if (object === root || !object.isObject3D || !object.raycast || !object.visible) return;
    if (object.userData?.nonInteractive || object.userData?.isHelper) return;
    if (object.isMesh || object.isLine || object.isPoints) leaves.push(object);
  });
  return leaves;
}

export function estimateObjectBytes(root) {
  if (!root?.traverse) return { cpu: 0, gpu: 0 };
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  let geometryBytes = 0;
  let textureBytes = 0;
  root.traverse((object) => {
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
  const cpu = geometryBytes + materials.size * 512;
  const gpu = geometryBytes + textureBytes + materials.size * 256;
  return { cpu, gpu };
}

export function createExperimentRuntime({
  id,
  prepare = async () => {},
  prepareGpu = async () => {},
  mount = () => {},
  activate = () => {},
  fixedUpdate = () => {},
  visualUpdate = () => {},
  getPickSet = () => [],
  suspend = () => {},
  unmount = () => {},
  estimateBytes = () => ({ cpu: 0, gpu: 0 }),
  dispose = () => {},
} = {}) {
  let state = 'cold';
  let disposed = false;

  function transition(next) {
    if (!RUNTIME_STATES.includes(next)) throw new Error(`Invalid runtime state: ${next}`);
    state = next;
  }

  return {
    id,
    get state() { return state; },
    async prepare(ctx, signal) {
      if (disposed) throw new Error(`Runtime ${id} is disposed`);
      if (state !== 'cold' && state !== 'error') return;
      transition('loading');
      try {
        await prepare(ctx, signal);
        if (signal?.aborted) throw abortError();
        transition('prepared');
      } catch (error) {
        transition('error');
        throw error;
      }
    },
    async prepareGpu(renderer, camera, prepareScene, signal, targetScene, renderTarget) {
      if (state !== 'prepared') throw new Error(`Runtime ${id} is not prepared`);
      await prepareGpu(renderer, camera, prepareScene, signal, targetScene, renderTarget);
      if (signal?.aborted) throw abortError();
    },
    mount(parent) {
      if (state !== 'prepared' && state !== 'warm') throw new Error(`Runtime ${id} cannot mount from ${state}`);
      mount(parent);
    },
    activate(initialState) {
      if (state !== 'prepared' && state !== 'warm') throw new Error(`Runtime ${id} cannot activate from ${state}`);
      activate(initialState);
      transition('active');
    },
    fixedUpdate,
    visualUpdate,
    getPickSet,
    suspend() {
      if (state === 'active') {
        suspend();
        transition('warm');
      }
    },
    unmount() {
      if (state === 'active') suspend();
      if (state === 'active' || state === 'warm' || state === 'prepared') {
        unmount();
        transition('warm');
      }
    },
    estimateBytes,
    dispose() {
      if (disposed) return false;
      disposed = true;
      if (state !== 'cold' && state !== 'error') {
        transition('disposing');
        try { dispose(); } finally { transition('cold'); }
      } else {
        dispose();
      }
      return true;
    },
  };
}

export function createTransitionController({ cache, createRuntime, prepareContext = {}, prepareScene } = {}) {
  let sessionId = 0;
  let current = null;
  let controller = null;
  const pendingPrepares = new Map();

  async function prepareRuntime(key, signal) {
    let runtime = cache?.get(key) || null;
    if (runtime && runtime.state !== 'cold' && runtime.state !== 'error') {
      return runtime;
    }
    if (runtime) cache?.remove?.(key);

    runtime = await createRuntime(key, prepareContext, signal);
    try {
      await runtime.prepare(prepareContext, signal);
      await runtime.prepareGpu?.(
        prepareContext.renderer,
        prepareContext.camera,
        prepareScene,
        signal,
        prepareContext.targetScene,
        prepareContext.renderTarget,
      );
      // A prepared runtime is safe to retain: it has not been mounted or
      // activated yet, but it can be mounted immediately by open(). Keeping
      // it in the same cache is what makes intent prewarm and click reuse the
      // exact same apparatus and compiled GPU programs.
      cache?.warm?.(key, runtime);
      return runtime;
    } catch (error) {
      try { runtime.dispose?.(); } catch { /* best effort */ }
      throw error;
    }
  }

  function prewarm(key, externalSignal) {
    const cached = cache?.get(key) || null;
    if (cached && cached.state !== 'cold' && cached.state !== 'error') {
      return Promise.resolve({ prepared: true, cached: true, runtime: cached });
    }

    const existing = pendingPrepares.get(key);
    if (existing) return existing.promise;

    const prepareController = new AbortController();
    const abortExternal = () => prepareController.abort();
    if (externalSignal?.aborted) prepareController.abort();
    else externalSignal?.addEventListener?.('abort', abortExternal, { once: true });
    const entry = { controller: prepareController, promise: null };
    entry.promise = prepareRuntime(key, prepareController.signal)
      .then((runtime) => ({ prepared: true, cached: false, runtime }))
      .catch((error) => ({ prepared: false, error }))
      .finally(() => {
        externalSignal?.removeEventListener?.('abort', abortExternal);
        if (pendingPrepares.get(key) === entry) pendingPrepares.delete(key);
      });
    pendingPrepares.set(key, entry);
    return entry.promise;
  }

  function cancelPrewarm(key) {
    const entry = pendingPrepares.get(key);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  }

  async function open(key, initialState) {
    const id = ++sessionId;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const previous = current;
    let runtime = cache?.get(key) || null;
    try {
      if (runtime && runtime === current) {
        return { committed: true, sessionId: id, runtime, unchanged: true };
      }
      // If card focus already started preparation, wait for that exact
      // runtime instead of constructing a second apparatus on click.
      if (!runtime) {
        const pending = pendingPrepares.get(key);
        if (pending) {
          const result = await pending.promise;
          if (result.prepared) runtime = result.runtime;
        }
      }
      // A warm runtime can be reused, but an active runtime from an older
      // session must first move through suspend so mount/activate remain
      // transactional and idempotent.
      if (runtime?.state === 'active' && runtime !== current) runtime.suspend?.();
      if (!runtime) {
        runtime = await prepareRuntime(key, signal);
      }
      if (signal.aborted || id !== sessionId) throw abortError();
      runtime.mount(prepareContext.detachedRoot || prepareContext.parent);
      // The incoming runtime is ready at this point. Suspend the old runtime
      // before activation because several stations share one mode parent.
      // This keeps a shared station from hiding the newly activated mode.
      const previousKey = current?.id;
      current?.suspend?.();
      current?.unmount?.();
      if (current && previousKey && previousKey !== key) cache?.warm?.(previousKey, current);
      runtime.activate(initialState);
      if (signal.aborted || id !== sessionId) throw abortError();
      current = runtime;
      cache?.activate?.(key, runtime);
      return { committed: true, sessionId: id, runtime };
    } catch (error) {
      if (runtime && runtime !== current) {
        try { runtime.unmount?.(); } catch { /* best effort */ }
        if (cache?.get?.(key) === runtime) {
          cache.remove?.(key);
        } else {
          try { runtime.dispose?.(); } catch { /* best effort */ }
        }
      }
      if (error?.name === 'AbortError') return { committed: false, cancelled: true, sessionId: id };
      return { committed: false, error, sessionId: id, previous };
    }
  }

  function dispose() {
    controller?.abort();
    for (const entry of pendingPrepares.values()) entry.controller.abort();
    pendingPrepares.clear();
    const previous = current;
    current = null;
    cache?.clear?.();
    // A failed or not-yet-cached runtime can still be the current one.
    if (previous && !cache?.has?.(previous.id)) previous.dispose?.();
  }

  return {
    open,
    prewarm,
    cancelPrewarm,
    dispose,
    get current() { return current; },
    get sessionId() { return sessionId; },
  };
}

function abortError() {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}
