const DEFAULT_FIXED_DT = 1 / 60;

/** Single simulation/render/predictive-work scheduler for the lab. */
export function createFrameCoordinator({
  fixedDt = DEFAULT_FIXED_DT,
  maxCatchUp = 2,
  now = () => performance.now(),
  onFixedUpdate = () => {},
  onVisualUpdate = () => {},
  onInput = () => {},
  onRaycast = () => {},
  onRender = () => {},
} = {}) {
  const tasks = [];
  let accumulator = 0;
  let last = null;
  let dirty = true;
  let renderMs = 0;

  function enqueue(task) {
    if (!task || typeof task.step !== 'function') throw new TypeError('task.step is required');
    tasks.push(task);
    return () => { task.cancelled = true; };
  }

  function drain(deadline, signal) {
    const limit = Math.min(2, Math.max(0, deadline - now()));
    const end = now() + limit;
    while (tasks.length && now() < end) {
      const task = tasks[0];
      if (task.cancelled || signal?.aborted) { tasks.shift(); continue; }
      const stepStart = now();
      const done = task.step(end, signal);
      const elapsed = now() - stepStart;
      if (elapsed > 4) console.warn(`[FrameCoordinator] task ${task.id || 'anonymous'} exceeded 4ms`, elapsed);
      if (done !== false) tasks.shift();
      else if (now() >= end) break;
    }
  }

  function frame(timestamp = now(), { render = true } = {}) {
    if (last == null) last = timestamp;
    const elapsed = Math.min(0.1, Math.max(0, (timestamp - last) / 1000));
    last = timestamp;
    accumulator += elapsed;
    onInput(timestamp);
    const frameStart = now();
    const targetFrameMs = fixedDt * 1000;
    let steps = 0;
    while (accumulator >= fixedDt - 1e-4 && steps < maxCatchUp) {
      if (steps > 0) {
        // Prevent accumulator spiral of death: if a previous simulation step
        // plus recent render time already approaches or exceeds the frame budget,
        // stop catch-up immediately so the browser can return to full refresh rate (60 FPS).
        const spent = now() - frameStart;
        const estRender = renderMs > 0 ? renderMs : 4;
        if (spent + estRender > targetFrameMs - 2) {
          break;
        }
      }
      onFixedUpdate(fixedDt);
      accumulator -= fixedDt;
      steps += 1;
      dirty = true;
    }
    // Prevent accumulator buildup: discard unsimulated excess beyond fixedDt
    // to avoid trapping subsequent frames into permanent catch-up mode.
    // Preserve fractional remainder for interpolation.
    if (accumulator >= fixedDt) {
      accumulator %= fixedDt;
    }
    if (accumulator < 0) {
      accumulator = 0;
    }
    if (dirty) {
      onVisualUpdate(accumulator / fixedDt);
      dirty = false;
    }
    const renderStart = now();
    if (render) {
      onRaycast(timestamp);
      onRender(timestamp);
      renderMs = now() - renderStart;
    } else {
      renderMs = 0;
    }
    // Skip background drain when the present already exceeded one frame budget.
    // Budget is measured from post-render now — not from the frame timestamp —
    // so a 4 ms present still leaves a fresh 2 ms window for one background task.
    if (renderMs <= 16.7) drain(now() + 2);
    return { elapsed, steps, renderMs, pending: tasks.length };
  }

  function reset() {
    accumulator = 0;
    last = null;
    dirty = true;
    tasks.length = 0;
  }

  return {
    frame,
    enqueue,
    invalidate() { dirty = true; },
    cancelAll() { tasks.length = 0; },
    reset,
    get pending() { return tasks.length; },
    get lastRenderMs() { return renderMs; },
    get accumulator() { return accumulator; },
  };
}
