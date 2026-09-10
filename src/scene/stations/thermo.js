export function createStationEquipment(ctx) {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.name = 'thermo-station';

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
    updateState: () => {},
    getPourState: () => ({ active: false }),
    sourceExperiments: {},
  };

  return { root, equipment, animators: [], refs: {} };
}
