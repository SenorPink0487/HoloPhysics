/**
 * Explicit contract for Three.js objects that participate in lab interaction.
 *
 * Three's `Object3D.userData` remains the storage mechanism, but consumers no
 * longer need to know every historical `type` / `role` combination. New
 * apparatus should declare a contract with `defineInteractionTarget`.
 */
export const INTERACTION_KIND = Object.freeze({
  APPARATUS: 'apparatus',
  HOLO_SELECTOR: 'holo-selector',
  HOLO_DISPLAY: 'holo-display',
  DESK_PANEL: 'desk-panel',
  FORMULA_BOARD: 'formula-board',
  SIDE_BLACKBOARD: 'side-blackboard',
});

const LEGACY_KIND = Object.freeze({
  holo: INTERACTION_KIND.HOLO_SELECTOR,
  holo_selector: INTERACTION_KIND.HOLO_SELECTOR,
  holo_display: INTERACTION_KIND.HOLO_DISPLAY,
  desk_param_panel: INTERACTION_KIND.DESK_PANEL,
  formula_board: INTERACTION_KIND.FORMULA_BOARD,
  side_blackboard: INTERACTION_KIND.SIDE_BLACKBOARD,
});

/**
 * Attach the stable, minimal interaction descriptor to an Object3D host.
 * Keep legacy fields in sync while migration is incomplete.
 */
export function defineInteractionTarget(object, descriptor = {}) {
  if (!object) return object;
  const data = object.userData || (object.userData = {});
  const kind = descriptor.kind || data.interactionKind || LEGACY_KIND[data.role] || LEGACY_KIND[data.type]
    || INTERACTION_KIND.APPARATUS;
  data.interactionKind = kind;
  data.interactive = descriptor.interactive ?? data.interactive ?? true;
  if (descriptor.stationId != null) data.stationId = descriptor.stationId;
  if (descriptor.maxDistance != null) data.maxInteractDist = descriptor.maxDistance;
  if (descriptor.role != null) data.role = descriptor.role;
  return object;
}

export function interactionKind(object) {
  const data = object?.userData;
  if (!data || data.interactive !== true) return null;
  return data.interactionKind || LEGACY_KIND[data.role] || LEGACY_KIND[data.type]
    || (data.interactive ? INTERACTION_KIND.APPARATUS : null);
}

export function isInteractionTarget(object) {
  return !!interactionKind(object);
}

/** Find the owning interactive host from a mesh/line child hit by a raycast. */
export function findInteractionHost(object, predicate = isInteractionTarget) {
  let current = object;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

export function isInteractionKind(object, ...kinds) {
  return kinds.includes(interactionKind(object));
}

export function hasInteractionMethod(object, method) {
  return typeof object?.userData?.[method] === 'function';
}
