/**
 * Chemistry island cup rig: two beakers, drag/pour, liquid fill, molecule pedestal.
 * Host (labShell / chem station) owns pointer/AR; this owns geometry + pour FSM.
 *
 * Pour uses gravity-integrated liquid parcels (not path-sampled beads):
 * exit velocity from tilt + head height, free-fall under g, absorb on impact,
 * free surface stays world-horizontal, destination surface ripples on hit.
 */

import { blendColors, formatSubscriptFormula } from './reagentCatalog.js';
import { createMoleculeMesh, createFallbackMolecule } from './moleculeMesh.js';
import { getMoleculePanel } from './moleculePanel.js';

const POUR_NEAR = 0.55;
/** Island-scale gravity (scene units ≈ meters/3). */
const GRAVITY = 3.4;
const STREAM_POOL = 40;
const SPLASH_POOL = 14;
const LIP_RADIUS = 0.17;
const CUP_MOUTH_Y = 0.55;
const CUP_INNER_R = 0.15;
/** Max pour phase duration (safety); volume usually empties sooner. */
const POUR_MAX_S = 2.2;

/**
 * @param {typeof import('three')} THREE
 * @param {{ materials?: any, accent?: number }} [opts]
 */
export function createChemCupRig(THREE, opts = {}) {
  const accent = opts.accent ?? 0x34d399;
  const root = new THREE.Group();
  root.name = 'chem-cup-rig';

  // Pedestal for 3D molecule (rear center of island top, local space)
  const pedestal = new THREE.Group();
  pedestal.position.set(0, 0, -0.35);
  const pedBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.26, 0.06, 28),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.35 }),
  );
  pedBase.position.y = 0.03;
  pedestal.add(pedBase);
  const pedRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.012, 8, 32),
    new THREE.MeshStandardMaterial({
      color: accent, emissive: accent, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3,
    }),
  );
  pedRing.rotation.x = Math.PI / 2;
  pedRing.position.y = 0.07;
  pedestal.add(pedRing);
  root.add(pedestal);

  /** @type {THREE.Object3D | null} */
  let molecule = null;

  const homeA = new THREE.Vector3(-0.55, 0, 0.15);
  const homeB = new THREE.Vector3(0.55, 0, 0.15);

  const cupA = makeCup(THREE, 'A', 0x38bdf8, accent);
  cupA.position.copy(homeA);
  root.add(cupA);
  const cupB = makeCup(THREE, 'B', 0xf472b6, accent);
  cupB.position.copy(homeB);
  root.add(cupB);

  // —— Gravity-integrated liquid parcels (stream) + impact splash ——
  const dropGeo = new THREE.SphereGeometry(1, 10, 10);
  // Keep per-particle materials because each droplet fades independently;
  // use Standard instead of Physical so the stream does not invoke the
  // expensive transmission path on iPad.
  /** @type {{ mesh: any, active: boolean, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, age: number, r: number }[]} */
  const parcels = [];
  for (let i = 0; i < STREAM_POOL; i += 1) {
    const mesh = new THREE.Mesh(
      dropGeo,
      new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x059669,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0,
        roughness: 0.18,
        metalness: 0.05,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    mesh.scale.setScalar(0.018);
    root.add(mesh);
    parcels.push({
      mesh, active: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, age: 0, r: 0.018,
    });
  }

  /** @type {{ mesh: any, active: boolean, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, age: number }[]} */
  const splashes = [];
  for (let i = 0; i < SPLASH_POOL; i += 1) {
    const mesh = new THREE.Mesh(
      dropGeo,
      new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x059669,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0,
        roughness: 0.2,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    mesh.scale.setScalar(0.012);
    root.add(mesh);
    splashes.push({
      mesh, active: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, age: 0,
    });
  }

  // —— Reaction effervescence bubbles pool ——
  const BUBBLE_POOL = 48;
  const bubbleGeo = new THREE.SphereGeometry(1, 10, 10);
  /** @type {{ mesh: any, active: boolean, cupKind: 'A'|'B', x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, age: number, baseRadius: number, surfY: number, cupX: number, cupZ: number }[]} */
  const bubbles = [];
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.8,
    roughness: 0.05,
    metalness: 0.1,
    depthWrite: false,
  });

  for (let i = 0; i < BUBBLE_POOL; i += 1) {
    const mesh = new THREE.Mesh(bubbleGeo, bubbleMat);
    mesh.visible = false;
    mesh.scale.setScalar(0.01);
    root.add(mesh);
    bubbles.push({
      mesh, active: false, cupKind: 'A',
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, age: 0, baseRadius: 0.01, surfY: 0, cupX: 0, cupZ: 0,
    });
  }

  // Impact ripple disc on destination free surface
  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.08, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ripple.rotation.x = -Math.PI / 2;
  ripple.visible = false;
  root.add(ripple);
  let rippleT = 0;
  let rippleStrength = 0;
  let activeFluidCount = 0;

  let emitCarry = 0;
  const _lip = new THREE.Vector3();
  const _velDir = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  /**
   * @type {null | {
   *   from: 'A'|'B', to: 'A'|'B', phase: string, t: number,
   *   fromPos: any, fromRotZ: number, toPos: any, toRotZ: number,
   *   fillStart: number, dstFillStart: number, color: number,
   *   transferred: number, angularVel: number
   * }}
   */
  let pour = null;
  /** @type {null | { cup: any, kind: 'A'|'B', lift: number, offsetX: number, offsetZ: number }} */
  let drag = null;

  const state = {
    A: emptyCupState(),
    B: emptyCupState(),
  };

  function emptyCupState() {
    return {
      reagents: [],
      fill: 0,
      color: 0x38bdf8,
      formula: '',
      reactionEffervescence: 0,
      lastReaction: null,
    };
  }

  function parseReagentItems(list) {
    const res = [];
    for (const item of list || []) {
      if (!item) continue;
      const formula = String(item.formula || item.name_zh || item.id || '').trim();
      if (formula.includes('+')) {
        const parts = formula.split('+').map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          res.push({
            id: `sub-${p}`,
            formula: p,
            name_zh: p,
          });
        }
      } else {
        res.push(item);
      }
    }
    return res;
  }

  function detectReaction(reagents1 = [], reagents2 = []) {
    const list1 = parseReagentItems(Array.isArray(reagents1) ? reagents1 : []);
    const list2 = parseReagentItems(Array.isArray(reagents2) ? reagents2 : []);
    const allReagents = [...list1, ...list2];
    if (allReagents.length < 2) return null;

    const normalize = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();
    const has = (...keys) => allReagents.some((reagent) => {
      const values = [reagent.id, reagent.formula, reagent.name_zh].map(normalize);
      return keys.some((key) => values.includes(normalize(key)));
    });

    // 1. HCl + Na2CO3 / NaHCO3 / CaCO3 / K2CO3 (酸 + 碳酸盐 -> 大量 CO2 气泡)
    if ((has('HCL') || has('盐酸')) && (has('NA2CO3') || has('NAHCO3') || has('CACO3') || has('K2CO3') || has('碳酸钠') || has('碳酸氢钠') || has('碳酸钙'))) {
      const isBicarb = has('NAHCO3') || has('碳酸氢钠');
      const isCa = has('CACO3') || has('碳酸钙');
      return {
        reacts: true,
        gas: true,
        gasType: 'CO2',
        name: '碳酸盐与酸反应',
        equation: isCa
          ? '2HCl + CaCO3 = CaCl2 + H2O + CO2↑'
          : isBicarb
          ? 'HCl + NaHCO3 = NaCl + H2O + CO2↑'
          : '2HCl + Na2CO3 = 2NaCl + H2O + CO2↑',
        productColor: 0x94a3b8,
        intensity: 1.2,
        description: '酸与碳酸盐剧烈反应，产生大量二氧化碳（CO₂）气泡！',
        products: isCa ? [
          { formula: 'CaCl2', name_zh: '氯化钙', color: 0x38bdf8, percent: 50 },
          { formula: 'H2O', name_zh: '水', color: 0x60a5fa, percent: 30 },
          { formula: 'CO2', name_zh: '二氧化碳(气)', color: 0xe2e8f0, percent: 20 },
        ] : isBicarb ? [
          { formula: 'NaCl', name_zh: '氯化钠', color: 0x38bdf8, percent: 50 },
          { formula: 'H2O', name_zh: '水', color: 0x60a5fa, percent: 30 },
          { formula: 'CO2', name_zh: '二氧化碳(气)', color: 0xe2e8f0, percent: 20 },
        ] : [
          { formula: 'NaCl', name_zh: '氯化钠', color: 0x38bdf8, percent: 50 },
          { formula: 'H2O', name_zh: '水', color: 0x60a5fa, percent: 30 },
          { formula: 'CO2', name_zh: '二氧化碳(气)', color: 0xe2e8f0, percent: 20 },
        ],
      };
    }

    // 2. H2SO4 + Na2CO3 / CaCO3 (硫酸 + 碳酸盐 -> CO2 气泡)
    if ((has('H2SO4') || has('硫酸')) && (has('NA2CO3') || has('NAHCO3') || has('CACO3') || has('碳酸钠') || has('碳酸钙'))) {
      return {
        reacts: true,
        gas: true,
        gasType: 'CO2',
        name: '碳酸盐与硫酸反应',
        equation: 'H2SO4 + Na2CO3 = Na2SO4 + H2O + CO2↑',
        productColor: 0x94a3b8,
        intensity: 1.2,
        description: '硫酸与碳酸盐反应，迅速产生大量二氧化碳（CO₂）气泡！',
        products: [
          { formula: 'Na2SO4', name_zh: '硫酸钠', color: 0x38bdf8, percent: 50 },
          { formula: 'H2O', name_zh: '水', color: 0x60a5fa, percent: 30 },
          { formula: 'CO2', name_zh: '二氧化碳(气)', color: 0xe2e8f0, percent: 20 },
        ],
      };
    }

    // 3. Fe2O3 + HCl (氧化铁 + 盐酸 -> 氯化铁 + 水)
    // Keep this before the elemental-metal rule. A substring match such as
    // "FE" would incorrectly classify Fe2O3 as metallic iron.
    if (has('HCL', '盐酸') && has('FE2O3', '氧化铁')) {
      return {
        reacts: true,
        name: '氧化铁与盐酸反应',
        equation: '6HCl + Fe2O3 = 2FeCl3 + 3H2O',
        productColor: 0xd97706,
        intensity: 0.7,
        description: '氧化铁与盐酸反应，生成氯化铁和水。',
        products: [
          { formula: 'FeCl3', name_zh: '氯化铁', color: 0xea580c, percent: 65 },
          { formula: 'H2O', name_zh: '水', color: 0x60a5fa, percent: 35 },
        ],
      };
    }

    // 4. HCl / H2SO4 + Mg / Zn / Fe (酸与活泼金属 -> H2 气泡)
    const acid = has('HCL', '盐酸') ? 'HCl' : has('H2SO4', '硫酸') ? 'H2SO4' : null;
    const metal = has('MG', '镁') ? 'Mg' : has('ZN', '锌') ? 'Zn' : has('FE', '铁') ? 'Fe' : null;
    if (acid && metal) {
      const sulfate = acid === 'H2SO4';
      const salt = `${metal}${sulfate ? 'SO4' : 'Cl2'}`;
      const coefficient = sulfate ? '' : '2';
      return {
        reacts: true,
        gas: true,
        gasType: 'H2',
        name: '金属与酸置换反应',
        equation: `${coefficient}${acid} + ${metal} = ${salt} + H2↑`,
        productColor: 0xcbd5e1,
        intensity: 1.0,
        description: '活泼金属与酸置换反应，剧烈冒出氢气（H₂）气泡！',
        products: [
          { formula: salt, name_zh: salt === 'MgCl2' ? '氯化镁' : salt === 'ZnCl2' ? '氯化锌' : salt === 'FeCl2' ? '氯化亚铁' : salt, color: 0x38bdf8, percent: 70 },
          { formula: 'H2', name_zh: '氢气(气)', color: 0xe0f2fe, percent: 30 },
        ],
      };
    }

    // 5. H2O2 + MnO2 (过氧化氢催化分解 -> O2 气泡)
    if ((has('H2O2') || has('过氧化氢')) && (has('MNO2') || has('二氧化锰'))) {
      return {
        reacts: true,
        gas: true,
        gasType: 'O2',
        name: '过氧化氢催化分解',
        equation: '2H2O2 = 2H2O + O2↑',
        productColor: 0x94a3b8,
        intensity: 1.2,
        description: '二氧化锰催化双氧水分解，大量释放氧气（O₂）气泡！',
        products: [
          { formula: 'H2O', name_zh: '水', color: 0x60a5fa, percent: 70 },
          { formula: 'O2', name_zh: '氧气(气)', color: 0xe0f2fe, percent: 30 },
        ],
      };
    }

    // 6. CuSO4 + NaOH (硫酸铜 + 氢氧化钠 -> 蓝色沉淀)
    if ((has('CUSO4') || has('硫酸铜')) && (has('NAOH') || has('氢氧化钠'))) {
      return {
        reacts: true,
        precipitate: true,
        name: '铜离子沉淀反应',
        equation: 'CuSO4 + 2NaOH = Cu(OH)2↓ + Na2SO4',
        productColor: 0x0284c7,
        intensity: 0.8,
        description: '生成蓝色絮状氢氧化铜 Cu(OH)₂ 沉淀！',
        products: [
          { formula: 'Cu(OH)2', name_zh: '氢氧化铜(沉淀)', color: 0x0284c7, percent: 50 },
          { formula: 'Na2SO4', name_zh: '硫酸钠', color: 0x38bdf8, percent: 50 },
        ],
      };
    }

    // 7. AgNO3 + NaCl (硝酸银 + 氯化钠 -> 白色沉淀)
    if ((has('AGNO3') || has('硝酸银')) && (has('NACL') || has('氯化钠') || has('HCL'))) {
      return {
        reacts: true,
        precipitate: true,
        name: '氯离子检验反应',
        equation: 'AgNO3 + NaCl = AgCl↓ + NaNO3',
        productColor: 0xf8fafc,
        intensity: 0.8,
        description: '生成不溶于酸的白色氯化银 AgCl 沉淀！',
        products: [
          { formula: 'AgCl', name_zh: '氯化银(沉淀)', color: 0xf8fafc, percent: 50 },
          { formula: 'NaNO3', name_zh: '硝酸钠', color: 0xf9a8d4, percent: 50 },
        ],
      };
    }

    return null;
  }

  function triggerReactionEffect(kind, opts = {}) {
    if (kind !== 'A' && kind !== 'B') return;
    const s = state[kind];
    s.reactionEffervescence = opts.duration ?? 8.0;
    if (opts.productColor) s.color = opts.productColor;
    if (opts.equation) s.formula = opts.equation;
    s.lastReaction = {
      reacts: true,
      intensity: opts.intensity ?? 1.0,
      description: opts.description || '发生化学反应',
    };
    applyCupVisual(kind);
  }

  /**
   * Apply a reaction resolved by the shared chemistry service after a pour.
   * Local demonstrations stay synchronous; this path covers other reagent
   * pairs without blocking the render loop on network I/O.
   */
  function applyExternalReaction(kind, reaction) {
    if (kind !== 'A' && kind !== 'B') return false;
    if (!reaction || reaction.kind !== 'reaction' || !Array.isArray(reaction.components) || !reaction.components.length) {
      return false;
    }
    const normalized = {
      ...reaction,
      reacts: true,
      description: reaction.reason || '两种试剂发生化学反应',
      products: reaction.components.map((component) => ({
        formula: component.formula,
        name_zh: component.name_zh || component.formula,
        color: component.color,
        percent: component.percent,
        query: component.query,
      })),
      productColor: reaction.components[0]?.color,
    };
    const applied = applyReactionProducts(state[kind], normalized);
    if (applied) applyCupVisual(kind);
    return applied;
  }

  /**
   * Replace cup content with reaction products so labels / right panel show post-reaction compounds.
   * @returns {boolean} true if products were applied
   */
  function applyReactionProducts(s, reaction) {
    if (!s || !reaction?.reacts) return false;
    s.lastReaction = reaction;
    s.reactionEffervescence = Math.max(s.reactionEffervescence || 0, 12.0);
    if (reaction.productColor != null) s.color = reaction.productColor;
    if (Array.isArray(reaction.products) && reaction.products.length) {
      s.reagents = reaction.products.map((p, i) => ({
        id: `prod-${i}-${p.formula}`,
        formula: p.formula,
        name_zh: p.name_zh || p.formula,
        color: p.color || s.color,
        query: p.query || p.formula,
        percent: p.percent,
      }));
      s.formula = s.reagents.map((r) => r.formula).join('+');
      return true;
    }
    // Fallback: show product side of equation if products list missing
    if (reaction.equation && reaction.equation.includes('=')) {
      const rhs = reaction.equation.split('=')[1] || '';
      s.formula = rhs.replace(/[↑↓]/g, '').trim() || s.formula;
    }
    return false;
  }

  function applyCupVisual(kind, optsVis = {}) {
    const cup = kind === 'A' ? cupA : cupB;
    const s = state[kind];
    setCupLevel(cup, s.fill, s.color, {
      tiltZ: optsVis.tiltZ ?? cup.rotation.z,
      slosh: optsVis.slosh ?? 0,
      ripple: optsVis.ripple ?? 0,
    });
    const label = s.reagents.map((r) => formatSubscriptFormula(r.formula)).join('+') || kind;
    if (cup.userData.labelText !== label) {
      cup.userData.labelText = label;
      setCupLabel(THREE, cup, label);
    }
  }

  function assignReagent(kind, reagent) {
    if (!reagent || (kind !== 'A' && kind !== 'B')) return false;
    const s = state[kind];
    const formulaStr = String(reagent.formula || '').trim();
    if (formulaStr.includes('+')) {
      s.reagents = formulaStr.split('+').map((f, i) => ({
        id: `r-${i}-${f.trim()}`,
        formula: f.trim(),
        name_zh: f.trim(),
        color: reagent.color,
      }));
    } else {
      s.reagents = [{ ...reagent }];
    }
    s.fill = 0.85;
    s.color = reagent.color;
    s.formula = reagent.formula;
    s.lastReaction = null;

    const reaction = detectReaction(s.reagents);
    if (reaction?.reacts) {
      applyReactionProducts(s, reaction);
    }

    applyCupVisual(kind);
    return true;
  }

  function clearCup(kind) {
    if (kind !== 'A' && kind !== 'B') return;
    state[kind] = emptyCupState();
    applyCupVisual(kind);
  }

  function resetAll() {
    clearCup('A');
    clearCup('B');
    clearMolecule();
    snapHome(cupA, homeA);
    snapHome(cupB, homeB);
    pour = null;
    drag = null;
    clearFluid();
  }

  function componentsList() {
    const map = new Map();
    for (const kind of ['A', 'B']) {
      for (const r of state[kind].reagents) {
        if (!map.has(r.id)) map.set(r.id, { ...r });
      }
    }
    return [...map.values()];
  }

  function beginDrag(kind, worldHit, islandLocalHit) {
    if (pour) return false;
    const cup = kind === 'A' ? cupA : cupB;
    const homeZ = kind === 'A' ? homeA.z : homeB.z;
    cup.rotation.set(0, 0, 0);
    if (cup.userData.halo) cup.userData.halo.material.opacity = 0.5;
    drag = {
      cup,
      kind,
      homeZ,
      offsetX: islandLocalHit ? cup.position.x - islandLocalHit.x : 0,
      offsetY: islandLocalHit ? cup.position.y - islandLocalHit.y : 0,
    };
    return true;
  }

  function updateDrag(localX, localY) {
    if (!drag) return;
    const { cup, offsetX, offsetY, homeZ } = drag;
    // Horizontal (left/right) X-axis and Vertical (up/down) Y-axis (height)
    cup.position.x = clamp(localX + offsetX, -1.5, 1.5);
    cup.position.y = clamp(localY + offsetY, 0, 1.2);
    cup.position.z = homeZ;
    const other = drag.kind === 'A' ? cupB : cupA;
    const near = Math.hypot(cup.position.x - other.position.x, cup.position.y - other.position.y) < POUR_NEAR
      || Math.hypot(cup.position.x - other.position.x, cup.position.z - other.position.z) < POUR_NEAR;
    if (cup.userData.halo) {
      cup.userData.halo.material.opacity = near ? 0.9 : 0.45;
      cup.userData.halo.material.color.setHex(near ? 0x34d399 : accent);
    }
  }

  function endDrag() {
    if (!drag) return { poured: false };
    const { cup, kind } = drag;
    const otherKind = kind === 'A' ? 'B' : 'A';
    const other = otherKind === 'A' ? cupA : cupB;
    const near = Math.hypot(cup.position.x - other.position.x, cup.position.z - other.position.z) < POUR_NEAR;
    drag = null;
    if (near && state[kind].fill > 0.02) {
      startPour(kind, otherKind);
      return { poured: true, from: kind, to: otherKind };
    }
    snapHome(cup, kind === 'A' ? homeA : homeB);
    if (cup.userData.halo) cup.userData.halo.material.opacity = 0;
    return { poured: false };
  }

  function startPour(from, to) {
    if (pour) return false;
    if (state[from].fill <= 0.02) return false;
    const cup = from === 'A' ? cupA : cupB;
    const target = to === 'A' ? cupA : cupB;
    const sign = from === 'A' ? -1 : 1;
    clearFluid();
    emitCarry = 0;
    pour = {
      from,
      to,
      phase: 'approach',
      t: 0,
      fromPos: cup.position.clone(),
      fromRotZ: cup.rotation.z,
      toPos: new THREE.Vector3(
        target.position.x + sign * 0.38,
        0.42,
        target.position.z + 0.02,
      ),
      // ~52° tip — liquid clears the rim under gravity
      toRotZ: sign * 0.92,
      fillStart: state[from].fill,
      dstFillStart: state[to].fill,
      color: state[from].color,
      transferred: 0,
      angularVel: 0,
    };
    if (cup.userData.halo) cup.userData.halo.material.opacity = 0;
    return true;
  }

  function update(dt) {
    if (molecule) {
      molecule.rotation.y += dt * 0.6;
      if (molecule.userData?.isLoading) {
        molecule.rotation.x += dt * 1.2;
        if (molecule.userData.ring1) molecule.userData.ring1.rotation.z += dt * 3.5;
        if (molecule.userData.ring2) molecule.userData.ring2.rotation.x += dt * 2.8;
        if (molecule.userData.ring3) molecule.userData.ring3.rotation.y += dt * 3.2;
        const pulse = 1.0 + Math.sin(Date.now() * 0.008) * 0.12;
        molecule.scale.setScalar(pulse);
      }
    }
    const safeDt = Math.min(0.05, Math.max(0, dt));

    // Most frames are completely idle. Avoid walking all fluid pools and
    // rewriting transparent mesh transforms until a pour/reaction/ripple is
    // actually alive. This is particularly important on iPad WebKit.
    if (hasActiveFluid()) stepFluid(safeDt);
    if (pour?.phase === 'pouring') {
      const target = pour.to === 'A' ? cupA : cupB;
      resolveImpacts(target, pour.color);
    }

    if (drag || !pour) return;

    const p = pour;
    const cup = p.from === 'A' ? cupA : cupB;
    const target = p.to === 'A' ? cupA : cupB;
    p.t += safeDt;

    if (p.phase === 'approach') {
      const u = Math.min(1, p.t / 0.42);
      const e = easeInOut(u);
      cup.position.lerpVectors(p.fromPos, p.toPos, e);
      // Angular ramp — tip gradually so free surface can track
      const tip = p.toRotZ * (0.22 + 0.28 * e);
      p.angularVel = (tip - cup.rotation.z) / Math.max(1e-4, safeDt);
      cup.rotation.z = tip;
      applyCupVisual(p.from, { tiltZ: tip, slosh: Math.abs(p.angularVel) * 0.02 });
      if (u >= 1) {
        p.phase = 'pouring';
        p.t = 0;
        p.fromPos.copy(cup.position);
        p.fromRotZ = cup.rotation.z;
      }
      return;
    }

    if (p.phase === 'pouring') {
      // Tip reaches full angle quickly, then holds while volume drains under gravity
      const tipU = Math.min(1, p.t / 0.28);
      const tipEase = easeOut(tipU);
      const overshoot = Math.sin(tipU * Math.PI) * 0.05 * Math.sign(p.toRotZ) * (1 - tipU);
      const tip = THREE.MathUtils.lerp(p.fromRotZ, p.toRotZ, tipEase) + overshoot;
      p.angularVel = (tip - cup.rotation.z) / Math.max(1e-4, safeDt);
      cup.position.copy(p.toPos);
      cup.position.x += Math.sin(p.t * 11) * 0.004;
      cup.position.y += Math.sin(p.t * 7.5) * 0.003;
      cup.rotation.z = tip;

      // Volume transfer ∝ √head · aperture(tilt)  (Torricelli + weir)
      const head = Math.max(0.04, state[p.from].fill);
      const tiltFactor = Math.max(0, Math.sin(Math.abs(tip)) - 0.16);
      const flowRate = 1.35 * Math.sqrt(head) * tiltFactor;
      const dV = flowRate * safeDt;
      const remain = p.fillStart - p.transferred;
      const step = Math.min(dV, Math.max(0, remain));
      p.transferred += step;
      state[p.from].fill = Math.max(0, p.fillStart - p.transferred);
      state[p.to].fill = Math.min(0.95, p.dstFillStart + p.transferred * 0.98);

      // Preview destination content as soon as liquid arrives
      if (p.transferred > 0.02) {
        const rx = detectReaction(state[p.from].reagents, state[p.to].reagents);
        if (rx?.reacts) {
          state[p.to].reactionEffervescence = 8.0;
          state[p.to].lastReaction = rx;
        }
        if (!state[p.to].reagents.length && state[p.from].reagents.length) {
          state[p.to].reagents = state[p.from].reagents.map((r) => ({ ...r }));
          state[p.to].color = p.color;
          state[p.to].formula = state[p.to].reagents.map((r) => r.formula).join('+');
        } else if (state[p.to].reagents.length) {
          const w = clamp(p.transferred / Math.max(0.01, p.fillStart), 0, 1) * 0.12;
          const targetCol = rx?.productColor ?? p.color;
          state[p.to].color = blendColors(state[p.to].color, targetCol, w);
        }
      }

      applyCupVisual(p.from, {
        tiltZ: tip,
        slosh: Math.min(0.08, Math.abs(p.angularVel) * 0.015 + step * 0.4),
      });
      applyCupVisual(p.to, {
        tiltZ: target.rotation.z,
        ripple: rippleStrength,
        slosh: rippleStrength * 0.05,
      });

      emitFromLip(cup, tip, p.color, state[p.from].fill, step, safeDt);

      const empty = p.transferred >= p.fillStart - 0.004;
      const timedOut = p.t >= POUR_MAX_S;
      if (empty || timedOut) {
        // Force remaining volume across on timeout so state stays consistent
        if (!empty) {
          const leftover = p.fillStart - p.transferred;
          p.transferred = p.fillStart;
          state[p.from].fill = 0;
          state[p.to].fill = Math.min(0.95, p.dstFillStart + p.transferred * 0.98);
          void leftover;
        }
        commitPour(p.from, p.to);
        p.phase = 'return';
        p.t = 0;
        p.fromPos.copy(cup.position);
        p.fromRotZ = cup.rotation.z;
      }
      return;
    }

    if (p.phase === 'return') {
      const home = p.from === 'A' ? homeA : homeB;
      const u = Math.min(1, p.t / 0.48);
      const e = easeOut(u);
      cup.position.lerpVectors(p.fromPos, home, e);
      cup.rotation.z = THREE.MathUtils.lerp(p.fromRotZ, 0, Math.min(1, e * 1.35));
      applyCupVisual(p.from, { tiltZ: cup.rotation.z, slosh: (1 - e) * 0.04 });
      if (u >= 1) {
        snapHome(cup, home);
        applyCupVisual(p.from);
        applyCupVisual(p.to);
        pour = null;
      }
    }
  }

  function commitPour(from, to) {
    const src = state[from];
    const dst = state[to];
    const srcReagents = src.reagents;
    if (!srcReagents.length) {
      src.fill = 0;
      src.formula = '';
      applyCupVisual(from);
      applyCupVisual(to);
      return;
    }
    const transferred = pour?.transferred ?? src.fill;
    const dstStart = pour?.dstFillStart ?? dst.fill;
    const pourColor = pour?.color ?? src.color;

    if (!dst.reagents.length) {
      dst.reagents = srcReagents.map((r) => ({ ...r }));
      dst.color = pourColor;
      dst.fill = Math.min(0.95, dstStart + transferred);
    } else {
      const ids = new Set(dst.reagents.map((r) => r.id));
      for (const r of srcReagents) {
        if (!ids.has(r.id)) dst.reagents.push({ ...r });
      }
      dst.fill = Math.min(0.95, dstStart + transferred);
    }

    const reaction = detectReaction(dst.reagents);
    if (reaction?.reacts) {
      // Replace mixed reagents with post-reaction compounds (right panel + cup label).
      applyReactionProducts(dst, reaction);
    } else {
      dst.color = blendColors(dst.color, pourColor, 0.5);
      dst.formula = dst.reagents.map((r) => r.formula).join('+');
      dst.lastReaction = null;
    }

    src.reagents = [];
    src.fill = 0;
    src.formula = '';
    src.color = 0x38bdf8;
    src.lastReaction = null;
    applyCupVisual(from);
    applyCupVisual(to);
  }

  // ─── Fluid mechanics (parcels) ───────────────────────────────────────────

  function cupLipWorld(cup, tiltZ) {
    // Pour-side rim in rig-local space (cup tip about local Z)
    _lip.x = cup.position.x - Math.sin(tiltZ) * (LIP_RADIUS + 0.05);
    _lip.y = cup.position.y + Math.cos(tiltZ) * 0.48 + 0.06;
    _lip.z = cup.position.z;
    return _lip;
  }

  function emitFromLip(cup, tiltZ, color, fill, dV, dt) {
    if (fill < 0.02 || dV < 1e-5) return;
    // Exit speed from head height (Torricelli) + tilt gate
    const vExit = 0.55 + 1.15 * Math.sqrt(Math.max(0.05, fill));
    const gate = Math.max(0, Math.sin(Math.abs(tiltZ)) - 0.15);
    if (gate < 0.02) return;

    // Emit density tracks volume flux so the jet looks continuous
    const rate = 70 + 120 * gate * Math.sqrt(fill);
    emitCarry += rate * dt;
    const n = Math.min(10, Math.floor(emitCarry));
    emitCarry -= n;
    if (n <= 0) return;

    const lip = cupLipWorld(cup, tiltZ);
    // Outward along pour axis (tilt plane) with slight downward bias once past lip
    const sx = -Math.sign(tiltZ) || 1;
    const exitVx = sx * vExit * (0.55 + 0.45 * gate);
    const exitVy = -0.15 - 0.55 * gate * vExit * 0.25;
    const exitVz = 0;

    for (let k = 0; k < n; k += 1) {
      const p = allocParcel();
      if (!p) break;
      // Jet cross-section: small random offset in lip plane
      const jx = (Math.random() - 0.5) * 0.028;
      const jz = (Math.random() - 0.5) * 0.022;
      p.x = lip.x + jx * Math.cos(tiltZ);
      p.y = lip.y + (Math.random() - 0.5) * 0.012;
      p.z = lip.z + jz;
      // Velocity jitter for jet breakup
      p.vx = exitVx + (Math.random() - 0.5) * 0.12;
      p.vy = exitVy + (Math.random() - 0.5) * 0.08;
      p.vz = exitVz + (Math.random() - 0.5) * 0.1;
      p.life = 0.55 + Math.random() * 0.35;
      p.age = 0;
      p.r = 0.012 + Math.random() * 0.01 + dV * 0.15;
      p.mesh.material.color.setHex(color);
      p.mesh.material.emissive.setHex(color);
      p.mesh.visible = true;
    }
  }

  function allocParcel() {
    for (let i = 0; i < parcels.length; i += 1) {
      if (!parcels[i].active) {
        activateFluid(parcels[i]);
        return parcels[i];
      }
    }
    return null;
  }

  function allocSplash() {
    for (let i = 0; i < splashes.length; i += 1) {
      if (!splashes[i].active) {
        activateFluid(splashes[i]);
        return splashes[i];
      }
    }
    return null;
  }

  function allocBubble() {
    for (let i = 0; i < bubbles.length; i += 1) {
      if (!bubbles[i].active) {
        activateFluid(bubbles[i]);
        return bubbles[i];
      }
    }
    return null;
  }

  function hasActiveFluid() {
    return activeFluidCount > 0
      || rippleStrength > 0.001
      || (state.A.reactionEffervescence > 0 && state.A.fill > 0.05)
      || (state.B.reactionEffervescence > 0 && state.B.fill > 0.05);
  }

  function activateFluid(item) {
    if (item.active) return;
    item.active = true;
    activeFluidCount += 1;
  }

  function deactivateFluid(item) {
    if (!item.active) return;
    item.active = false;
    activeFluidCount = Math.max(0, activeFluidCount - 1);
  }

  function stepFluid(dt) {
    // Parcels under gravity
    for (let i = 0; i < parcels.length; i += 1) {
      const p = parcels[i];
      if (!p.active) continue;
      p.age += dt;
      p.vy -= GRAVITY * dt;
      // Mild air drag
      const drag = Math.exp(-1.2 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Orient + stretch along velocity (continuity: faster → longer thinner streak)
      const spd = Math.hypot(p.vx, p.vy, p.vz) + 1e-4;
      const stretch = clamp(0.7 + spd * 0.55, 0.8, 2.6);
      const rad = p.r * (1 - p.age / (p.life + 0.2) * 0.25);
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.scale.set(rad / stretch * 0.85, rad * stretch, rad / stretch * 0.85);
      // Align local +Y with velocity
      _velDir.set(p.vx / spd, p.vy / spd, p.vz / spd);
      p.mesh.quaternion.setFromUnitVectors(_up, _velDir);
      const fade = clamp(1 - p.age / p.life, 0, 1);
      p.mesh.material.opacity = 0.82 * fade;
      p.mesh.visible = fade > 0.04;

      if (p.age >= p.life || p.y < -0.2) {
        deactivateFluid(p);
        p.mesh.visible = false;
        p.mesh.material.opacity = 0;
      }
    }

    // Splash droplets (bounce fragments)
    for (let i = 0; i < splashes.length; i += 1) {
      const s = splashes[i];
      if (!s.active) continue;
      s.age += dt;
      s.vy -= GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const fade = clamp(1 - s.age / s.life, 0, 1);
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.scale.setScalar(0.008 + 0.01 * fade);
      s.mesh.material.opacity = 0.7 * fade;
      s.mesh.visible = fade > 0.05;
      if (s.age >= s.life || s.y < -0.15) {
        deactivateFluid(s);
        s.mesh.visible = false;
        s.mesh.material.opacity = 0;
      }
    }

    // Reaction Effervescence Bubbles Update
    for (const kind of ['A', 'B']) {
      const s = state[kind];
      if (s.reactionEffervescence > 0 && s.fill > 0.05) {
        s.reactionEffervescence = Math.max(0, s.reactionEffervescence - dt);
        const cup = kind === 'A' ? cupA : cupB;
        const surfY = cup.position.y + 0.10 + s.fill * 0.32;
        const spawnRate = 45 * Math.min(1.2, s.reactionEffervescence) * (s.lastReaction?.intensity ?? 1.0);
        const nToSpawn = Math.floor(spawnRate * dt + Math.random() * 0.3);

        for (let k = 0; k < nToSpawn; k++) {
          const b = allocBubble();
          if (!b) break;
          const r = (0.16 - 0.035) * Math.sqrt(Math.random());
          const theta = Math.random() * Math.PI * 2;
          b.cupKind = kind;
          b.cupX = cup.position.x;
          b.cupZ = cup.position.z;
          b.surfY = surfY;
          b.x = cup.position.x + r * Math.cos(theta);
          b.z = cup.position.z + r * Math.sin(theta);
          b.y = cup.position.y + 0.12 + Math.random() * Math.max(0.02, surfY - cup.position.y - 0.14);
          b.vx = (Math.random() - 0.5) * 0.08;
          b.vy = 0.4 + Math.random() * 0.6;
          b.vz = (Math.random() - 0.5) * 0.08;
          b.baseRadius = 0.006 + Math.random() * 0.014;
          b.life = 1.0 + Math.random() * 0.5;
          b.age = 0;
          b.mesh.position.set(b.x, b.y, b.z);
          b.mesh.scale.setScalar(b.baseRadius);
          b.mesh.visible = true;
          b.mesh.material.opacity = 0.85;
        }
      }
    }

    for (let i = 0; i < bubbles.length; i += 1) {
      const b = bubbles[i];
      if (!b.active) continue;
      b.age += dt;
      b.vy += 2.2 * dt; // Buoyancy acceleration
      b.vx += Math.sin(b.age * 18) * 0.08 * dt;
      b.vz += Math.cos(b.age * 14) * 0.08 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;

      const cup = b.cupKind === 'A' ? cupA : cupB;
      const surfY = cup.position.y + 0.10 + state[b.cupKind].fill * 0.32;
      const expand = 1.0 + (b.y - (cup.position.y + 0.1)) * 1.8;
      const rad = b.baseRadius * expand;

      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.scale.setScalar(rad);

      const distToSurface = surfY - b.y;
      if (distToSurface <= 0.02) {
        // Burst on surface
        triggerRipple(b.cupX, surfY, b.cupZ, 0xffffff);
        deactivateFluid(b);
        b.mesh.visible = false;
        b.mesh.material.opacity = 0;
      } else {
        b.mesh.material.opacity = Math.min(0.85, distToSurface / 0.04);
      }

      if (b.age >= b.life || b.y > surfY + 0.05) {
        deactivateFluid(b);
        b.mesh.visible = false;
        b.mesh.material.opacity = 0;
      }
    }

    // Surface ripple decay
    if (rippleStrength > 0.001) {
      rippleT += dt;
      rippleStrength *= Math.exp(-3.2 * dt);
      const r = 0.04 + rippleT * 0.22;
      ripple.scale.setScalar(r / 0.08);
      ripple.material.opacity = clamp(rippleStrength * 0.55, 0, 0.55);
      ripple.visible = ripple.material.opacity > 0.02;
    } else if (ripple.visible) {
      ripple.visible = false;
      ripple.material.opacity = 0;
      rippleStrength = 0;
    }
  }

  function resolveImpacts(targetCup, color) {
    const cx = targetCup.position.x;
    const cy = targetCup.position.y;
    const cz = targetCup.position.z;
    const surfY = cy + 0.12 + (state[targetCup.userData.kind]?.fill ?? 0.3) * 0.32;
    const mouthY = cy + CUP_MOUTH_Y;

    for (let i = 0; i < parcels.length; i += 1) {
      const p = parcels[i];
      if (!p.active) continue;
      const dx = p.x - cx;
      const dz = p.z - cz;
      const radial = Math.hypot(dx, dz);
      // Entered cup mouth cylinder and crossed free surface or fell into vessel
      if (radial < CUP_INNER_R + 0.04 && p.y < mouthY && p.y > cy + 0.05) {
        if (p.y <= surfY + 0.04 || p.vy < -0.3) {
          // Absorb + splash
          spawnSplash(p.x, Math.max(p.y, surfY), p.z, p.vx, p.vy, p.vz, color);
          triggerRipple(cx, surfY, cz, color);
          deactivateFluid(p);
          p.mesh.visible = false;
          p.mesh.material.opacity = 0;
        }
      }
    }
  }

  function spawnSplash(x, y, z, vx, vy, vz, color) {
    const n = 2 + (Math.random() * 3) | 0;
    for (let i = 0; i < n; i += 1) {
      const s = allocSplash();
      if (!s) break;
      s.x = x + (Math.random() - 0.5) * 0.03;
      s.y = y + 0.01;
      s.z = z + (Math.random() - 0.5) * 0.03;
      // Rebound upward + outward
      s.vx = vx * 0.25 + (Math.random() - 0.5) * 0.55;
      s.vy = Math.abs(vy) * 0.35 + 0.35 + Math.random() * 0.45;
      s.vz = vz * 0.25 + (Math.random() - 0.5) * 0.55;
      s.life = 0.28 + Math.random() * 0.25;
      s.age = 0;
      s.mesh.material.color.setHex(color);
      s.mesh.material.emissive.setHex(color);
      s.mesh.visible = true;
    }
  }

  function triggerRipple(x, y, z, color) {
    ripple.position.set(x, y + 0.002, z);
    ripple.material.color.setHex(color);
    rippleStrength = Math.min(1, rippleStrength + 0.45);
    rippleT = 0;
    ripple.visible = true;
  }

  function clearFluid() {
    for (const p of parcels) {
      deactivateFluid(p);
      p.mesh.visible = false;
      p.mesh.material.opacity = 0;
    }
    for (const s of splashes) {
      deactivateFluid(s);
      s.mesh.visible = false;
      s.mesh.material.opacity = 0;
    }
    ripple.visible = false;
    ripple.material.opacity = 0;
    rippleStrength = 0;
    emitCarry = 0;
  }

  function showLoadingMolecule(label) {
    clearMolecule();
    molecule = new THREE.Group();
    molecule.name = 'chem-molecule';
    
    // 1. Central glowing nucleus core
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 24, 24),
      new THREE.MeshStandardMaterial({ 
        color: 0x0284c7, 
        emissive: 0x38bdf8,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.1,
      })
    );
    molecule.add(core);

    // 2. Outer rotating wireframe quantum icosahedron
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshBasicMaterial({ 
        color: 0x38bdf8, 
        wireframe: true, 
        transparent: true, 
        opacity: 0.75 
      })
    );
    molecule.add(orb);

    // 3. Three orbiting electron rings (tilted X/Y/Z)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.85,
    });
    
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.005, 12, 48), ringMat);
    ring1.rotation.x = Math.PI * 0.35;
    molecule.add(ring1);

    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.005, 12, 48), ringMat);
    ring2.rotation.y = Math.PI * 0.35;
    molecule.add(ring2);

    const ring3 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.005, 12, 48), ringMat);
    ring3.rotation.z = Math.PI * 0.35;
    molecule.add(ring3);

    // 4. Glowing electron particles on the rings
    const eMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 16), eMat);
    e1.position.set(0.22, 0, 0);
    ring1.add(e1);

    const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 16), eMat);
    e2.position.set(0, 0.22, 0);
    ring2.add(e2);

    const e3 = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 16), eMat);
    e3.position.set(0, 0, 0.22);
    ring3.add(e3);

    molecule.userData.isLoading = true;
    molecule.userData.ring1 = ring1;
    molecule.userData.ring2 = ring2;
    molecule.userData.ring3 = ring3;
    
    molecule.position.set(0, 0.42, 0);
    molecule.scale.setScalar(1.0);
    molecule.visible = true;
    pedestal.visible = true;
    pedestal.add(molecule);
    try { getMoleculePanel().hide(); } catch { /* ignore */ }
  }

  function showMoleculeFromSdf(sdf, formula) {
    // Always place molecule on the island pedestal (in-scene), never a DOM white box.
    clearMolecule();
    try {
      const opts = {
        onToggle: (newMol) => { molecule = newMol; }
      };
      if (sdf && String(sdf).length > 20) {
        molecule = createMoleculeMesh(THREE, sdf, opts);
      } else {
        molecule = createFallbackMolecule(THREE, formula, opts);
      }
    } catch (err) {
      console.warn('[chem] molecule mesh failed', err);
      molecule = createFallbackMolecule(THREE, formula, { onToggle: (newMol) => { molecule = newMol; } });
    }
    // Sit clearly above pedestal ring so it is visible from sitting edge
    molecule.position.set(0, 0.42, 0);
    molecule.scale.setScalar(1.0);
    molecule.visible = true;
    molecule.userData.role = 'chem_molecule';
    molecule.userData.interactive = true;
    
    // Tag all meshes inside molecule as interactive
    molecule.traverse((child) => {
      if (child.isMesh) {
        child.userData.role = 'chem_molecule';
        child.userData.interactive = true;
      }
    });

    pedestal.visible = true;
    pedestal.add(molecule);
    try { getMoleculePanel().hide(); } catch { /* ignore */ }
  }

  function clearMolecule() {
    try { getMoleculePanel().hide(); } catch { /* ignore */ }
    if (!molecule) return;
    pedestal.remove(molecule);
    molecule.traverse?.((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose?.());
      }
    });
    molecule = null;
  }

  function getPickables() {
    return [cupA, cupB];
  }

  function cupByKind(kind) {
    return kind === 'A' ? cupA : cupB;
  }

  let isDimmed = false;
  function setDimmed(dimmed) {
    dimmed = !!dimmed;
    isDimmed = dimmed;

    [cupA, cupB].forEach((cup) => {
      cup.userData.interactive = !dimmed;
      if (cup.userData.hit) cup.userData.hit.userData.interactive = !dimmed;
      if (cup.userData.labelHit) {
        cup.userData.labelHit.userData.interactive = !dimmed;
        cup.userData.labelHit.visible = !dimmed;
      }
      if (cup.userData.label) {
        cup.userData.label.visible = !dimmed;
      }
    });

    root.traverse((obj) => {
      if ((obj.isMesh || obj.isSprite) && obj.material) {
        if (obj === cupA.userData.hit || obj === cupB.userData.hit ||
            obj === cupA.userData.labelHit || obj === cupB.userData.labelHit ||
            obj === cupA.userData.label || obj === cupB.userData.label) {
          return;
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          if (mat.userData._origOpacity === undefined) {
            mat.userData._origOpacity = mat.opacity;
          }
          mat.opacity = dimmed ? mat.userData._origOpacity * 0.25 : mat.userData._origOpacity;
        });
      }
    });
  }

  root.userData.setDimmed = setDimmed;

  // init empty visuals
  applyCupVisual('A');
  applyCupVisual('B');

  return {
    root,
    cupA,
    cupB,
    pedestal,
    state,
    get molecule() { return molecule; },
    get pour() { return pour; },
    get drag() { return drag; },
    assignReagent,
    clearCup,
    resetAll,
    componentsList,
    beginDrag,
    updateDrag,
    endDrag,
    startPour,
    update,
    showLoadingMolecule,
    showMoleculeFromSdf,
    clearMolecule,
    getPickables,
    cupByKind,
    homeA,
    homeB,
    setDimmed,
    detectReaction,
    triggerReactionEffect,
    applyExternalReaction,
  };
}

