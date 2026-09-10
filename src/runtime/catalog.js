/**
 * Pure experiment metadata. Keep this module free of Three.js, physics and
 * browser APIs so it can be used by bootstrap menus and preload prediction.
 */

const station = (id, title, experiments) => Object.freeze({
  id,
  title,
  experiments: Object.freeze(experiments.map((item) => Object.freeze(item))),
});

export const LAB_CATALOG = Object.freeze({
  mechanics: station('mechanics', '力学实验台', []),
  thermo: station('thermo', '热学实验台', []),
  optics: station('optics', '光学实验台', []),
  electro: station('electro', '电磁学实验台', [
    { id: 'electric_field', name: '静电场探索', goal: '拖动正负点电荷与试探电荷，观察叠加电场、受力与电势的空间分布' },
    { id: 'faraday_induction', name: '法拉第电磁感应', goal: '设定 B 或铜棒位置 x 的目标值与变化时长，播放动态过程，观察磁通量变化、感应电动势与楞次定律方向。' },
    { id: 'induced_electric_field', name: '感生电场', goal: '手动调节 B 与 dB/dt，观察涡旋感生电场：面内 E∝r，面外 E∝1/r，方向由楞次定律判定。' },
    { id: 'hall_carrier_demo', name: '霍尔效应原理', goal: '观察电流、磁场、载流子浓度、样品厚度与载流子类型如何共同改变载流子的三维运动和霍尔电压极性。' },
    { id: 'hall_effect', name: '霍尔效应测磁', goal: '调节励磁与霍尔电流，扫描探头位置并比较亥姆霍兹线圈和长螺线管的磁场分布' },
  ]),
});

/**
 * Physics corner stations.
 * Keep electromagnetism first because it is the primary station to warm during
 * the physics-lab boot sequence; preserve the catalog order for the others.
 */
export const PHYSICS_STATION_IDS = Object.freeze([
  'electro',
  ...Object.keys(LAB_CATALOG).filter((id) => id !== 'electro'),
]);

/** All known station ids. */
export const STATION_IDS = PHYSICS_STATION_IDS;

/** Active boot list. */
export function stationIdsForMode(_labMode = 'physics') {
  return PHYSICS_STATION_IDS;
}

// The bootstrap uses this mutable view. It starts with names only and is
// enriched with the full station module after intent prediction confirms use.
export const STATION_EXPERIMENTS = Object.fromEntries(
  Object.entries(LAB_CATALOG).map(([id, entry]) => [id, entry]),
);

export function registerStationCatalog(stationEntry) {
  if (!stationEntry?.id) return null;
  STATION_EXPERIMENTS[stationEntry.id] = stationEntry;
  return stationEntry;
}

export function findExperiment(expId) {
  for (const [stationId, entry] of Object.entries(STATION_EXPERIMENTS)) {
    const experiment = entry.experiments.find((item) => item.id === expId);
    if (experiment) return { stationId, experiment };
  }
  return null;
}
