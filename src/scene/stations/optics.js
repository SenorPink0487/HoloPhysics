export function createStationEquipment(ctx) {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.name = 'optics-station';

  const equipment = {
    setMode: () => null,
    createRuntime: () => null,
    prepareExperiment: () => null,
    showcase: () => true,
    shutdown: () => {},
    suspend: () => {},
    resume: () => {},
    reset: () => {},
    action: () => false,
    updateRayProgress: () => false,
    geoGpuReady: true,
  };

  return { root, equipment, animators: [], refs: {} };
}