function emptyCupState() {
  return { reagents: [], fill: 0, color: 0x38bdf8, formula: '', reactionEffervescence: 0, lastReaction: null };
}

function makeCup(THREE, kind, tint, accent) {
  const g = new THREE.Group();
  g.name = `chem-cup-${kind}`;
  g.userData.kind = kind;
  g.userData.role = kind === 'A' ? 'chem_cup_a' : 'chem_cup_b';
  g.userData.interactive = true;
  g.userData.pick = kind;

  const rTop = 0.18;
  const rBot = 0.16;
  const h = 0.48;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, 28, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xd0e6f5,
      transparent: true,
      opacity: 0.28,
      roughness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  wall.position.y = 0.08 + h / 2;
  g.add(wall);

  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(rBot - 0.01, rBot, 0.03, 24),
    new THREE.MeshStandardMaterial({
      color: 0xb0cce0,
      transparent: true,
      opacity: 0.4,
      roughness: 0.15,
    }),
  );
  bottom.position.y = 0.1;
  g.add(bottom);

  // Liquid group counter-rotates so free surface stays world-horizontal when cup tips
  const liqGroup = new THREE.Group();
  liqGroup.name = `chem-liq-${kind}`;
  g.add(liqGroup);
  g.userData.liqGroup = liqGroup;

  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(rBot - 0.025, rBot - 0.03, 0.28, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: tint,
      emissive: tint,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0,
      roughness: 0.18,
      metalness: 0.05,
      depthWrite: false,
    }),
  );
  liquid.position.y = 0.22;
  liquid.visible = false;
  liqGroup.add(liquid);
  g.userData.liquid = liquid;
  g.userData.liqBaseY = 0.1;
  g.userData.liqMaxH = 0.32;

  const surf = new THREE.Mesh(
    new THREE.CircleGeometry(rBot - 0.03, 28),
    new THREE.MeshStandardMaterial({
      color: tint,
      emissive: tint,
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0,
      roughness: 0.08,
      metalness: 0.15,
      depthWrite: true,
    }),
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = 0.38;
  surf.visible = false;
  liqGroup.add(surf);
  g.userData.surf = surf;

  // Meniscus ring (subtle contact line)
  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(rBot - 0.035, 0.006, 6, 24),
    new THREE.MeshStandardMaterial({
      color: tint,
      emissive: tint,
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0,
      roughness: 0.25,
      depthWrite: false,
    }),
  );
  meniscus.rotation.x = Math.PI / 2;
  meniscus.position.y = 0.38;
  meniscus.visible = false;
  liqGroup.add(meniscus);
  g.userData.meniscus = meniscus;

  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.22, 0.04, 20),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.4 }),
  );
  stand.position.y = 0.02;
  g.add(stand);

  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop + 0.04, rBot + 0.04, h + 0.12, 14),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  hit.position.y = 0.08 + h / 2;
  hit.userData.role = g.userData.role;
  hit.userData.interactive = true;
  hit.userData.kind = kind;
  g.add(hit);
  g.userData.hit = hit;

  // Dedicated 3D recognition zone for black label bar (enlarged, placed directly above beaker)
  const labelHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.22, 0.20),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  labelHit.position.set(0, 0.64, 0);
  const labelRole = kind === 'A' ? 'chem_cup_a_label' : 'chem_cup_b_label';
  labelHit.userData.role = labelRole;
  labelHit.userData.interactive = true;
  labelHit.userData.kind = kind;
  labelHit.userData.isLabel = true;
  g.add(labelHit);
  g.userData.labelHit = labelHit;

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.26, 28),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.015;
  g.add(halo);
  g.userData.halo = halo;

  // Label sprite placeholder — updated via setCupLabel
  g.userData.label = null;

  return g;
}

