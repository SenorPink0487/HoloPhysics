/** Idempotent ownership scope for browser, Three.js and worker resources. */
export function createResourceScope(label = 'scope') {
  const disposers = new Set();
  let disposed = false;

  function own(resource, dispose = inferDispose) {
    if (disposed) {
      dispose(resource);
      return resource;
    }
    if (resource != null) disposers.add(() => dispose(resource));
    return resource;
  }

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    return own(() => target?.removeEventListener?.(type, handler, options), (fn) => fn());
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    const pending = [...disposers];
    disposers.clear();
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      try { pending[i](); } catch (error) { console.warn(`[${label}] dispose failed`, error); }
    }
    return true;
  }

  return {
    label,
    own,
    listen,
    add(disposer) { return own(disposer, (fn) => fn()); },
    dispose,
    get disposed() { return disposed; },
    get size() { return disposers.size; },
  };
}

function inferDispose(resource) {
  if (typeof resource === 'function') return resource();
  if (resource?.close) return resource.close();
  if (resource?.terminate) return resource.terminate();
  if (resource?.dispose) return resource.dispose();
  if (resource?.parent?.remove) resource.parent.remove(resource);
  return undefined;
}

export function createSharedResourcePool() {
  const entries = new Map();

  function acquire(key, factory, dispose = inferDispose) {
    let entry = entries.get(key);
    if (!entry) {
      entry = { value: factory(), refs: 0, dispose };
      entries.set(key, entry);
    }
    entry.refs += 1;
    let released = false;
    return {
      value: entry.value,
      release() {
        if (released) return false;
        released = true;
        entry.refs -= 1;
        if (entry.refs <= 0) {
          try { entry.dispose(entry.value); } finally { entries.delete(key); }
        }
        return true;
      },
    };
  }

  function dispose() {
    for (const entry of entries.values()) {
      try { entry.dispose(entry.value); } catch { /* best effort */ }
    }
    entries.clear();
  }

  return { acquire, dispose, has: (key) => entries.has(key), get size() { return entries.size; } };
}
