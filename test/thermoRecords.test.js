import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThermoRecordRow,
  computeThermoMetrics,
  formatThermoRecordCell,
  thermoCanRecord,
  thermoRecordBlockedReason,
  thermoRecordCaption,
  thermoRecordColumns,
  createHandlers,
} from '../src/experiments/thermo.js';

function context(expId) {
  const state = { expId, stepIndex: 0, data: {}, running: true };
  const toasts = [];
  const handlers = createHandlers({
    state,
    equipment: {
      thermo: {
        updateState: () => {},
        setMode: () => {},
        reset: () => {},
      },
    },
    toast: (msg) => toasts.push(msg),
    pushHud: () => {},
    advanceStep: () => {},
    setStep: (id) => {
      const steps = ['set_volume', 'set_temperature', 'record'];
      const idx = steps.indexOf(id);
      if (idx > state.stepIndex) state.stepIndex = idx;
    },
    currentStep: () => ({ id: 'set_temperature' }),
    currentExp: () => null,
    currentStation: () => null,
  });
  state.data = handlers.initData(expId);
  return { state, handlers, toasts };
}

test('thermo metrics and columns are defined for every rig', () => {
  const ids = ['calorimetry', 'convection', 'heat-conduction', 'ideal-gas', 'thermal-expansion'];
  ids.forEach((id) => {
    const { state } = context(id);
    const m = computeThermoMetrics(id, state.data);
    assert.ok(Object.keys(m).length > 2, id);
    const cols = thermoRecordColumns(id);
    assert.ok(cols.length >= 4, id);
    assert.ok(thermoRecordCaption(id).length > 8, id);
    const row = buildThermoRecordRow(id, state.data);
    assert.equal(row.expId, id);
    assert.ok(row.metrics);
    cols.forEach((c) => {
      const cell = formatThermoRecordCell(id, row, c.key, 0);
      assert.equal(typeof cell, 'string');
    });
  });
});

test('calorimetry blocks record until both liquids are mixed', () => {
  const { state, handlers, toasts } = context('calorimetry');
  assert.equal(thermoCanRecord('calorimetry', state.data), false);
  assert.ok(thermoRecordBlockedReason('calorimetry', state.data).includes('倒入'));
  assert.equal(handlers.onUiAction('thermo-record'), false);
  assert.ok(toasts.at(-1).includes('倒入') || toasts.at(-1).includes('不可'));

  state.data.cupHot = true;
  state.data.cupCold = true;
  state.data.mixProgress = 0.2;
  state.data.tCurrent = 40;
  assert.equal(thermoCanRecord('calorimetry', state.data), false);

  state.data.mixProgress = 0.8;
  assert.equal(thermoCanRecord('calorimetry', state.data), true);
  assert.equal(handlers.onUiAction('thermo-record'), true);
  assert.equal(state.data.records.length, 1);
  assert.ok(state.data.records[0].metrics.teq > 0);
});

test('ideal-gas record writes a comparable row and clear works', () => {
  const { state, handlers } = context('ideal-gas');
  assert.equal(state.data.recordsPanelOpen, false);
  assert.equal(handlers.onUiAction('thermo-record'), true);
  // Writing a row must not force the panel open.
  assert.equal(state.data.recordsPanelOpen, false);
  handlers.onUiAction('thermo-set', { key: 'temperature', value: 450 });
  assert.equal(handlers.onUiAction('thermo-record'), true);
  assert.equal(state.data.records.length, 2);
  const t0 = state.data.records[0].metrics.T;
  const t1 = state.data.records[1].metrics.T;
  assert.ok(t1 > t0);
  assert.equal(handlers.onUiAction('thermo-clear-records'), true);
  assert.equal(state.data.records.length, 0);
  assert.equal(state.data.completed, false);
});

test('records panel opens and closes via action', () => {
  const { state, handlers } = context('convection');
  assert.equal(state.data.recordsPanelOpen, false);
  handlers.onUiAction('thermo-records-panel', { open: true });
  assert.equal(state.data.recordsPanelOpen, true);
  handlers.onUiAction('thermo-records-panel', { open: false });
  assert.equal(state.data.recordsPanelOpen, false);
  handlers.onUiAction('thermo-records-panel', {});
  assert.equal(state.data.recordsPanelOpen, true);
});

