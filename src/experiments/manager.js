/**
 * Experiment manager — routes interactions to per-station handlers.
 */
import { isParamSliderAction, valueFromParamSliderPick } from '../holoScreen.js';
import { labFrameScheduler } from '../frameBudget.js';
import { labOpenTiming } from '../runtime/openTiming.js';
import { createExperimentHandlers, defineStationExperimentModule } from './contract.js';

/** Create manager bound to scene equipment refs */
export function createExperimentManager({
  equipment,
  catalog = {},
  modules = {},
  onHudUpdate,
  onToast,
  /** Optional external scheduler; defaults to shared lab frame budget. */
  scheduler = labFrameScheduler,
  /**
   * Active Station Runtime — at most one hot station.
   * @type {{ setHotStation?: (id: string|null) => string|null, getHotStation?: () => string|null, coldBootAll?: () => void } | null}
   */
  stationPresence = null,
  /** Optional open-timing recorder (defaults to shared labOpenTiming). */
  openTiming = labOpenTiming,
  /**
   * Called after apparatus graph may have changed (setMode / showcase).
   * Host uses this to invalidate pickable caches without full-scene walks.
   * @type {null | ((stationId: string) => void)}
   */
  onApparatusGraphChanged = null,
  /** Called after the incoming apparatus defaults are applied. */
  onVisualReady = null,
}) {
  const state = {
    stationId: null,
    expId: null,
    stepIndex: 0,
    running: false,
    data: {},
    menuOpen: false,
  };

  const usingFallbackCatalog = Object.keys(catalog).length === 0;
  const stationCatalog = usingFallbackCatalog
    ? {
      electro: {
        id: 'electro',
        title: '电磁学实验台',
        experiments: [{ id: 'hall_effect', name: '霍尔效应测磁', steps: [] }],
      },
    }
    : catalog;
  const stationModules = modules;

  function currentStation() {
    return state.stationId ? stationCatalog[state.stationId] : null;
  }
  function currentExp() {
    const st = currentStation();
    if (!st || !state.expId) return null;
    return st.experiments.find((e) => e.id === state.expId) || null;
  }
  function currentStep() {
    const exp = currentExp();
    if (!exp) return null;
    return exp.steps[state.stepIndex] || null;
  }

  function toast(msg) {
    if (onToast) onToast(msg);
  }

  /**
   * HUD canvas paint is expensive — never flush on the click microtask.
   * Snapshot eagerly, paint on the frame budget after WebGL present.
   */
  let pendingHudPayload = null;

  function buildHudPayload() {
    const st = currentStation();
    const exp = currentExp();
    const step = currentStep();
    return {
      menuOpen: state.menuOpen,
      station: st,
      experiment: exp,
      stepIndex: state.stepIndex,
      step,
      running: state.running,
      // Shallow copy is enough; handlers own nested mutation carefully.
      data: state.data ? { ...state.data } : {},
      stations: stationCatalog,
    };
  }

  function flushHudNow() {
    if (!onHudUpdate || !pendingHudPayload) return;
    const payload = pendingHudPayload;
    pendingHudPayload = null;
    try {
      // onHudUpdate must stay cheap (store snapshot + schedule canvas jobs only).
      onHudUpdate(payload);
    } catch { /* never break the frame over HUD */ }
  }

  function pushHud() {
    if (!onHudUpdate) return;
    pendingHudPayload = buildHudPayload();
    // After WebGL present only. One job per pulse — never chain with geometry work.
    scheduler.schedule('hud:paint', flushHudNow, { priority: 100 });
  }

  /** Force a HUD paint on the next drain without waiting for another push. */
  function requestHudPaint() {
    if (pendingHudPayload || !onHudUpdate) {
      scheduler.schedule('hud:paint', flushHudNow, { priority: 100 });
      return;
    }
    pushHud();
  }

  function advanceStep() {
    const exp = currentExp();
    if (!exp) return;
    if (state.stepIndex < exp.steps.length - 1) {
      state.stepIndex += 1;
      toast(`步骤 ${state.stepIndex + 1}/${exp.steps.length}`);
    } else {
      toast('实验完成！可返回菜单选择其他实验');
      state.data.completed = true;
    }
    pushHud();
  }

  function setStep(id) {
    const exp = currentExp();
    if (!exp) return;
    const idx = exp.steps.findIndex((s) => s.id === id);
    if (idx >= 0 && idx > state.stepIndex) {
      state.stepIndex = idx;
      pushHud();
    }
  }

  const ctx = {
    state,
    equipment,
    toast,
    pushHud,
    advanceStep,
    setStep,
    currentStep,
    currentExp,
    currentStation,
  };

  /** @type {Record<string, ReturnType<typeof stationModules[string]['createHandlers']>>} */
  const handlers = {};
  let pendingStart = null;

  function settlePendingStart(value) {
    const pending = pendingStart;
    pendingStart = null;
    pending?.resolve?.(!!value);
  }

  // External lifecycle owners can cancel the scheduler without going through
  // a UI path. Never leave a card awaiter pending in that case.
  function cancelPendingStart() {
    settlePendingStart(false);
  }

  function snapshotSession(expId = state.expId) {
    return {
      stationId: state.stationId,
      expId,
      stepIndex: state.stepIndex,
      running: state.running,
      menuOpen: state.menuOpen,
      data: state.data,
    };
  }

  function registerStationModule(id, mod, station = mod?.station) {
    if (!id || !mod) return false;
    // Test/embed callers may register only a handler module and use the
    // catalog already supplied to the manager. Normalize that legacy shape at
    // this boundary; production station modules always carry full metadata.
    const stationModule = defineStationExperimentModule({
      ...mod,
      station: station || mod.station || stationCatalog[id] || { id },
    });
    stationModules[id] = mod;
    if (station) stationCatalog[id] = station;
    handlers[id] = createExperimentHandlers(stationModule, ctx);
    return true;
  }

  // Preserve the old direct-manager test/embedding contract without making
  // the production manager import every station's experiment registry.
  if (usingFallbackCatalog && !stationModules.electro) {
    registerStationModule('electro', {
      station: stationCatalog.electro,
      createHandlers: (handlerContext) => ({
        initData: () => ({}),
        applyVisualDefaults: (expId) => {
          if (expId === 'hall_effect') handlerContext.equipment.electro?.setMode?.('hall');
        },
        cleanup() {},
      }),
    });
  }

  function activeHandlers() {
    return state.stationId ? handlers[state.stationId] : null;
  }

  /**
   * @param {string|null} stationId
   * @param {boolean} on
   * @param {{ paint?: boolean }} [opts] paint=false for close path (no sync canvas hitch)
   */
  function setSelectorActive(stationId, on, opts = {}) {
    const paint = opts.paint !== false;
    Object.values(equipment.holos || {}).forEach((h) => {
      if (!h?.userData) return;
      const nextActive = !!(on && h.userData.stationId === stationId);
      const wasActive = !!h.userData.active;
      h.userData.active = nextActive;
      // Only repaint selectors whose active flag flipped — opening one station
      // used to draw() every hologram (multi-canvas hitch on first menu open).
      if (paint && nextActive !== wasActive && typeof h.userData.draw === 'function') {
        h.userData.draw(nextActive);
      }
    });
  }

  function notifyGraphChanged(stationId) {
    if (!stationId || typeof onApparatusGraphChanged !== 'function') return;
    try { onApparatusGraphChanged(stationId, state.expId); } catch { /* ignore */ }
  }

  /** End experiment apparatus → idle table showcase (empty or prop, per station). */
  function shutdownStation(sid) {
    if (!sid) return;
    const eq = equipment[sid];
    try {
      if (typeof eq?.suspend === 'function') eq.suspend();
      else if (typeof eq?.shutdown === 'function') eq.shutdown();
      else if (typeof eq?.showcase === 'function') eq.showcase();
      else if (typeof eq?.setMode === 'function') {
        if (sid === 'mechanics') eq.setMode(null, null, { reset: false, snapshot: false });
        else eq.setMode(null);
      }
      // Menu may still be open after exit. Re-apply idle showcase without
      // marking a source experiment as active (thermo/optics clear the bench).
      eq?.showcase?.();
    } catch { /* best-effort */ }
  }

  function openStationMenu(stationId) {
    openTiming?.begin?.('station-menu', { stationId });
    const t0 = performance.now();
    state.stationId = stationId;
    state.menuOpen = true;
    state.running = false;
    state.expId = null;
    state.stepIndex = 0;
    state.data = {};
    // Hot this station only — freezes other benches out of the render/anim path.
    try {
      const tHot = performance.now();
      stationPresence?.setHotStation?.(stationId);
      openTiming?.mark?.('setHotStation', { dtMs: performance.now() - tHot });
    } catch { /* ignore */ }
    const tSel = performance.now();
    setSelectorActive(stationId, true, { paint: true });
    openTiming?.mark?.('selectorPaint', { dtMs: performance.now() - tSel });
    // Content display stays hidden until an experiment card is chosen.
    // Chem always-on holos (chemKind) stay present.
    Object.values(equipment.displays || {}).forEach((d) => {
      if (d?.userData?.chemKind === 'left' || d?.userData?.chemKind === 'right') return;
      if (d?.userData?.chemKind === 'periodic') {
        // periodic only when picker open — force hide on menu open
        d?.userData?.setPresent?.(false);
        return;
      }
      d?.userData?.setPresent?.(false);
    });
    toast(
      stationId === 'chem'
        ? `已打开 ${stationCatalog[stationId]?.title || ''} · 中央岛实验台`
        : `已打开 ${stationCatalog[stationId]?.title || ''} · 请选择实验`,
    );
    pushHud();
    openTiming?.mark?.('menuBookkeepingDone', { clickMs: performance.now() - t0 });
    openTiming?.end?.({ phase: 'menu' });
  }

  function closeMenu() {
    // Visibility/flags only on the call stack — no canvas, no apparatus work.
    settlePendingStart(false);
    state.menuOpen = false;
    setSelectorActive(null, false, { paint: false });
    Object.values(equipment.displays || {}).forEach((d) => {
      if (d?.userData) {
        d.userData.maximized = false;
        d.userData.boundHud = null;
        d.userData.boundDataHtml = '';
        d.userData._contentExpId = null;
      }
      d?.userData?.setPresent?.(false);
    });
    scheduler.cancel('exp:switch');
    scheduler.cancel('exp:visuals');
    scheduler.cancel('exp:visuals-hud');
    // HUD paint next pulse (not on the click frame).
    scheduler.schedule('exp:close-hud', () => pushHud(), { priority: 40 });
  }

  function startExperiment(expId, { immediate = false } = {}) {
    const t0 = performance.now();
    console.log(`[open-trace] manager.startExperiment begin exp=${expId}`);
    settlePendingStart(false);
    // Start camera-first rendering before station presence changes.  Any stale
    // progressive work belongs to the previous card selection and is cancelled.
    scheduler.beginSwitchSession?.();
    ['electro:', 'optics:', 'mech:', 'thermo:'].forEach((prefix) => {
      scheduler.cancelPrefix?.(prefix);
    });
    const st = currentStation();
    if (!st) return Promise.resolve(false);
    const exp = st.experiments.find((e) => e.id === expId);
    if (!exp) return Promise.resolve(false);
    const h = handlers[st.id];
    const prevExpId = state.running ? state.expId : null;
    const prevHandlers = prevExpId ? handlers[st.id] : null;
    const previousSession = prevExpId ? snapshotSession(prevExpId) : null;

    openTiming?.begin?.('experiment', {
      stationId: st.id,
      expId,
      prevExpId: prevExpId || null,
    });

    // Ensure this station is the sole hot apparatus before any visual work.
    try {
      const tHot = performance.now();
      stationPresence?.setHotStation?.(st.id);
      const hotDt = performance.now() - tHot;
      console.log(`[open-trace] setHotStation ${st.id} dt=${hotDt.toFixed(1)}ms`);
      openTiming?.mark?.('setHotStation', { dtMs: hotDt });
    } catch { /* ignore */ }

    // Bookkeeping only — keep this microtask tiny so the click frame can paint.
    state.expId = expId;
    state.stepIndex = 0;
    state.running = true;
    state.menuOpen = true;
    const tInit = performance.now();
    state.data = h?.initData(expId) || {};
    const initDt = performance.now() - tInit;
    console.log(`[open-trace] initData dt=${initDt.toFixed(1)}ms`);
    openTiming?.mark?.('initData', { dtMs: initDt });
    state.data._apparatusReady = false;
    const commitPromise = new Promise((resolve) => {
      pendingStart = { expId, resolve };
    });

    // Abort any in-flight switch chain from a previous card click.
    scheduler.cancel('exp:switch');
    scheduler.cancel('exp:cleanup');
    scheduler.cancel('exp:visuals');
    scheduler.cancel('exp:visuals-hud');
    scheduler.cancel('exp:toast');

    // Multi-frame switch: one step → rest frame (camera) → next step.
    // Never stack cleanup + setMode + dense HUD on consecutive busy frames.
    const steps = [];
    steps.push(() => {
      if (!state.running || state.expId !== expId) {
        if (pendingStart?.expId === expId) settlePendingStart(false);
        return;
      }
      openTiming?.mark?.('toastHud');
      toast(`开始实验：${exp.name}`);
      // Shell / warm-cache paint only — dense layout is a later chain step.
      pushHud();
    });
    if (prevExpId && prevHandlers?.cleanup) {
      const cleanupId = prevExpId;
      steps.push(() => {
        const tC = performance.now();
        try { prevHandlers.cleanup?.(cleanupId, previousSession); } catch { /* ignore */ }
        openTiming?.mark?.('cleanupPrev', { dtMs: performance.now() - tC, prevExpId: cleanupId });
      });
    }
    steps.push(() => {
      if (!state.running || state.expId !== expId) return;
      const tA = performance.now();
      console.log(`[open-trace] applyVisualDefaults begin exp=${expId}`);
      try { h?.applyVisualDefaults?.(expId); } catch { /* keep HUD up */ }
      const visDt = performance.now() - tA;
      console.log(`[open-trace] applyVisualDefaults end dt=${visDt.toFixed(1)}ms`);
      openTiming?.mark?.('applyVisualDefaults', { dtMs: visDt });
      notifyGraphChanged(st.id);
      try { onVisualReady?.({ stationId: st.id, expId }); } catch { /* optional GPU preparation */ }
      if (state.data) state.data._apparatusReady = true;
    });
    steps.push(() => {
      if (!state.running || state.expId !== expId) return;
      // Second HUD pass after apparatus is visible (readouts / live hits).
      const tH = performance.now();
      pushHud();
      console.log(`[open-trace] post-visuals pushHud dt=${(performance.now() - tH).toFixed(1)}ms`);
      openTiming?.mark?.('postVisualsHud', { dtMs: performance.now() - tH });
      // End the click→mount session here; progressive GPU/rays may continue.
      openTiming?.end?.({ phase: 'mounted' });
      if (pendingStart?.expId === expId) settlePendingStart(true);
    });

    if (immediate) {
      // The host uses this only after the selected runtime and first GPU draw
      // are ready behind its switch loader. Commit the O(1) state/HUD steps on
      // the same call stack so a long or delayed animation frame cannot leave
      // a visually loaded experiment waiting for the next scheduler pulse.
      steps.forEach((step) => {
        try { step(); } catch { /* keep the pending start contract alive */ }
      });
      scheduler.endSoftSwitch?.();
    } else if (typeof scheduler.scheduleChain === 'function') {
      // soft:false + restFrames:0 — open must not insert camera-only cooldowns.
      // Each step is O(1) mount / HUD schedule; no tree walks remain.
      scheduler.scheduleChain('exp:switch', steps, { priority: 70, restFrames: 0, soft: false });
    } else {
      // Fallback if a test injects a minimal scheduler.
      steps.forEach((fn, i) => {
        scheduler.schedule(`exp:switch:${i}`, fn, { priority: 70 - i });
      });
    }
    console.log(`[open-trace] manager.startExperiment scheduled +${(performance.now() - t0).toFixed(1)}ms`);
    openTiming?.mark?.('scheduled', { clickMs: performance.now() - t0 });
    return commitPromise;
  }

  function interact(target, t) {
    // Tabletop hologram terminal: power on the station + front content display.
    if (
      target?.userData?.type === 'holo'
      || target?.userData?.role === 'holo_selector'
    ) {
      const sid = target.userData.stationId;
      // Already showing this station's screen — leave open for UV button picks in main.js
      if (state.menuOpen && state.stationId === sid) {
        return true;
      }
      openStationMenu(sid);
      return true;
    }

    // Content display itself does not open the station; tabletop selector does.
    if (
      target?.userData?.type === 'holo_display'
      || target?.userData?.role === 'holo_display'
    ) {
      const sid = target.userData.stationId;
      if (state.menuOpen && state.stationId === sid) return true;
      toast('请先瞄准桌面全息终端激活内容屏');
      return true;
    }

    if (!state.running || !state.expId) {
      return false;
    }

    const step = currentStep();
    if (!step) return false;

    const h = activeHandlers();
    if (h?.interact(target, t, step)) return true;

    return false;
  }

  function mouseDragTotalX() {
    return Number(
      equipment?.electro?.mouseDrag?.movementX
      ?? equipment?.optics?.mouseDrag?.movementX
      ?? equipment?.mechanics?.mouseDrag?.movementX
      ?? equipment?.thermo?.mouseDrag?.movementX
      ?? 0,
    );
  }

  function resolveSliderPick(target, context = {}) {
    let pick = context.pick;
    if (isParamSliderAction(pick?.action)) return pick;
    if (context.raycaster && target?.userData?.pickFromRay) {
      const live = target.userData.pickFromRay(context.raycaster);
      if (isParamSliderAction(live?.action)) return live;
    }
    return null;
  }

  function dispatchSliderValue(pick, value, live = true) {
    if (!Number.isFinite(value)) return false;
    const slider = state.data?._uiSlider;
    // Pointer events and the render-loop can report the same absolute value in
    // one frame. Avoid routing that no-op through the experiment controller.
    if (
      slider
      && (!slider.action || slider.action === pick.action)
      && (!slider.key || slider.key === pick.key)
      && Number.isFinite(slider.lastValue)
      && Math.abs(Number(slider.lastValue) - Number(value)) <= 1e-4
    ) {
      return true;
    }
    let handled = false;
    if (pick.action === 'faraday-b-slider') {
      handled = !!uiAction('faraday-b-set', { value, live });
    } else if (pick.action === 'induced-e-slider') {
      handled = !!uiAction('induced-e-set', { key: pick.key, value, live });
    } else {
      // Generic param-slider → experiment setAction
      if (!pick.setAction) return false;
      handled = !!uiAction(pick.setAction, {
        key: pick.key,
        value,
        axis: pick.axis,
        target: pick.target,
        live,
      });
    }
    if (handled && slider) slider.lastValue = Number(value);
    return handled;
  }

  function armUiSlider(pick, value, hostTarget = null) {
    const min = Number(pick.min);
    const max = Number(pick.max);
    state.data._uiSlider = {
      action: pick.action,
      setAction: pick.setAction || null,
      key: pick.key || null,
      axis: pick.axis || null,
      target: pick.target || null,
      step: Number.isFinite(Number(pick.step)) && Number(pick.step) > 0 ? Number(pick.step) : null,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 1,
      base: Number.isFinite(value) ? value : null,
      // Station-specific begin handlers already apply the initial pick. Mark
      // it as dispatched so the first hold tick does not replay that no-op.
      lastValue: Number.isFinite(value) ? Number(value) : null,
      originX: mouseDragTotalX(),
      hostTarget: hostTarget || null,
    };
  }

  function applyUiSliderRelative(totalX) {
    const s = state.data._uiSlider;
    if (!s) return false;
    if (!Number.isFinite(s.base)) return false;
    const span = Number(s.max) - Number(s.min);
    let next = Math.max(
      s.min,
      Math.min(s.max, Number(s.base) + Number(totalX || 0) * span * 0.0028),
    );
    if (s.step) {
      next = Math.round((next - s.min) / s.step) * s.step + s.min;
      next = Math.max(s.min, Math.min(s.max, next));
      next = Math.round(next * 1e6) / 1e6;
    }
    return dispatchSliderValue({
      action: s.action,
      setAction: s.setAction,
      key: s.key,
      axis: s.axis,
      target: s.target,
      step: s.step,
      min: s.min,
      max: s.max,
    }, next, true);
  }

  function clearUiSlider() {
    if (!state.data?._uiSlider) return false;
    state.data._uiSlider = null;
    pushHud();
    return true;
  }

  function beginManipulation(target, context = {}) {
    if (!state.running || !state.expId) return false;
    const sliderPick = resolveSliderPick(target, context);
    // Faraday / induced keep station-specific measurement bookkeeping; still
    // arm the shared continuous-drag state so holdInteract can drive them.
    if (sliderPick) {
      const value = valueFromParamSliderPick(sliderPick);
      armUiSlider(sliderPick, value, target);
      if (sliderPick.action === 'param-slider') {
        if (Number.isFinite(value)) dispatchSliderValue(sliderPick, value, true);
        return true;
      }
      // Fall through so Faraday/induced beginManipulation can record / set key.
    }
    const h = activeHandlers();
    if (h?.beginManipulation) {
      const ok = h.beginManipulation(target, context) || false;
      if (ok && sliderPick && state.data._uiSlider && Number.isFinite(valueFromParamSliderPick(sliderPick))) {
        // Re-base after station handler absolute jump (e.g. induced-e).
        const v = valueFromParamSliderPick(sliderPick);
        if (Number.isFinite(v)) state.data._uiSlider.base = v;
      }
      return ok;
    }
    return interact(target, context.time ?? 0);
  }

  function updateManipulation(target, context = {}) {
    if (!state.running || !state.expId) return false;
    const s = state.data._uiSlider;
    if (s) {
      const activeHost = target || s.hostTarget;
      // Prefer absolute UV pick when the ray still hits the same control.
      if (context.raycaster && activeHost?.userData?.pickFromRay) {
        const live = activeHost.userData.pickFromRay(context.raycaster, s.key);
        if (isParamSliderAction(live?.action)
          && (!s.action || live.action === s.action)
          && (!s.key || live.key === s.key)
          && (!s.axis || live.axis === s.axis)
          && (Number.isFinite(live.px) || Number.isFinite(live.value))) {
          const value = valueFromParamSliderPick(live);
          if (Number.isFinite(value)) {
            if (s.base == null || Math.abs(value - s.base) > 1e-4) {
              dispatchSliderValue(live, value, true);
              s.base = value;
            }
            s.originX = Number.isFinite(context.totalX)
              ? Number(context.totalX)
              : mouseDragTotalX();
            return true;
          }
        }
      }
      const totalX = Number.isFinite(context.totalX)
        ? Number(context.totalX)
        : mouseDragTotalX();
      applyUiSliderRelative(totalX - Number(s.originX || 0));
      return true;
    }
    return activeHandlers()?.updateManipulation?.(target, context) || false;
  }

  function endManipulation(target, context = {}) {
    if (!state.running || !state.expId) return false;
    const hadSlider = !!state.data._uiSlider;
    // Station handler first (Faraday records induction, induced clears flags).
    const ok = activeHandlers()?.endManipulation?.(target, context) || false;
    if (hadSlider) {
      clearUiSlider();
      return true;
    }
    return ok;
  }

  function onKey(code, t) {
    if (!state.running) return false;
    return activeHandlers()?.onKey(code, t) || false;
  }

  function onWheel(delta, target, pick) {
    if (!state.running) return false;
    return activeHandlers()?.onWheel(delta, target, pick) || false;
  }

  function uiAction(action, payload) {
    if (!state.running) return false;
    return activeHandlers()?.onUiAction?.(action, payload) || false;
  }

  function holdInteract(holding, t, dt, target, raycaster = null) {
    if (!state.running) return;
    const s = state.data._uiSlider;
    if (s) {
      if (holding) {
        applyUiSliderRelative(mouseDragTotalX() - Number(s.originX || 0));
        return;
      }
      // Release continuous slider; station endManipulation may also run from
      // pointerup — clear here so a pure hold path (pointer-lock) finishes.
      activeHandlers()?.endManipulation?.(target, { time: t });
      clearUiSlider();
      return;
    }
    activeHandlers()?.holdInteract(holding, t, dt, target, raycaster);
  }

  function onFocus(target) {
    if (!state.running) return;
    activeHandlers()?.onFocus?.(target);
  }

  /**
   * When true, FrameCoordinator → SimDriver owns integration via fixedUpdate().
   * `update()` then only runs optional light sync (no world.step / particle integrate).
   */
  let simOwnedByDriver = false;

  function setSimOwnedByDriver(owned) {
    simOwnedByDriver = !!owned;
  }

  /**
   * Fixed-step simulation entry (SimDriver / FrameCoordinator).
   * Re-homes the legacy handler.update(t,dt) integrate path so workers can
   * later replace it without a second clock in animate().
   * @param {number} dt
   */
  function fixedUpdate(dt) {
    if (!state.running) return state.data;
    // Station animators (thermo particles) read state._dt for visual advance.
    state._dt = dt;
    const h = activeHandlers();
    if (!h) return state.data;
    if (typeof h.simulate === 'function') return h.simulate(dt);
    if (typeof h.update === 'function') return h.update(0, dt);
    return state.data;
  }

  /**
   * Visual / apply entry (optional per handler).
   * @param {number} alpha
   */
  function visualUpdate(alpha) {
    if (!state.running) return;
    activeHandlers()?.visualUpdate?.(alpha);
  }

  /**
   * Per-frame host path. When SimDriver owns sim, skips heavy integrate and
   * only runs handler.syncState if provided (HUD leftovers, input-tied paint).
   * @param {number} t
   * @param {number} dt
   * @param {{ simulate?: boolean }} [opts]
   */
  function update(t, dt, opts = {}) {
    if (!state.running) return state.data;
    // Wall-clock dt for station animators (thermo particles) and light sync.
    // These run in animate() *before* FrameCoordinator fixedUpdate, so they
    // cannot wait for fixed-step _dt — frame dt matches the pre-SimDriver path.
    if (dt != null) {
      state._frameDt = dt;
      if (simOwnedByDriver) state._dt = dt;
    }
    const h = activeHandlers();
    if (!h) return state.data;

    const wantSimulate = opts.simulate !== false && !simOwnedByDriver;
    if (!wantSimulate) {
      if (typeof h.syncState === 'function') return h.syncState(t, dt);
      return state.data;
    }
    if (typeof h.update === 'function') return h.update(t, dt);
    return state.data;
  }

  function exitExperiment() {
    const eid = state.expId;
    const sid = state.stationId;
    const h = activeHandlers();
    const session = eid ? snapshotSession(eid) : null;
    settlePendingStart(false);
    state.running = false;
    state.expId = null;
    state.stepIndex = 0;
    state.data = {};
    state.menuOpen = true;
    // Shutdown apparatus immediately; keep station hot for menu, not apparatus.
    shutdownStation(sid);
    // No toast/pushHud on the click stack — schedule so camera keeps frames.
    scheduler.cancel('exp:switch');
    scheduler.cancel('exp:cleanup');
    scheduler.cancel('exp:visuals');
    scheduler.cancel('exp:visuals-hud');
    scheduler.cancel('exp:toast');
    scheduler.cancel('exp:close-hud');
    [
      'optics:open-geo',
      'optics:open-diff',
      'optics:rays',
      'optics:fringe',
      'optics:ray-flush',
      'optics:diff-flush',
      'optics:dirty-geo',
      'optics:dirty-diff',
      'optics:demo-diff',
      'optics:freeze',
      'optics:unfreeze',
    ].forEach((id) => scheduler.cancel(id));
    scheduler.endSoftSwitch?.();
    if (typeof scheduler.scheduleChain === 'function') {
      const steps = [];
      if (h?.cleanup && eid) {
        steps.push(() => {
          try { h.cleanup?.(eid, session); } catch { /* ignore */ }
        });
      }
      steps.push(() => {
        toast('已退出当前实验');
        pushHud();
        scheduler.endSoftSwitch?.();
      });
      scheduler.scheduleChain('exp:exit', steps, { priority: 45, restFrames: 0, soft: false });
    } else {
      if (h?.cleanup && eid) {
        scheduler.schedule('exp:cleanup', () => {
          try { h.cleanup?.(eid, session); } catch { /* ignore */ }
        }, { priority: 45 });
      }
      scheduler.schedule('exp:close-hud', () => {
        toast('已退出当前实验');
        pushHud();
        scheduler.endSoftSwitch?.();
      }, { priority: 40 });
    }
  }

  /**
   * Close terminal / big screen (× button).
   * Click frame: stop sim + hide UI/apparatus visibility only.
   * Heavy freeze/cleanup/HUD: later pulses with camera rests.
   */
  function closeStationUi() {
    const sid = state.stationId;
    const eid = state.running ? state.expId : null;
    const h = eid && sid ? handlers[sid] : null;
    const session = eid ? snapshotSession(eid) : null;
    settlePendingStart(false);

    // 1) Stop simulation bookkeeping immediately (update() becomes no-op).
    state.running = false;
    state.expId = null;
    state.stepIndex = 0;
    state.data = {};
    state.menuOpen = false;

    // 2) Hide content panels — visibility only, no canvas paint.
    setSelectorActive(null, false, { paint: false });
    Object.values(equipment.displays || {}).forEach((d) => {
      if (!d?.userData) return;
      d.userData.maximized = false;
      d.userData.boundHud = null;
      d.userData.boundDataHtml = '';
      d.userData._contentExpId = null;
      // Cheap hide: flip flags/visibility without raycast rebinding thrash.
      d.userData.present = false;
      d.userData.active = false;
      d.visible = false;
      if (typeof d.userData.setPresent === 'function') {
        // Prefer full setPresent when cheap path already flipped; only if needed.
        try { d.userData.setPresent(false); } catch { /* ignore */ }
      }
    });
    Object.values(equipment.holos || {}).forEach((holo) => {
      if (holo?.userData) {
        holo.userData.maximized = false;
        holo.userData.active = false;
      }
    });

    // 3) Instantly shut down apparatus + cold-boot all stations (Active Runtime).
    //    Next WebGL frame must not pay for any dense bench.
    shutdownStation(sid);
    try {
      stationPresence?.setHotStation?.(null);
    } catch { /* ignore */ }

    // 4) Cancel in-flight work. Do NOT leave a long soft-switch session.
    scheduler.cancel('exp:switch');
    scheduler.cancel('exp:exit');
    scheduler.cancel('exp:shutdown');
    scheduler.cancel('exp:cleanup');
    scheduler.cancel('exp:visuals');
    scheduler.cancel('exp:visuals-hud');
    scheduler.cancel('exp:toast');
    scheduler.cancel('exp:close-hud');
    [
      'optics:open-geo',
      'optics:open-diff',
      'optics:rays',
      'optics:fringe',
      'optics:ray-flush',
      'optics:diff-flush',
      'optics:dirty-geo',
      'optics:dirty-diff',
      'optics:demo-diff',
      'optics:freeze',
      'optics:unfreeze',
    ].forEach((id) => scheduler.cancel(id));
    scheduler.endSoftSwitch?.();

    // 5) Residual cleanup + toast — low priority, no switch session.
    const steps = [];
    if (h?.cleanup && eid) {
      steps.push(() => {
        try { h.cleanup?.(eid, session); } catch { /* ignore */ }
      });
    }
    steps.push(() => {
      toast('已关闭实验终端');
      pushHud();
      scheduler.endSoftSwitch?.();
    });
    if (typeof scheduler.scheduleChain === 'function') {
      // No soft-switch: apparatus already detached; toast must not freeze the lab.
      scheduler.scheduleChain('exp:shutdown', steps, { priority: 20, restFrames: 0, soft: false });
    } else {
      steps.forEach((fn, i) => {
        scheduler.schedule(`exp:shutdown:${i}`, fn, { priority: 20 - i });
      });
    }
  }

  return {
    registerStationModule,
    state,
    openStationMenu,
    closeMenu,
    closeStationUi,
    cancelPendingStart,
    startExperiment,
    exitExperiment,
    interact,
    beginManipulation,
    updateManipulation,
    endManipulation,
    onKey,
    onWheel,
    uiAction,
    holdInteract,
    onFocus,
    update,
    fixedUpdate,
    visualUpdate,
    setSimOwnedByDriver,
    get simOwnedByDriver() { return simOwnedByDriver; },
    pushHud,
    requestHudPaint,
    currentExp,
    currentStation,
    currentStep,
  };
}
