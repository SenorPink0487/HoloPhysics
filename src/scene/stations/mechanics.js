export function createStationEquipment(ctx) {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.name = 'mechanics-station';

  const equipment = {
    setMode: () => null,
    createRuntime: () => null,
    prepareExperiment: () => null,
    showcase: () => true,
    shutdown: () => {},
    suspend: () => {},
    resume: () => {},
    reset: () => {},
    setParam: () => {},
    setPaused: () => {},
    action: () => false,
    updateSource: () => {},
    snapshot: () => null,
    beginBallDrag: () => false,
    updateBallDrag: () => false,
    endBallDrag: () => false,
    activeId: null,
    sourceRuntimes: {},
  };

  return { root, equipment, animators: [], refs: {} };
}
