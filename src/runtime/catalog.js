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
  mechanics: station('mechanics', '力学实验台', [
    { id: 'free-fall', name: '自由落体', goal: '比较不同质量小球的下落时间，验证真空中加速度与质量无关' },
    { id: 'inclined-plane', name: '斜面运动', goal: '调节倾角与摩擦因数，观察下滑加速度和临界角' },
    { id: 'pendulum', name: '单摆实验', goal: '观察非线性阻尼单摆并比较小角周期与大角修正' },
    { id: 'collision', name: '碰撞与动能', goal: '在气垫导轨上检验一维碰撞的动量守恒、动能变化和恢复系数' },
    { id: 'projectile', name: '抛体运动', goal: '观察理论轨迹、频闪采样与速度分量，比较射高、射程和飞行时间' },
    { id: 'viscosity', name: '落球法测粘滞系数', goal: '用光电门测量钢球终端速度，并用 Stokes 定律与管壁修正求 η' },
  ]),
  thermo: station('thermo', '热学实验台', [
    { id: 'calorimetry', name: '混合量热', goal: '拖动热、冷水烧杯到量热杯，观察混合平衡温度' },
    { id: 'convection', name: '自然对流', goal: '改变热板温度，观察封闭腔体内的浮力驱动流动' },
    { id: 'heat-conduction', name: '热传导', goal: '比较导热系数对温度场和热流密度的影响' },
    { id: 'ideal-gas', name: '理想气体定律', goal: '移动活塞并调节温度，验证 PV = nRT' },
    { id: 'thermal-expansion', name: '固体热膨胀', goal: '加热金属棒并比较不同材料的线膨胀系数' },
  ]),
  optics: station('optics', '光学实验台', [
    { id: 'reflection', name: '光的反射', goal: '完成 1.1–1.4：现象观察、定律验证、多光束/凸面镜、镜面倾角' },
    { id: 'refraction', name: '光的折射', goal: '完成 2.1–2.4：现象观察、斯涅尔定律、全反射、平板侧移' },
    { id: 'dispersion', name: '光的色散', goal: '观察三棱镜白光色散，理解 n(λ) 与红→紫展宽' },
    { id: 'lens', name: '透镜光路', goal: '用近平行多束光观察球透镜/柱面透镜会聚' },
    { id: 'multi_slit_diffraction', name: '单缝衍射 · 多缝干涉', goal: '调节波长、缝宽、缝距、缝数和屏距，用对照表与标注曲线归纳条纹规律' },
  ]),
  electro: station('electro', '电磁学实验台', [
    { id: 'electric_field', name: '静电场探索', goal: '拖动正负点电荷与试探电荷，观察叠加电场、受力与电势的空间分布' },
    { id: 'faraday_induction', name: '法拉第电磁感应', goal: '设定 B 或铜棒位置 x 的目标值与变化时长，播放动态过程，观察磁通量变化、感应电动势与楞次定律方向。' },
    { id: 'induced_electric_field', name: '感生电场', goal: '手动调节 B 与 dB/dt，观察涡旋感生电场：面内 E∝r，面外 E∝1/r，方向由楞次定律判定。' },
    { id: 'hall_carrier_demo', name: '霍尔效应原理', goal: '观察电流、磁场、载流子浓度、样品厚度与载流子类型如何共同改变载流子的三维运动和霍尔电压极性。' },
    { id: 'hall_effect', name: '霍尔效应测磁', goal: '调节励磁与霍尔电流，扫描探头位置并比较亥姆霍兹线圈和长螺线管的磁场分布' },
  ]),
  chem: station('chem', '化学实验台', [
    { id: 'reagent-mix', name: '试剂混合与结构', goal: '选元素→选试剂→装入烧杯→倾倒混合→查看成分 3D 结构' },
  ]),
});

/**
 * Physics corner stations only (chem is opt-in via labMode).
 * Keep electromagnetism first because it is the primary station to warm during
 * the physics-lab boot sequence; preserve the catalog order for the others.
 */
export const PHYSICS_STATION_IDS = Object.freeze([
  'electro',
  ...Object.keys(LAB_CATALOG).filter((id) => id !== 'chem' && id !== 'electro'),
]);

/** All known station ids including chem. */
export const STATION_IDS = Object.freeze(Object.keys(LAB_CATALOG));

/** Active boot list depends on lab mode — chem mode only boots chem. */
export function stationIdsForMode(labMode = 'physics') {
  if (labMode === 'chem') return Object.freeze(['chem']);
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
