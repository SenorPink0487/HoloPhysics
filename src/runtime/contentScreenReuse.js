/**
 * Lifetime policy for experiment content screens.
 *
 * A category owns one screen surface for its whole lab session. Switching an
 * experiment only changes the content binding; the Three.js group, canvas and
 * texture remain alive and can be shown again without rebuilding them.
 */
export function createContentScreenRegistry() {
  const entries = new Map();

  function register(categoryId, screen) {
    if (!categoryId || !screen) return screen;
    const existing = entries.get(categoryId);
    if (existing) {
      if (existing.screen !== screen) {
        throw new Error(`Content screen already registered for category: ${categoryId}`);
      }
      return existing.screen;
    }
    entries.set(categoryId, {
      categoryId,
      screen,
      activeExperimentId: null,
      bindCount: 0,
      reuseCount: 0,
    });
    return screen;
  }

  function bind(categoryId, experimentId) {
    const entry = entries.get(categoryId);
    if (!entry) return { screen: null, changed: false, reused: false };

    const nextId = experimentId || null;
    const changed = entry.activeExperimentId !== nextId;
    const reused = entry.bindCount > 0 && changed;
    if (reused) entry.reuseCount += 1;
    entry.bindCount += 1;
    entry.activeExperimentId = nextId;

    return {
      screen: entry.screen,
      changed,
      reused,
      bindCount: entry.bindCount,
      reuseCount: entry.reuseCount,
    };
  }

  function release(categoryId) {
    const entry = entries.get(categoryId);
    if (!entry) return false;
    // Release the content binding only. The screen surface is intentionally
    // retained for the next experiment in this category.
    entry.activeExperimentId = null;
    return true;
  }

  function get(categoryId) {
    return entries.get(categoryId)?.screen || null;
  }

  function snapshot(categoryId) {
    const entry = entries.get(categoryId);
    if (!entry) return null;
    return {
      categoryId: entry.categoryId,
      activeExperimentId: entry.activeExperimentId,
      bindCount: entry.bindCount,
      reuseCount: entry.reuseCount,
      screen: entry.screen,
    };
  }

  return {
    register,
    bind,
    release,
    get,
    snapshot,
  };
}
