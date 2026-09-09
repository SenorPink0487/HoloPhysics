/**
 * Active Station Runtime — at most one station is "hot" for animators/interaction.
 *
 * Cold stations stay visible with clear tabletops. Experiment apparatus is
 * mounted only after the learner selects an experiment.
 *
 * ROOT CAUSE of first-open hitch (fixed):
 *   Walking freeze/unfreeze of dense station trees on the click frame is multi-ms
 *   even when "chunked". Presence therefore NEVER freezes matrices.
 *   Idle cost is handled by each station detaching inactive experiment groups
 *   (O(1) parent remove/add) rather than O(n) freeze walks.
 */

/**
 * @param {{
 *   stationScenes: Record<string, { root?: object, equipment?: object }>,
 *   scene?: { add?: Function, remove?: Function } | null,
 *   onChange?: (hotId: string|null, prevId: string|null) => void,
 * }} opts
 */
export function createStationPresence(opts = {}) {
  const stationScenes = opts.stationScenes || {};
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

  /** @type {string|null} */
  let hotId = null;
  /** @type {Set<string>} */
  const known = new Set(Object.keys(stationScenes));
  /** sid → already cleared for idle (skip redundant teardown). */
  const idleFlags = new Map();

  function station(id) {
    return id ? stationScenes[id] : null;
  }

  function clearApparatus(st) {
    try {
      if (typeof st?.equipment?.suspend === 'function') st.equipment.suspend();
      else if (typeof st?.equipment?.shutdown === 'function') st.equipment.shutdown();
      else if (typeof st?.equipment?.setMode === 'function') st.equipment.setMode(null);
    } catch { /* ignore */ }
  }

  function setRootIdle(st, sid, { forceShowcase = false } = {}) {
    if (!st?.root) return;
    st.root.visible = true;
    if (!forceShowcase && sid && idleFlags.get(sid) === true) return;
    clearApparatus(st);
    if (sid) idleFlags.set(sid, true);
  }

  function setRootLive(st, sid) {
    if (!st?.root) return;
    st.root.visible = true;
    if (sid) idleFlags.set(sid, false);
    try { st.equipment?.resume?.(); } catch { /* ignore */ }
  }

  /**
   * Make exactly one station hot (animators + full interactables), or none.
   * Non-hot stations remain visible with clear tabletops.
   * @param {string|null|undefined} id
   * @returns {string|null} new hot id
   */
  function setHotStation(id) {
    const next = id && known.has(id) ? id : null;
    if (next === hotId) {
      if (next) setRootLive(station(next), next);
      return hotId;
    }
    const prev = hotId;

    if (prev) {
      const prevSt = station(prev);
      try {
        if (typeof prevSt?.equipment?.suspend === 'function') prevSt.equipment.suspend();
        else if (typeof prevSt?.equipment?.shutdown === 'function') prevSt.equipment.shutdown();
      } catch { /* ignore */ }
      idleFlags.set(prev, false);
      setRootIdle(prevSt, prev, { forceShowcase: true });
    }

    // Other benches: leave alone if already clear (no teardown thrash).
    for (const sid of known) {
      if (sid === next || sid === prev) continue;
      setRootIdle(station(sid), sid);
    }

    hotId = next;
    if (next) setRootLive(station(next), next);

    try {
      onChange?.(hotId, prev);
    } catch { /* ignore */ }
    return hotId;
  }

  function getHotStation() {
    return hotId;
  }

  function isHot(id) {
    return !!id && id === hotId;
  }

  /** After boot: every station is visible with no apparatus, none hot. */
  function coldBootAll() {
    hotId = null;
    idleFlags.clear();
    for (const sid of known) {
      setRootIdle(station(sid), sid, { forceShowcase: true });
    }
    try {
      onChange?.(null, null);
    } catch { /* ignore */ }
  }

  function registerStation(id, sceneEntry) {
    if (!id || !sceneEntry) return;
    stationScenes[id] = sceneEntry;
    known.add(id);
    if (id !== hotId) setRootIdle(sceneEntry, id, { forceShowcase: true });
  }

  return {
    setHotStation,
    getHotStation,
    isHot,
    coldBootAll,
    registerStation,
    get knownStations() {
      return [...known];
    },
  };
}
