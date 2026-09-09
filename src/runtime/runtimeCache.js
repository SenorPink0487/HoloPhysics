/**
 * Bounded MRU cache for prepared runtimes. JS modules remain in the browser's
 * module cache; runtime resources are explicitly disposed on eviction.
 */
export function createRuntimeCache({ budgetBytes = 192 * 1024 * 1024, maxWarm = 2 } = {}) {
  const entries = new Map();
  let activeKey = null;

  function sizeOf(runtime) {
    const estimate = runtime?.estimateBytes?.() || {};
    return {
      cpu: Math.max(0, Number(estimate.cpu) || 0),
      gpu: Math.max(0, Number(estimate.gpu) || 0),
    };
  }

  function totalBytes() {
    let total = 0;
    for (const entry of entries.values()) total += entry.bytes.cpu + entry.bytes.gpu;
    return total;
  }

  function disposeEntry(key) {
    const entry = entries.get(key);
    if (!entry || key === activeKey) return false;
    entries.delete(key);
    try { entry.runtime.suspend?.(); } catch { /* best effort */ }
    try { entry.runtime.unmount?.(); } catch { /* best effort */ }
    try { entry.runtime.dispose?.(); } catch { /* best effort */ }
    return true;
  }

  function trim() {
    while (entries.size > maxWarm + (activeKey ? 1 : 0) || totalBytes() > budgetBytes) {
      const candidate = [...entries.keys()].find((key) => key !== activeKey);
      if (candidate == null || !disposeEntry(candidate)) break;
    }
  }

  function activate(key, runtime) {
    if (!runtime) return;
    const existing = entries.get(key);
    if (existing) existing.runtime = runtime;
    else entries.set(key, { runtime, bytes: sizeOf(runtime), lastUsed: performance.now() });
    activeKey = key;
    const entry = entries.get(key);
    entry.lastUsed = performance.now();
    entries.delete(key);
    entries.set(key, entry);
    for (const [otherKey, other] of entries) {
      if (otherKey !== key) other.runtime.suspend?.();
    }
    trim();
  }

  function warm(key, runtime) {
    if (!runtime || key === activeKey) return;
    const entry = entries.get(key) || { runtime, bytes: sizeOf(runtime), lastUsed: 0 };
    entry.runtime = runtime;
    entry.bytes = sizeOf(runtime);
    entry.lastUsed = performance.now();
    entries.delete(key);
    entries.set(key, entry);
    runtime.suspend?.();
    trim();
  }

  function remove(key) {
    if (key === activeKey) activeKey = null;
    return disposeEntry(key);
  }

  function clear() {
    // Release the active entry too. Clearing is used by context-loss and app
    // shutdown paths, so the active-key guard must not keep it alive forever.
    activeKey = null;
    for (const key of [...entries.keys()]) disposeEntry(key);
  }

  return {
    activate,
    warm,
    get: (key) => entries.get(key)?.runtime || null,
    has: (key) => entries.has(key),
    remove,
    clear,
    keys: () => [...entries.keys()],
    stats: () => ({ activeKey, count: entries.size, bytes: totalBytes(), budgetBytes }),
  };
}

/**
 * Bounded warm set: one active + at most two warm runtimes.
 * Byte budget scales with deviceMemory; warm count does not.
 */
export function runtimeCacheBudget(deviceMemory = globalThis.navigator?.deviceMemory) {
  if (Number(deviceMemory) <= 4) return { maxWarm: 1, budgetBytes: 96 * 1024 * 1024 };
  if (Number(deviceMemory) >= 8) return { maxWarm: 2, budgetBytes: 256 * 1024 * 1024 };
  return { maxWarm: 2, budgetBytes: 192 * 1024 * 1024 };
}
