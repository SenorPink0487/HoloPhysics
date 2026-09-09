/**
 * Geometric optics experiment catalog — ported from guangxue-source.
 *
 * Host menu shows one card per category experiment:
 *   光的反射 (1.1–1.4 as internal modules)
 *   光的折射 (2.1–2.4 as internal modules)
 *   光的色散 / 透镜光路
 * Steps use host-style { id, text, hint }.
 */

export const SHAPE_LABELS = Object.freeze({
  prism: '等边三棱镜',
  block: '平板玻璃砖',
  sphere: '玻璃球透镜',
  cylinder: '柱面透镜',
  mirror: '平面镜',
  'mirror-convex': '凸面镜',
});

export const MEDIUM_PRESETS = Object.freeze([
  { label: '水', ior: 1.33 },
  { label: '玻璃', ior: 1.52 },
  { label: '火石', ior: 1.66 },
  { label: '钻石', ior: 2.42 },
]);

/** Internal modules of 「光的反射」— source 1.1–1.4 */
export const REFLECTION_MODULES = Object.freeze([
  {
    id: 'observe',
    code: '1.1',
    title: '反射现象观察',
    shortNote: '反射现象',
    config: {
      shape: 'mirror', angle: 35, rayCount: 1, rotate: 0,
      dispersion: false, showReflect: true, mode: 'mirror', ior: 1.52,
    },
  },
  {
    id: 'law',
    code: '1.2',
    title: '反射定律验证',
    shortNote: '反射定律',
    config: {
      shape: 'mirror', angle: 40, rayCount: 1, rotate: 0,
      dispersion: false, showReflect: true, mode: 'mirror', ior: 1.52,
    },
  },
  {
    id: 'multi',
    code: '1.3',
    title: '多光束与凸面镜',
    shortNote: '多光束反射',
    config: {
      shape: 'mirror', angle: 28, rayCount: 7, rotate: 0,
      dispersion: false, showReflect: true, mode: 'mirror', ior: 1.52,
    },
  },
  {
    id: 'tilt',
    code: '1.4',
    title: '镜面倾角与光路',
    shortNote: '镜面倾角',
    config: {
      shape: 'mirror', angle: 32, rayCount: 1, rotate: 20,
      dispersion: false, showReflect: true, mode: 'mirror', ior: 1.52,
    },
  },
]);

/** Internal modules of 「光的折射」— source 2.1–2.4 */
export const REFRACTION_MODULES = Object.freeze([
  {
    id: 'observe',
    code: '2.1',
    title: '折射现象观察',
    shortNote: '折射现象',
    config: {
      shape: 'block', angle: 42, rayCount: 1, rotate: 0,
      dispersion: false, showReflect: true, mode: 'dielectric', ior: 1.52,
    },
  },
  {
    id: 'snell',
    code: '2.2',
    title: '折射定律验证',
    shortNote: '折射定律',
    config: {
      shape: 'prism', angle: 40, rayCount: 3, rotate: 0,
      dispersion: false, showReflect: true, mode: 'dielectric', ior: 1.52,
    },
  },
  {
    id: 'tir',
    code: '2.3',
    title: '全反射与临界角',
    shortNote: '全反射',
    config: {
      shape: 'prism', angle: 55, rayCount: 2, rotate: 15,
      dispersion: false, showReflect: true, mode: 'dielectric', ior: 1.66,
    },
  },
  {
    id: 'shift',
    code: '2.4',
    title: '平板玻璃侧移',
    shortNote: '平板侧移',
    config: {
      shape: 'block', angle: 35, rayCount: 4, rotate: 0,
      dispersion: false, showReflect: false, mode: 'dielectric', ior: 1.52,
    },
  },
]);

/** Experiment ids that use the geometric optics rig. */
export const GEOMETRIC_EXP_IDS = Object.freeze([
  'reflection',
  'refraction',
  'dispersion',
  'lens',
]);

export function isGeometricOpticsExp(expId) {
  return GEOMETRIC_EXP_IDS.includes(expId);
}

/** Reflection category experiment (readouts use θᵢ / θᵣ). */
export function isReflectionExp(expId) {
  return expId === 'reflection';
}

export function getModulesForExperiment(expId) {
  if (expId === 'reflection') return REFLECTION_MODULES;
  if (expId === 'refraction') return REFRACTION_MODULES;
  return null;
}

export function getModule(expId, moduleId) {
  const list = getModulesForExperiment(expId);
  if (!list) return null;
  return list.find((m) => m.id === moduleId) || list[0];
}

/**
 * Host station experiment list — one card per source category experiment.
 * Reflection 1.1–1.4 and refraction 2.1–2.4 are internal modules, not separate cards.
 */
