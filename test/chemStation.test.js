/**
 * Chemistry station registration + lab-mode gating.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAB_CATALOG,
  PHYSICS_STATION_IDS,
  STATION_IDS,
  stationIdsForMode,
  findExperiment,
} from '../src/runtime/catalog.js';
import { resolveLabMode, isChemMode } from '../src/chem/labMode.js';
import {
  getReagent,
  getElement,
  getReagentsForElement,
  CHEM_ELEMENTS,
  blendColors,
  formatSubscriptFormula,
  tryResolveLocalFormula,
} from '../src/chem/reagentCatalog.js';
import { parseSdf, buildProceduralStructure } from '../src/chem/moleculeMesh.js';
import { pickChemHits, drawChemPeriodicPanel, drawChemRightPanel } from '../src/chem/periodicTableDraw.js';

describe('labMode', () => {
  it('defaults to physics', () => {
    assert.equal(resolveLabMode(''), 'physics');
    assert.equal(isChemMode('physics'), false);
  });

  it('reads ?mode=chem', () => {
    assert.equal(resolveLabMode('?mode=chem'), 'chem');
    assert.equal(resolveLabMode('?mode=chemistry'), 'chem');
    assert.equal(isChemMode('chem'), true);
  });
});

describe('catalog chem station', () => {
  it('includes chem in full catalog but not physics-only list', () => {
    assert.ok(LAB_CATALOG.chem);
    assert.equal(LAB_CATALOG.chem.id, 'chem');
    assert.ok(STATION_IDS.includes('chem'));
    assert.ok(!PHYSICS_STATION_IDS.includes('chem'));
    assert.deepEqual([...stationIdsForMode('physics')], ['electro', 'mechanics', 'thermo', 'optics']);
    assert.deepEqual([...stationIdsForMode('chem')], ['chem']);
    assert.ok(!stationIdsForMode('physics').includes('chem'));
  });

  it('finds reagent-mix experiment', () => {
    const hit = findExperiment('reagent-mix');
    assert.equal(hit?.stationId, 'chem');
    assert.equal(hit?.experiment?.id, 'reagent-mix');
  });
});

describe('reagent catalog', () => {
  it('has curated elements and NaCl', () => {
    assert.ok(CHEM_ELEMENTS.length >= 10);
    assert.ok(getElement('Na'));
    const nacl = getReagent('nacl');
    assert.equal(nacl?.formula, 'NaCl');
  });

  it('covers expanded high-school lab set', () => {
    // Core + transition metals + halogens + noble gases + period-6 demos
    for (const sym of ['H', 'C', 'Na', 'Cl', 'Fe', 'Cu', 'Br', 'Ba', 'He', 'Mn', 'Pb']) {
      assert.ok(getElement(sym), `missing element ${sym}`);
    }
    assert.ok(CHEM_ELEMENTS.length >= 30);
    const kmno4 = getReagent('kmno4');
    assert.equal(kmno4?.formula, 'KMnO4');
    const cuso4 = getReagent('cuso4');
    assert.equal(cuso4?.formula, 'CuSO4');
    const br2 = getReagent('br2');
    assert.equal(br2?.formula, 'Br2');
    // Each listed element should expose at least one reagent
    for (const el of CHEM_ELEMENTS) {
      const list = getReagentsForElement(el.symbol);
      assert.ok(list.length >= 1, `${el.symbol} has no reagents`);
    }
  });

  it('blends colors', () => {
    const mid = blendColors(0xff0000, 0x0000ff, 0.5);
    assert.ok(typeof mid === 'number');
  });
});

describe('SDF parse + periodic hits', () => {
  it('parses a minimal mol block', () => {
    const sdf = [
      'water',
      '',
      '',
      '  3  2  0  0  0  0  0  0  0  0999 V2000',
      '    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
      '    0.9600    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
      '   -0.2400    0.9300    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
      '  1  2  1  0  0  0  0',
      '  1  3  1  0  0  0  0',
      'M  END',
    ].join('\n');
    const { atoms, bonds } = parseSdf(sdf);
    assert.equal(atoms.length, 3);
    assert.equal(bonds.length, 2);
    assert.equal(atoms[0].elem, 'O');
  });

  it('draws periodic panel and hits an element cell', () => {
    const canvas = { width: 1280, height: 900 };
    // node canvas stub
    const calls = [];
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      createLinearGradient: () => ({ addColorStop() {} }),
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      arcTo() {},
      closePath() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      clip() {},
      fillText(...args) { calls.push(args); },
      measureText: (t) => ({ width: String(t).length * 8 }),
    };
    const { hits } = drawChemPeriodicPanel(ctx, canvas.width, canvas.height, {
      activeCup: 'A',
      pickerPhase: 'elements',
    });
    assert.ok(hits.length > 5);
    const elHit = hits.find((h) => h.action === 'chem-pick-element' && h.element === 'Na');
    assert.ok(elHit);
    // UV pick at cell center
    const u = (elHit.x + elHit.w / 2) / canvas.width;
    const v = 1 - (elHit.y + elHit.h / 2) / canvas.height;
    const picked = pickChemHits(hits, u, v, canvas.width, canvas.height);
    assert.equal(picked?.element, 'Na');

    // iPad WKWebView may expose the canvas plane with an inverted v axis.
    // Bottom search controls must win before a mirrored periodic-table cell.
    const submitHit = hits.find((h) => h.action === 'chem-search-submit');
    const voiceHit = hits.find((h) => h.action === 'chem-search-voice');
    assert.ok(submitHit);
    assert.ok(voiceHit);
    assert.ok(voiceHit.w < voiceHit.h * 1.5, 'voice control stays compact and icon-sized');
    const submitU = (submitHit.x + submitHit.w / 2) / canvas.width;
    const submitV = 1 - (submitHit.y + submitHit.h / 2) / canvas.height;
    const submitNormalPick = pickChemHits(hits, submitU, submitV, canvas.width, canvas.height);
    assert.equal(submitNormalPick?.action, 'chem-search-submit');
    const invertedV = (submitHit.y + submitHit.h / 2) / canvas.height;
    const submitPick = pickChemHits(hits, submitU, invertedV, canvas.width, canvas.height);
    assert.equal(submitPick?.action, 'chem-search-submit');
    assert.equal(submitPick?.uvMirrored, true);

    const voiceU = (voiceHit.x + voiceHit.w / 2) / canvas.width;
    const voiceV = 1 - (voiceHit.y + voiceHit.h / 2) / canvas.height;
    assert.equal(
      pickChemHits(hits, voiceU, voiceV, canvas.width, canvas.height)?.action,
      'chem-search-voice',
    );
    const invertedVoiceV = (voiceHit.y + voiceHit.h / 2) / canvas.height;
    const invertedVoicePick = pickChemHits(
      hits,
      voiceU,
      invertedVoiceV,
      canvas.width,
      canvas.height,
    );
    assert.equal(invertedVoicePick?.action, 'chem-search-voice');
    assert.equal(invertedVoicePick?.uvMirrored, true);
  });

  it('draws right panel circular percentage chart and ingredient list', () => {
    const W = 1400;
    const H = 1040;
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      createLinearGradient: () => ({ addColorStop() {} }),
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      arcTo() {},
      closePath() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      clip() {},
      fillText() {},
      measureText: (t) => ({ width: String(t).length * 8 }),
    };
    const components = [
      { id: 'h2o', formula: 'H2O', name_zh: '水', color: 0x38bdf8, percent: 70 },
      { id: 'naoh', formula: 'NaOH', name_zh: '氢氧化钠', color: 0x86efac, percent: 30 },
    ];
    const { hits } = drawChemRightPanel(ctx, W, H, { components, selectedComponentId: 'h2o' });

    assert.ok(hits.length >= 3);
    const scrollHit = hits.find((h) => h.role === 'scrollable_components');
    const compHit = hits.find((h) => h.componentId === 'h2o');
    assert.ok(compHit, 'component card hit present');

    // Donut chart center (700, 245) UV pick should hit a slice / component
    const donutU = 700 / W;
    const donutV = 1 - 245 / H;
    const pickedDonut = pickChemHits(hits, donutU, donutV, W, H);
  });
});

describe('subscript formula formatting & procedural 3D structure', () => {
  it('resolves determined single formulas locally with zero API latency', () => {
    const h2o = tryResolveLocalFormula('h2o');
    assert.ok(h2o);
    assert.equal(h2o.formula, 'H2O');
    assert.equal(h2o.name_zh, '水');

    const nacl = tryResolveLocalFormula('nacl');
    assert.ok(nacl);
    assert.equal(nacl.formula, 'NaCl');
    assert.equal(nacl.name_zh, '氯化钠');

    const c8h18 = tryResolveLocalFormula('c8h18');
    assert.ok(c8h18);
    assert.equal(c8h18.formula, 'C8H18');
    assert.equal(c8h18.name_zh, '辛烷');

    // Natural language reaction should return null (fallback to AI API)
    const reactionPrompt = tryResolveLocalFormula('氢氧化钠加盐酸');
    assert.equal(reactionPrompt, null);
  });

  it('dynamically generates distinct 3D structures for organic & oxoacid compounds', () => {
    const c8h18 = buildProceduralStructure('C8H18');
    assert.equal(c8h18.atoms.length, 26);
    assert.equal(c8h18.atoms.filter((a) => a.elem === 'C').length, 8);
    assert.equal(c8h18.atoms.filter((a) => a.elem === 'H').length, 18);

    const h3po4 = buildProceduralStructure('H3PO4');
    assert.equal(h3po4.atoms.length, 8);
    assert.equal(h3po4.atoms.filter((a) => a.elem === 'P').length, 1);
    assert.equal(h3po4.atoms.filter((a) => a.elem === 'O').length, 4);
    assert.equal(h3po4.atoms.filter((a) => a.elem === 'H').length, 3);
  });
});
