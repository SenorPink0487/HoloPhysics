import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMULA_CATALOG,
  drawFormulaBoard,
  pickFormulaBoard,
} from '../src/formulaBoard.js';

test('FORMULA_CATALOG has 4 physical stations with 22 real project experiments', () => {
  assert.equal(FORMULA_CATALOG.stations.length, 4);
  const stationIds = FORMULA_CATALOG.stations.map((s) => s.id);
  assert.deepEqual(stationIds, ['mechanics', 'electro', 'optics', 'thermo']);

  assert.equal(FORMULA_CATALOG.items.length, 22);

  const mechanicsItems = FORMULA_CATALOG.items.filter((it) => it.cat === 'mechanics');
  assert.equal(mechanicsItems.length, 6);

  const electroItems = FORMULA_CATALOG.items.filter((it) => it.cat === 'electro');
  assert.equal(electroItems.length, 6);

  const opticsItems = FORMULA_CATALOG.items.filter((it) => it.cat === 'optics');
  assert.equal(opticsItems.length, 5);

  const thermoItems = FORMULA_CATALOG.items.filter((it) => it.cat === 'thermo');
  assert.equal(thermoItems.length, 5);
});

test('FORMULA_CATALOG items contain all required structured fields', () => {
  for (const item of FORMULA_CATALOG.items) {
    assert.ok(item.id, `item ${item.id} must have id`);
    assert.ok(item.cat, `item ${item.id} must have cat`);
    assert.ok(item.expId, `item ${item.id} must have expId`);
    assert.ok(item.expName, `item ${item.id} must have expName`);
    assert.ok(item.code, `item ${item.id} must have code`);
    assert.ok(item.title, `item ${item.id} must have title`);
    assert.ok(item.formula, `item ${item.id} must have formula`);
    assert.ok(item.concept, `item ${item.id} must have concept`);
    assert.ok(item.symbols, `item ${item.id} must have symbols`);
    assert.ok(item.labLink, `item ${item.id} must have labLink`);
  }
});

function createMockCtx() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    createLinearGradient() {
      return { addColorStop() {} };
    },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    stroke() {},
    fill() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    measureText(text) {
      return { width: String(text || '').length * 10 };
    },
    save() {},
    restore() {},
    clip() {},
  };
}

test('drawFormulaBoard Level 1 (Home View) renders 4 physical station cards with direct entry support', () => {
  const ctx = createMockCtx();
  const W = 1920;
  const H = 900;

  const result = drawFormulaBoard(ctx, W, H, { stationId: null, selectedId: null, activeStationId: 'mechanics' });
  assert.ok(result.hits.length > 0);

  // All 4 station cards have station action for 1-click entry
  const stationIds = ['mechanics', 'electro', 'optics', 'thermo'];
  for (const sId of stationIds) {
    const sHits = result.hits.filter((h) => h.stationId === sId);
    assert.ok(sHits.some((h) => h.action === 'station'), `station ${sId} must have station direct entry action`);
  }
});

test('drawFormulaBoard Level 2 (Station Sub-page) renders experiment cards and back-home', () => {
  const ctx = createMockCtx();
  const W = 1920;
  const H = 900;

  const result = drawFormulaBoard(ctx, W, H, { stationId: 'mechanics', selectedId: null });
  assert.ok(result.hits.length > 0);

  const backHome = result.hits.find((h) => h.action === 'home');
  assert.ok(backHome, 'must have back to home button');

  const expHits = result.hits.filter((h) => h.action === 'select');
  assert.equal(expHits.length, 6, 'mechanics station must display 6 experiments');
});

test('drawFormulaBoard Level 3 (Experiment Detail) renders detail view with back button', () => {
  const ctx = createMockCtx();
  const W = 1920;
  const H = 900;

  const result = drawFormulaBoard(ctx, W, H, { stationId: 'mechanics', selectedId: 'pendulum' });
  const backStation = result.hits.find((h) => h.action === 'back');
  assert.ok(backStation, 'must have back button in detail mode');
});

test('pickFormulaBoard picks station card in Home view and enters directly', () => {
  const ctx = createMockCtx();
  const W = 1920;
  const H = 900;

  const result = drawFormulaBoard(ctx, W, H, { stationId: null, selectedId: null, activeStationId: 'mechanics' });
  const electroCard = result.hits.find((h) => h.id === 'station-electro');
  assert.ok(electroCard);

  // Pick center of electro card
  const u = (electroCard.x + electroCard.w / 2) / W;
  const v = 1 - (electroCard.y + electroCard.h / 2) / H;

  const picked = pickFormulaBoard(u, v, W, H, result.hits);
  assert.ok(picked);
  assert.equal(picked.action, 'station');
  assert.equal(picked.stationId, 'electro');
});

test('parseFormulaAst correctly identifies fractions, square roots and Greek symbols', async () => {
  const { parseFormulaAst, measureFormulaAst, drawFormulaCardGroup } = await import('../src/physicsFormula.js');
  const ctx = createMockCtx();

  const ast = parseFormulaAst('h=\\frac{1}{2}gt^{2}；v=\\sqrt{2gh}');
  assert.ok(ast.length > 0);
  const frac = ast.find((n) => n.type === 'frac');
  assert.ok(frac, 'must parse \\frac node');
  assert.ok(frac.num.length > 0, 'fraction must have numerator');
  assert.ok(frac.den.length > 0, 'fraction must have denominator');

  const m = measureFormulaAst(ctx, ast, 24);
  assert.ok(m.width > 0);
  assert.ok(m.height > 0);

  // drawFormulaCardGroup should execute smoothly on mock ctx
  drawFormulaCardGroup(ctx, 'h=\\frac{1}{2}gt^{2}；v=\\sqrt{2gh}', 0, 0, 600, 200, { themeColor: '#0ea5e9' });
});

test('electromagnetism formulas in FORMULA_CATALOG use SI standard units in symbols', () => {
  const electroItems = FORMULA_CATALOG.items.filter((it) => it.cat === 'electro');
  const hallEffect = electroItems.find((it) => it.expId === 'hall_effect');
  assert.ok(hallEffect.symbols.includes('V/(A·T)'));
  assert.ok(hallEffect.symbols.includes('I_s — 霍尔电流 (A)'));
  assert.ok(!hallEffect.symbols.includes('mA'));

  const hallCarrier = electroItems.find((it) => it.expId === 'hall_carrier_demo');
  assert.ok(hallCarrier.symbols.includes('V/(A·T)'));

  const inducedE = electroItems.find((it) => it.expId === 'induced_electric_field');
  assert.ok(inducedE.symbols.includes('T/s'));
});


