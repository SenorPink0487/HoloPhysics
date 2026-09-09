/**
 * Chemistry station — center island apparatus (two cups + molecule pedestal).
 * Mirrors optics/thermo equipment contract: setMode + createRuntime + pick roles.
 */

import { createChemCupRig } from '../../chem/cupRig.js';
import { getReagent } from '../../chem/reagentCatalog.js';
import {
  createEquipmentRuntime,
  getLeafPickSet,
  estimateObjectBytes,
} from '../../runtime/experimentRuntime.js';

const CHEM_EXP_IDS = Object.freeze(['reagent-mix']);

export function createStationEquipment(ctx) {
  const { THREE, constants } = ctx;
  const root = new THREE.Group();
  root.name = 'chem-station';
  // Island table top ≈ y=0.95; place rig on the center island surface.
  const islandY = constants?.ISLAND_Y ?? 1.0;
  root.position.set(0, islandY, 0.4);

  const rig = createChemCupRig(THREE, { accent: 0x94a3b8 });
  root.add(rig.root);
  // Always show island apparatus in chem mode (like thermo showcase props).
  rig.root.visible = true;

  /** @type {string | null} */
  let activeId = null;
  const animators = [];

  animators.push((_t, dt) => {
    rig.update(typeof dt === 'number' ? dt : 1 / 60);
  });

  function markPick(object, role) {
    if (!object) return null;
    object.userData ||= {};
    object.userData.interactive = true;
    object.userData.role = role;
    return object;
  }

  function pickSet() {
    const list = [
      markPick(rig.cupA, 'chem_cup_a'),
      markPick(rig.cupB, 'chem_cup_b'),
      markPick(rig.cupA?.userData?.hit, 'chem_cup_a'),
      markPick(rig.cupB?.userData?.hit, 'chem_cup_b'),
      markPick(rig.cupA?.userData?.labelHit, 'chem_cup_a_label'),
      markPick(rig.cupB?.userData?.labelHit, 'chem_cup_b_label'),
      markPick(rig.cupA?.userData?.label, 'chem_cup_a_label'),
      markPick(rig.cupB?.userData?.label, 'chem_cup_b_label'),
    ];
    if (rig.molecule) {
      list.push(markPick(rig.molecule, 'chem_molecule'));
      rig.molecule.traverse((child) => {
        if (child.isMesh) list.push(markPick(child, 'chem_molecule'));
      });
    }
    [rig.cupA, rig.cupB].forEach((cup) => {
      if (!cup) return;
      const role = cup.userData?.role;
      const kind = cup.userData?.kind;
      cup.traverse((child) => {
        if (child.isMesh || child.isSprite) {
          child.userData ||= {};
          const isLabelNode = child === cup.userData?.label || child === cup.userData?.labelHit || child.userData?.isLabel || child.userData?.role?.includes('label');
          if (isLabelNode) {
            child.userData.role = kind === 'A' ? 'chem_cup_a_label' : 'chem_cup_b_label';
            child.userData.isLabel = true;
          } else if (!child.userData.role) {
            child.userData.role = role;
          }
          child.userData.interactive = true;
          child.userData.kind = kind;
          list.push(child);
        }
      });
    });
    return list.filter(Boolean);
  }

  function setMode(expId) {
    const next = CHEM_EXP_IDS.includes(expId) ? expId : null;
    activeId = next;
    // Keep cups visible once the station is live; hide only on hard shutdown.
    rig.root.visible = true;
    // Re-assert pick roles after mode changes (same as thermo markPick).
    pickSet();
    return true;
  }

  function createRuntime(expId) {
    if (!CHEM_EXP_IDS.includes(expId)) return null;
    return createEquipmentRuntime({
      id: expId,
      root,
      prepare: async (_ctx, signal) => {
        if (signal?.aborted) {
          const err = new Error('Operation aborted');
          err.name = 'AbortError';
          throw err;
        }
        pickSet();
        rig.root.visible = true;
      },
      prepareRoot: () => root,
      activate: () => {
        setMode(expId);
      },
      mount: () => {
        rig.root.visible = true;
        if (rig.root.parent !== root) root.add(rig.root);
      },
      suspend: () => {
        // Physics thermo suspends apparatus; chem keeps island props visible
        // but clears active id so re-activate re-binds picks.
        activeId = null;
      },
      unmount: () => {
        activeId = null;
      },
      getPickSet: () => pickSet(),
      estimateBytes: () => estimateObjectBytes(root),
      dispose: () => {
        activeId = null;
      },
    });
  }

  return {
    root,
    equipment: {
      stationId: 'chem',
      createRuntime,
      prepareExperiment: () => pickSet(),
      setMode,
      suspend() {
        activeId = null;
      },
      shutdown() {
        activeId = null;
      },
      resume() {
        if (activeId) setMode(activeId);
        else setMode('reagent-mix');
      },
      showcase() {
        rig.root.visible = true;
        pickSet();
      },
      update() {},
      updateState() {},
      getPickSet: pickSet,
      reset(expId) {
        rig.resetAll();
        if (expId) setMode(expId);
      },
      rig,
      assignReagent(kind, reagentId) {
        const r = typeof reagentId === 'string' ? getReagent(reagentId) : reagentId;
        return rig.assignReagent(kind, r);
      },
      // Thermo-style: host calls pour; rig owns animation.
      pour(from, to) {
        return rig.startPour(from, to);
      },
      beginDrag: (...args) => rig.beginDrag(...args),
      updateDrag: (...args) => rig.updateDrag(...args),
      endDrag: () => rig.endDrag(),
      startPour: (from, to) => rig.startPour(from, to),
      resetAll: () => rig.resetAll(),
      componentsList: () => rig.componentsList(),
      showMoleculeFromSdf: (sdf, formula) => rig.showMoleculeFromSdf(sdf, formula),
      showLoadingMolecule: (label) => rig.showLoadingMolecule(label),
      clearMolecule: () => rig.clearMolecule(),
      getCupState: () => ({
        A: { ...rig.state.A, reagents: rig.state.A.reagents.map((r) => ({ ...r })) },
        B: { ...rig.state.B, reagents: rig.state.B.reagents.map((r) => ({ ...r })) },
      }),
      cupByKind: (kind) => rig.cupByKind(kind),
      mouseDrag: { movementX: 0, movementY: 0, shiftKey: false, holdLMB: false },
    },
    refs: { rig },
    animators,
  };
}

export default createStationEquipment;