export const GEOMETRIC_EXPERIMENTS = [
  {
    id: 'reflection',
    name: '光的反射',
    goal: '完成 1.1–1.4：现象观察、定律验证、多光束/凸面镜、镜面倾角',
    theory: '反射定律：i = i′；平面镜转 α，反射光线转 2α',
    steps: [
      {
        id: 'mod_observe',
        text: '1.1 反射现象观察：平面镜入射/反射与法线',
        hint: '全息屏可切换课题；调节入射角，观察反射光线',
      },
      {
        id: 'mod_law',
        text: '1.2 反射定律验证：记录多组 θᵢ、θᵣ',
        hint: '切换到 1.2，多次「记录本组」比较 |Δθ|',
      },
      {
        id: 'mod_multi',
        text: '1.3 多光束与凸面镜：对比平行与发散',
        hint: '切换到 1.3，可换凸面镜、增加光束数',
      },
      {
        id: 'mod_tilt',
        text: '1.4 镜面倾角：观察镜转 α、反射约转 2α',
        hint: '切换到 1.4，重点调节台面转角',
      },
      {
        id: 'result',
        text: '回顾数据表，总结反射规律后完成',
        hint: '至少记录一组后可完成实验',
      },
    ],
    modules: REFLECTION_MODULES,
    defaultModule: 'observe',
  },
  {
    id: 'refraction',
    name: '光的折射',
    goal: '完成 2.1–2.4：现象观察、斯涅尔定律、全反射、平板侧移',
    theory: '折射定律 n₁ sin i = n₂ sin r；临界角 sin C = n₂/n₁',
    steps: [
      {
        id: 'mod_observe',
        text: '2.1 折射现象观察：光疏/光密偏折',
        hint: '全息屏切换课题；可换介质预设',
      },
      {
        id: 'mod_snell',
        text: '2.2 折射定律验证：sinθ₁/sinθ₂ ≈ n',
        hint: '切换到 2.2，记录多组并比较比值与 n',
      },
      {
        id: 'mod_tir',
        text: '2.3 全反射与临界角',
        hint: '切换到 2.3，高折射率 + 大入射角，观察 TIR',
      },
      {
        id: 'mod_shift',
        text: '2.4 平板玻璃侧移',
        hint: '切换到 2.4，观察出射光平行侧移',
      },
      {
        id: 'result',
        text: '回顾数据表，总结折射规律后完成',
        hint: '至少记录一组后可完成实验',
      },
    ],
    modules: REFRACTION_MODULES,
    defaultModule: 'observe',
  },
  {
    id: 'dispersion',
    name: '光的色散',
    goal: '观察三棱镜白光色散，理解 n(λ) 与红→紫展宽',
    theory: '同一介质 n 随波长变化；一般紫光偏折大于红光（色散）',
    steps: [
      { id: 'setup', text: '安装等边三棱镜，开启白光色散', hint: '色散模式 + 多光束' },
      { id: 'observe', text: '在观察屏寻找红→紫光谱色带', hint: '调节色散系数与入射角' },
      { id: 'record', text: '记录观察现象', hint: '写入当前配置' },
      { id: 'result', text: '说明紫光偏折更大的原因后完成', hint: '至少记录一组后可完成' },
    ],
    config: {
      shape: 'prism', angle: 48, rayCount: 9, rotate: 0,
      dispersion: true, dispersionStrength: 0.85, showReflect: true, mode: 'dielectric', ior: 1.52,
    },
  },
  {
    id: 'lens',
    name: '透镜光路',
    goal: '用近平行多束光观察球透镜/柱面透镜会聚',
    theory: '凸透镜使平行光会聚；折射率影响会聚强弱',
    steps: [
      { id: 'setup', text: '选用玻璃球或柱面透镜', hint: '入射角宜小，光束条数宜多' },
      { id: 'observe', text: '观察会聚光路，调节折射率', hint: '切换柱面透镜对比一维会聚' },
      { id: 'record', text: '记录观察结果', hint: '写入当前配置' },
      { id: 'result', text: '总结会聚特性后完成', hint: '至少记录一组后可完成' },
    ],
    config: {
      shape: 'sphere', angle: 12, rayCount: 7, height: 0, rotate: 0,
      dispersion: false, showReflect: true, mode: 'dielectric', ior: 1.52,
    },
  },
];

export function getGeometricExperiment(id) {
  return GEOMETRIC_EXPERIMENTS.find((e) => e.id === id) || null;
}

/** Resolve apparatus config for an experiment (+ optional module). */
export function resolveExperimentConfig(expId, moduleId) {
  const exp = getGeometricExperiment(expId);
  if (!exp) return null;
  if (exp.modules) {
    const mod = getModule(expId, moduleId || exp.defaultModule);
    return mod?.config || exp.modules[0].config;
  }
  return exp.config || null;
}

/** Map step id → default module when user advances steps. */
export function moduleIdFromStep(expId, stepId) {
  if (expId === 'reflection') {
    const map = {
      mod_observe: 'observe',
      mod_law: 'law',
      mod_multi: 'multi',
      mod_tilt: 'tilt',
    };
    return map[stepId] || null;
  }
  if (expId === 'refraction') {
    const map = {
      mod_observe: 'observe',
      mod_snell: 'snell',
      mod_tir: 'tir',
      mod_shift: 'shift',
    };
    return map[stepId] || null;
  }
  return null;
}

export function stepIdForModule(expId, moduleId) {
  if (expId === 'reflection') {
    const map = {
      observe: 'mod_observe',
      law: 'mod_law',
      multi: 'mod_multi',
      tilt: 'mod_tilt',
    };
    return map[moduleId] || 'mod_observe';
  }
  if (expId === 'refraction') {
    const map = {
      observe: 'mod_observe',
      snell: 'mod_snell',
      tir: 'mod_tir',
      shift: 'mod_shift',
    };
    return map[moduleId] || 'mod_observe';
  }
  return null;
}
