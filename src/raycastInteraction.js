function isHierarchyVisible(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

/**
 * Prefer live apparatus (charge / probe / rod) over a content-screen control
 * on the same ray when the apparatus is closer.
 * Prevents “aiming a charge clicks the floating panel behind it”.
 *
 * Margin is tight: oversized grab spheres + a large behind-holo slack used to
 * make the probe steal aim from empty space / UI beside the ball.
 *
 * @param {{ hit?: { distance?: number }, target?: unknown } | null} apparatusPick
 * @param {{ hit?: { distance?: number }, target?: unknown } | null} holoControl
 * @param {number} [margin=0.04] meters — small float slack only
 */
export function apparatusBeatsHolo(apparatusPick, holoControl, margin = 0.04) {
  if (!apparatusPick?.target) return false;
  if (!holoControl?.target) return true;
  const appD = Number(apparatusPick.hit?.distance);
  const holoD = Number(holoControl.hit?.distance);
  if (!Number.isFinite(appD)) return false;
  if (!Number.isFinite(holoD)) return true;
  return appD <= holoD + margin;
}

function hasVisibleMaterial(object) {
  const materials = Array.isArray(object?.material)
    ? object.material
    : [object?.material];
  return materials.some((material) => (
    material
    && material.visible !== false
    && (!material.transparent || Number(material.opacity ?? 1) > 0.001)
  ));
}

/**
 * Resolve the object under a cursor from front to back.
 *
 * Visible scene geometry blocks targets behind it. Fully transparent geometry
 * is ignored unless it belongs to an interactive object, allowing intentional
 * invisible hit proxies to keep their generous grab areas.
 */
export function resolveFrontmostInteraction(hits, {
  resolveInteractive,
  withinInteractDist = () => true,
  priorityInteraction = null,
  preferInteractive = null,
  preferenceBand = 0.35,
} = {}) {
  // An explicitly hit UI control (for example a hologram button resolved from
  // its screen plane) behaves like a DOM/mouse target even when translucent
  // scene decoration or apparatus geometry is rendered in front of the plane.
  if (priorityInteraction?.target && priorityInteraction?.hit) {
    return priorityInteraction;
  }

  for (const hit of hits || []) {
    const object = hit?.object;
    if (!object || !isHierarchyVisible(object)) continue;

    const target = resolveInteractive?.(object) || null;
    if (!target && !hasVisibleMaterial(object)) continue;

    const result = {
      hit,
      target: target && withinInteractDist(target, hit.distance) ? target : null,
    };
    if (result.target && preferInteractive) {
      const nearHits = (hits || []).filter((candidate) => (
        Number(candidate?.distance) <= Number(hit.distance) + preferenceBand
      ));
      result.target = preferInteractive(nearHits) || result.target;
    }
    return result;
  }

  return { hit: null, target: null };
}