/**
 * @param {any} cup
 * @param {number} level
 * @param {number} color
 * @param {{ tiltZ?: number, slosh?: number, ripple?: number }} [opts]
 */
function setCupLevel(cup, level, color, opts = {}) {
  const liq = cup.userData.liquid;
  const surf = cup.userData.surf;
  const meniscus = cup.userData.meniscus;
  const liqGroup = cup.userData.liqGroup;
  if (!liq || !surf) return;
  const t = Math.max(0, Math.min(1, level));
  const tiltZ = opts.tiltZ ?? cup.rotation.z ?? 0;

  if (t <= 0.01) {
    liq.visible = false;
    surf.visible = false;
    meniscus.visible = false;
    return;
  }

  liq.visible = true;
  surf.visible = true;
  meniscus.visible = true;

  const maxH = cup.userData.liqMaxH ?? 0.32;
  const baseY = cup.userData.liqBaseY ?? 0.1;
  const h = maxH * t;

  const slosh = opts.slosh ?? 0;
  const ripple = opts.ripple ?? 0;
  const sloshY = Math.sin(slosh * 6) * 0.015;
  const rippleY = Math.sin(ripple * 18) * 0.008;

  // Keep liquid group aligned with cup body so liquid stays inside vessel
  liqGroup.rotation.z = 0;

  liq.position.set(0, baseY + h / 2, 0);
  liq.scale.set(1, Math.max(0.04, h / 0.28), 1);
  liq.rotation.z = 0;

  const surfY = baseY + h + sloshY + rippleY;
  surf.position.set(0, surfY, 0);
  surf.rotation.set(-Math.PI / 2, 0, -tiltZ, 'ZXY');

  if (meniscus) {
    meniscus.position.set(0, surfY, 0);
    meniscus.rotation.set(Math.PI / 2, 0, -tiltZ, 'ZXY');
    meniscus.material.color.setHex(color);
    meniscus.material.emissive.setHex(color);
    meniscus.material.opacity = 0.45;
  }

  liq.material.color.setHex(color);
  liq.material.emissive.setHex(color);
  liq.material.opacity = 0.78;
  surf.material.color.setHex(color);
  surf.material.emissive.setHex(color);
  surf.material.opacity = 0.88;
}

