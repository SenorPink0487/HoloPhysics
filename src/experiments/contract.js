/**
 * Contract between the experiment manager and a station handler module.
 *
 * Handlers stay plain objects for low-overhead hot paths, but this boundary
 * normalizes optional hooks and rejects malformed modules at registration
 * time instead of during a user interaction.
 */
export const EXPERIMENT_HANDLER_HOOKS = Object.freeze([
  'initData', 'applyVisualDefaults', 'cleanup', 'interact',
  'beginManipulation', 'updateManipulation', 'endManipulation', 'holdInteract',
  'onKey', 'onWheel', 'onUiAction', 'onFocus', 'simulate', 'update',
  'syncState', 'visualUpdate',
]);

export function defineStationExperimentModule(module) {
  if (!module?.station?.id) throw new TypeError('Station experiment module requires station.id');
  if (typeof module.createHandlers !== 'function') {
    throw new TypeError(`Station ${module.station.id} requires createHandlers(context)`);
  }
  return module;
}

export function createExperimentHandlers(module, context) {
  const stationModule = defineStationExperimentModule(module);
  const handlers = stationModule.createHandlers(context);
  if (!handlers || typeof handlers !== 'object') {
    throw new TypeError(`Station ${stationModule.station.id} createHandlers must return an object`);
  }
  for (const hook of EXPERIMENT_HANDLER_HOOKS) {
    if (handlers[hook] != null && typeof handlers[hook] !== 'function') {
      throw new TypeError(`Station ${stationModule.station.id} handler.${hook} must be a function`);
    }
  }
  return handlers;
}