function setCupLabel(THREE, cup, text) {
  if (cup.userData.label) {
    cup.remove(cup.userData.label);
    cup.userData.label.material?.map?.dispose?.();
    cup.userData.label.material?.dispose?.();
    cup.userData.label = null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  roundRectPath(ctx, 8, 8, 240, 48, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = '600 28px "Outfit", "Noto Sans SC", system-ui, sans-serif';
  ctx.fillStyle = '#ecfdf5';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text || '').slice(0, 16), 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.72, 0.18, 1);
  spr.position.set(0, 0.64, 0);
  const labelRole = cup.userData.kind === 'A' ? 'chem_cup_a_label' : 'chem_cup_b_label';
  spr.userData.role = labelRole;
  spr.userData.interactive = true;
  spr.userData.kind = cup.userData.kind;
  const isDimmed = cup.userData.interactive === false;
  spr.visible = !isDimmed;
  cup.add(spr);
  cup.userData.label = spr;
  if (cup.userData.labelHit) {
    cup.userData.labelHit.position.set(0, 0.64, 0);
    cup.userData.labelHit.visible = !isDimmed;
    cup.userData.labelHit.userData.role = labelRole;
    cup.userData.labelHit.userData.interactive = !isDimmed;
    cup.userData.labelHit.userData.kind = cup.userData.kind;
    cup.userData.labelHit.userData.isLabel = true;
  }
}

function snapHome(cup, home) {
  cup.position.copy(home);
  cup.rotation.set(0, 0, 0);
  if (cup.userData.halo) cup.userData.halo.material.opacity = 0;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
