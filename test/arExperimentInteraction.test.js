import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createHandlers as createElectroHandlers, analyzeHallWiring, exportHallDataReport } from '../src/experiments/electro.js';
import { drawHoloScreen, pickHoloScreen } from '../src/holoScreen.js';
import { formatExperimentData } from '../src/ui/experimentDataSummary.js';

function createContext({ expId, stepId, equipment }) {
  const state = { expId, stepIndex: 0, data: {} };
  let activeStep = stepId;
  return {
    state,
    equipment,
    toast: () => {},
    pushHud: () => {},
    advanceStep: () => {},
    setStep: (id) => { activeStep = id; },
    currentStep: () => ({ id: activeStep }),
    currentExp: () => null,
    currentStation: () => null,
    get stepId() { return activeStep; },
  };
}

test('AR tracking loss cancels an unfinished Hall terminal wire', () => {
  let cancelled = 0;
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'configure',
    equipment: {
      electro: {
        startHallWirePreview: () => {},
        cancelHallWirePreview: () => { cancelled += 1; },
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  const terminal = { userData: { role: 'hall_terminal_output', portId: 'im_red' } };
  handlers.beginManipulation(terminal);
  assert.equal(ctx.state.data.terminalDragFrom, 'im_red');
  handlers.endManipulation(terminal, { cancelled: true });
  assert.equal(ctx.state.data.terminalDragFrom, null);
  assert.equal(ctx.state.data.wires.length, 0);
  assert.equal(cancelled, 1);
});

test('Hall terminal pinch commits a wire when release is over the second port', () => {
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'configure',
    equipment: {
      electro: {
        startHallWirePreview: () => {},
        updateHallWirePreview: () => 'hh_red',
        cancelHallWirePreview: () => {},
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  const from = { userData: { role: 'hall_terminal_output', portId: 'out_red' } };
  const to = { userData: { role: 'hall_terminal_helmholtz', portId: 'hh_red' } };

  assert.equal(handlers.beginManipulation(from), true);
  assert.equal(ctx.state.data.terminalDragFrom, 'out_red');
  assert.equal(handlers.endManipulation(from, { hoverTarget: to }), true);
  assert.deepEqual(ctx.state.data.wires, [['out_red', 'hh_red']]);
});

test('AR Hall wire preview follows the current fingertip ray and hover port', () => {
  let previewArgs = null;
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'configure',
    equipment: {
      electro: {
        startHallWirePreview: () => {},
        updateHallWirePreview: (...args) => {
          previewArgs = args;
          return 'hh_red';
        },
        cancelHallWirePreview: () => {},
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  const from = { userData: { role: 'hall_terminal_output', portId: 'out_red' } };
  const hover = { userData: { role: 'hall_terminal_helmholtz', portId: 'hh_red' } };
  const fingertipRay = { ray: { origin: {}, direction: {} } };

  handlers.beginManipulation(from);
  assert.equal(handlers.updateManipulation(from, {
    hoverTarget: hover,
    raycaster: fingertipRay,
  }), true);
  assert.deepEqual(previewArgs, ['out_red', fingertipRay, 'hh_red']);
  assert.equal(ctx.state.data.terminalSnapPort, 'hh_red');
});

test('Hall console clicks do not record unless the explicit record action is used', () => {
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'scan',
    equipment: {
      electro: {
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');

  const consoleTarget = { userData: { role: 'hall_console' } };
  assert.equal(handlers.interact(consoleTarget, 0, { id: 'scan' }), false);
  assert.equal(ctx.state.data.records.length, 0);

  const recordAction = { userData: { role: 'ui_action' } };
  assert.equal(handlers.interact(recordAction, 0, { id: 'scan' }), true);
  assert.equal(ctx.state.data.records.length, 1);
});

test('Hall data-table wheel and drag scroll move the record viewport', () => {
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'scan',
    equipment: {
      electro: {
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  // Seed more rows than a typical viewport so scrolling is meaningful.
  ctx.state.data.records = Array.from({ length: 20 }, (_, i) => ({
    target: 'helmholtz',
    pos: i,
    vh: i * 0.1,
    b: i * 0.01,
    Im: 0.5,
    Is: 5,
  }));
  ctx.state.data.tableScrollAuto = true;
  ctx.state.data.showCurve = false;

  const display = {
    userData: {
      type: 'holo_display',
      role: 'holo_display',
      hitRegions: [{
        action: 'hall-scroll-table',
        role: 'scrollable_table',
        maxRows: 8,
        maxStart: 12,
        rowH: 30,
      }],
    },
  };
  const tablePick = display.userData.hitRegions[0];

  // Wheel up from the auto-pinned bottom should reveal older rows.
  assert.equal(handlers.onWheel(-120, display, tablePick), true);
  assert.equal(ctx.state.data.tableScrollAuto, false);
  assert.ok(ctx.state.data.tableScrollTop < 12);

  const afterUp = ctx.state.data.tableScrollTop;
  // Wheel down moves back toward the newest rows.
  assert.equal(handlers.onWheel(120, display, tablePick), true);
  assert.ok(ctx.state.data.tableScrollTop > afterUp);

  // Drag-style pixel scroll (finger up → later rows).
  const beforeDrag = ctx.state.data.tableScrollTop;
  assert.equal(handlers.onUiAction('hall-scroll-table', {
    deltaPx: 90,
    rowH: 30,
    maxRows: 8,
    maxStart: 12,
  }), true);
  assert.equal(ctx.state.data.tableScrollTop, Math.min(12, beforeDrag + 3));
});

test('AR pinch-drag on the Hall data table scrolls like fullscreen drag', () => {
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'scan',
    equipment: {
      electro: {
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  ctx.state.data.records = Array.from({ length: 20 }, (_, i) => ({
    target: 'helmholtz', pos: i, vh: 0, b: 0, Im: 0.5, Is: 5,
  }));
  ctx.state.data.showCurve = false;
  ctx.state.data.tableScrollAuto = true;

  const tablePick = {
    action: 'hall-scroll-table',
    role: 'scrollable_table',
    maxRows: 8,
    maxStart: 12,
    rowH: 30,
    scrollable: true,
  };
  const display = {
    userData: {
      type: 'holo_display',
      role: 'holo_display',
      hitRegions: [tablePick],
      pickFromRay: () => tablePick,
    },
  };

  assert.equal(handlers.beginManipulation(display, { pick: tablePick, time: 0 }), true);
  assert.equal(!!ctx.state.data.tableScrollDrag?.armed, true);

  // Hand moves down on screen (positive dy) → earlier rows (leave auto bottom).
  handlers.updateManipulation(display, { dy: 120, dragged: true });
  assert.equal(ctx.state.data.tableScrollAuto, false);
  assert.ok(ctx.state.data.tableScrollTop < 12);

  const afterRevealOlder = ctx.state.data.tableScrollTop;
  // Hand moves up (negative dy) → later rows again.
  handlers.updateManipulation(display, { dy: -90, dragged: true });
  assert.ok(ctx.state.data.tableScrollTop > afterRevealOlder);

  assert.equal(handlers.endManipulation(display, { dragged: true }), true);
  assert.equal(ctx.state.data.tableScrollDrag, null);
});

test('Hall curve fitting action toggles showCurve and showFit with validation', () => {
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'scan',
    equipment: {
      electro: {
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');

  // Without enough records, hall-fit and hall-chart refuse with toast
  assert.equal(handlers.onUiAction('hall-fit'), true);
  assert.equal(ctx.state.data.showCurve, false);

  assert.equal(ctx.state.data.showFit, false);

  // Seed 2 records
  ctx.state.data.records = [
    { target: 'helmholtz', pos: -2, vh: 0.2, b: 0.1, Im: 0.5, Is: 5 },
    { target: 'helmholtz', pos: 0, vh: 0.5, b: 0.25, Im: 0.5, Is: 5 },
  ];

  // Clicking hall-chart opens scatter plot with showFit = false by default
  assert.equal(handlers.onUiAction('hall-chart'), true);
  assert.equal(ctx.state.data.showCurve, true);
  assert.equal(ctx.state.data.showFit, false);

  // Clicking hall-fit activates curve fitting
  assert.equal(handlers.onUiAction('hall-fit'), true);
  assert.equal(ctx.state.data.showCurve, true);
  assert.equal(ctx.state.data.showFit, true);

  // Clicking hall-fit again toggles fitting curve off
  assert.equal(handlers.onUiAction('hall-fit'), true);
  assert.equal(ctx.state.data.showCurve, true);
  assert.equal(ctx.state.data.showFit, false);

  // Return to record table via hall-chart
  assert.equal(handlers.onUiAction('hall-chart'), true);
  assert.equal(ctx.state.data.showCurve, false);
});

test('Hall export report places data table before chart and models single-coil correctly', () => {
  const globalWindow = globalThis.window;
  let openedHtml = null;
  globalThis.window = {
    open: () => ({
      document: {
        open: () => {},
        write: (html) => { openedHtml = html; },
        close: () => {},
        querySelector: () => null,
      },
    }),
  };

  try {
    const data = {
      target: 'helmholtz',
      wiring: { energized: true, coilMode: 'fixed' },
      records: [
        { target: 'helmholtz', coilMode: 'fixed', pos: -8.1, vh: 0.11, b: 0.102, Im: 0.5, Is: 5.0, hallK: 220 },
        { target: 'helmholtz', coilMode: 'fixed', pos: -2.5, vh: 1.45, b: 1.319, Im: 0.5, Is: 5.0, hallK: 220 },
      ],
    };

    assert.equal(exportHallDataReport(data), true);
    assert.ok(openedHtml);

    // 1. Table is placed before Chart
    const tableIndex = openedHtml.indexOf('<div class="section-title">实验数据记录表</div>');
    const chartIndex = openedHtml.indexOf('<div class="section-title">B–X 磁场分布曲线</div>');
    assert.ok(tableIndex > 0 && chartIndex > 0);
    assert.ok(tableIndex < chartIndex, 'Data table section must precede the B-X chart section');

    // 2. Single coil L1 (fixed) condition text is properly displayed
    assert.ok(openedHtml.includes('固定线圈 L1'));
    assert.ok(openedHtml.includes('单线圈通电 (固定线圈 L1 中心 X=0.000m)'));

    // 3. Standalone self-contained export buttons and script handlers
    assert.ok(openedHtml.includes('onclick="exportExcel()"'));
    assert.ok(openedHtml.includes('onclick="exportCSV()"'));
    assert.ok(openedHtml.includes('onclick="exportJSON()"'));
    assert.ok(openedHtml.includes('onclick="window.print()"'));
    assert.ok(openedHtml.includes('function exportExcel'));
    assert.ok(openedHtml.includes('makeXlsx'));
  } finally {
    globalThis.window = globalWindow;
  }
});

test('content-screen Faraday B slider arms drag and follows absolute pick / relative move', () => {
  let lastB = null;
  const ctx = createContext({
    expId: 'faraday_induction',
    stepId: 'field',
    equipment: {
      electro: {
        updateFaraday: (data) => { lastB = data.B; },
        mouseDrag: { movementX: 0, movementY: 0, holdLMB: false },
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('faraday_induction');
  const startB = ctx.state.data.B;

  const sliderPick = {
    action: 'faraday-b-slider',
    role: 'faraday-b-slider',
    x: 100,
    y: 200,
    w: 400,
    h: 66,
    min: -3,
    max: 3,
    // Midpoint of the track → B ≈ 0
    px: 300,
    py: 230,
  };
  const display = {
    userData: {
      type: 'holo_display',
      role: 'holo_display',
      pickFromRay: () => sliderPick,
    },
  };

  assert.equal(handlers.beginManipulation(display, { pick: sliderPick, time: 0 }), true);
  assert.equal(ctx.state.data.sliderDragging, true);
  assert.ok(Math.abs(ctx.state.data.B - 0) < 1e-6, 'absolute click maps mid-track to B≈0');
  assert.equal(lastB, ctx.state.data.B);

  // Relative drag must continue from the absolute value, not snap back to B0.
  handlers.updateManipulation(display, { totalX: 100, dragged: true });
  assert.ok(ctx.state.data.B > 0.5, `relative drag raises B from absolute anchor, got ${ctx.state.data.B}`);
  assert.notEqual(ctx.state.data.B, startB);

  assert.equal(handlers.endManipulation(display, { dragged: true }), true);
  assert.equal(ctx.state.data.sliderDragging, false);
  assert.ok(ctx.state.data.lastInduction, 'releasing the slider records an induction measurement');
  assert.equal(ctx.stepId, 'conclude');
});

test('Hall probe grab applies continuous camera-drag via updateManipulation', () => {
  let lastProbe = null;
  const mouseDrag = { holdLMB: false, movementX: 0, movementY: 0 };
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'scan',
    equipment: {
      electro: {
        mouseDrag,
        updateHall: (data) => { lastProbe = data.probePos; },
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  // Skip identify — probe drag is for post-identify steps.
  ctx.state.data.identified = {
    hall_helmholtz: true,
    hall_solenoid: true,
    hall_probe: true,
    hall_console: true,
  };
  ctx.state.stepIndex = 3;
  const probe = { userData: { role: 'hall_probe' } };
  assert.equal(handlers.beginManipulation(probe), true);
  assert.equal(ctx.state.data.hallDragArmed, true);
  const start = ctx.state.data.probePos;
  // holdInteract needs >0.08s accum before dragging starts
  handlers.updateManipulation(probe, { dt: 0.1, time: 0.1 });
  mouseDrag.movementX = -80;
  handlers.updateManipulation(probe, { dt: 0.05, time: 0.15 });
  assert.ok(
    ctx.state.data.probePos > start,
    `expected probePos to rise from ${start}, got ${ctx.state.data.probePos}`,
  );
  assert.equal(lastProbe, ctx.state.data.probePos);
  assert.equal(handlers.endManipulation(probe, { dragged: true }), true);
  assert.equal(ctx.state.data.hallDragArmed, false);
});

test('Hall probe raycast drag maintains grab point on rod without snapping to tip', () => {
  const hallRoot = new THREE.Group();
  let lastProbe = null;
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'scan',
    equipment: {
      electro: {
        getRuntimeRoot: () => hallRoot,
        updateHall: (d) => { lastProbe = d.probePos; },
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  ctx.state.data.identified = {
    hall_helmholtz: true,
    hall_solenoid: true,
    hall_probe: true,
    hall_console: true,
  };
  ctx.state.data.probePos = 1;
  ctx.state.stepIndex = 3;

  const probe = { userData: { role: 'hall_probe' } };

  // Grab the probe rod near the handle at x = 0.8m (local probe Y = 0.28, Z = -0.02)
  const grabRay = new THREE.Raycaster(
    new THREE.Vector3(0.8, 1.28, -0.02),
    new THREE.Vector3(0, -1, 0),
  );

  assert.equal(handlers.beginManipulation(probe, { raycaster: grabRay }), true);
  assert.equal(ctx.state.data.hallDragArmed, true);
  // In solenoid mode: probePos(1) - hitSimPos(-0.8 * 25 = -20) = 21
  assert.equal(ctx.state.data.hallDragOffset, 21);

  // Drag begins after accum > 0.08s
  handlers.updateManipulation(probe, { dt: 0.1, time: 0.1, raycaster: grabRay });
  // probePos must remain 1 on first drag step (no jump / snap)
  assert.equal(ctx.state.data.probePos, 1);

  // Move pointer along X by -0.1m (to x = 0.7m, pushing probe into solenoid by +2.5cm on scale)
  const moveRay = new THREE.Raycaster(
    new THREE.Vector3(0.7, 1.28, -0.02),
    new THREE.Vector3(0, -1, 0),
  );
  handlers.updateManipulation(probe, { dt: 0.05, time: 0.15, raycaster: moveRay });
  assert.equal(ctx.state.data.probePos, 3.5);
  assert.equal(lastProbe, 3.5);

  assert.equal(handlers.endManipulation(probe, { dragged: true }), true);
  assert.equal(ctx.state.data.hallDragArmed, false);
  assert.equal(ctx.state.data.hallDragOffset, null);
});

test('Hall identify requires sequential order and reports correct/wrong picks', () => {
  const toasts = [];
  const partModes = {};
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'identify',
    equipment: {
      electro: {
        setHallPartState: (role, mode) => { partModes[role] = mode; },
        clearHallIdentifyVisuals: () => {},
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  ctx.toast = (msg) => { toasts.push(msg); };
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');

  // Wrong order: console before helmholtz
  assert.equal(
    handlers.interact({ userData: { role: 'hall_console' } }, 0, { id: 'identify' }),
    true,
  );
  assert.equal(ctx.state.data.identified.hall_console, false);
  assert.equal(ctx.state.data.identifyFeedback.ok, false);
  assert.match(toasts.at(-1), /选错了|第 1 件|亥姆霍兹/);

  // Correct: first item
  assert.equal(
    handlers.interact({ userData: { role: 'hall_helmholtz' } }, 0, { id: 'identify' }),
    true,
  );
  assert.equal(ctx.state.data.identified.hall_helmholtz, true);
  assert.equal(ctx.state.data.identifyFeedback.ok, true);
  assert.match(toasts.at(-1), /正确|亥姆霍兹/);

  // Still wrong order: console while solenoid is next
  assert.equal(
    handlers.interact({ userData: { role: 'hall_console' } }, 0, { id: 'identify' }),
    true,
  );
  assert.equal(ctx.state.data.identified.hall_console, false);
  assert.equal(ctx.state.data.identifyFeedback.ok, false);

  // Complete remaining sequence
  for (const role of ['hall_solenoid', 'hall_probe', 'hall_console']) {
    assert.equal(
      handlers.interact({ userData: { role } }, 0, { id: 'identify' }),
      true,
    );
    assert.equal(ctx.state.data.identified[role], true);
    assert.equal(ctx.state.data.identifyFeedback.ok, true);
  }
  assert.equal(
    ['hall_helmholtz', 'hall_solenoid', 'hall_probe', 'hall_console']
      .every((role) => ctx.state.data.identified[role]),
    true,
  );
});

test('Hall wiring analysis correctly identifies 3-terminal Helmholtz connections', () => {
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'configure',
    equipment: {
      electro: {
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  const data = ctx.state.data;

  // 1. Both coils (Helmholtz: ③ common + ⑤ moving/both)
  data.wires = [['out_red', 'hh_red'], ['out_black', 'hh_black']];
  handlers.update(0.016);
  assert.equal(data.wiring.energized, true);
  assert.equal(data.wiring.target, 'helmholtz');
  assert.equal(data.wiring.coilMode, 'both');
  assert.equal(data.wiring.direction, 1);
  const vhBoth = data.vh;
  assert.ok(Math.abs(vhBoth) > 0);

  // 2. Fixed coil only (③ common + ④ fixed L1)
  data.wires = [['out_red', 'hh_fixed'], ['out_black', 'hh_black']];
  handlers.update(0.016);
  assert.equal(data.wiring.energized, true);
  assert.equal(data.wiring.target, 'helmholtz');
  assert.equal(data.wiring.coilMode, 'fixed');
  const vhFixed = data.vh;
  assert.ok(Math.abs(vhFixed) > 0);
  assert.ok(Math.abs(vhFixed) < Math.abs(vhBoth));

  // 3. Moving coil only (④ fixed + ⑤ moving L2)
  data.wires = [['out_red', 'hh_red'], ['out_black', 'hh_fixed']];
  handlers.update(0.016);
  assert.equal(data.wiring.energized, true);
  assert.equal(data.wiring.target, 'helmholtz');
  assert.equal(data.wiring.coilMode, 'moving');
  const vhMoving = data.vh;
  assert.ok(Math.abs(vhMoving) > 0);

  // 4. Reversed polarity on fixed coil
  data.wires = [['out_red', 'hh_black'], ['out_black', 'hh_fixed']];
  handlers.update(0.016);
  assert.equal(data.wiring.direction, -1);
  assert.equal(data.wiring.reversed, true);
  assert.equal(data.vh, -vhFixed);
});

test('Hall sequential wiring connects wire 1 then wire 2 without overwriting start point', () => {
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'configure',
    equipment: {
      electro: {
        startHallWirePreview: () => {},
        cancelHallWirePreview: () => {},
        updateHall: () => {},
        setHallWiring: () => {},
      },
    },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');

  // Wire 1: out_black -> sol_black
  const outBlack = { userData: { role: 'hall_terminal_output', portId: 'out_black' } };
  const solBlack = { userData: { role: 'hall_terminal_solenoid', portId: 'sol_black' } };
  handlers.beginManipulation(outBlack);
  assert.equal(ctx.state.data.terminalDragFrom, 'out_black');
  handlers.endManipulation(outBlack, { hoverTarget: solBlack });
  assert.deepEqual(ctx.state.data.wires, [['out_black', 'sol_black']]);

  // Wire 2: out_red -> sol_red
  const outRed = { userData: { role: 'hall_terminal_output', portId: 'out_red' } };
  const solRed = { userData: { role: 'hall_terminal_solenoid', portId: 'sol_red' } };
  handlers.beginManipulation(outRed);
  assert.equal(ctx.state.data.terminalDragFrom, 'out_red');
  handlers.endManipulation(outRed, { hoverTarget: solRed });
  assert.deepEqual(ctx.state.data.wires, [['out_black', 'sol_black'], ['out_red', 'sol_red']]);
  assert.equal(ctx.state.data.wiring.energized, true);
  assert.equal(ctx.state.data.wiring.target, 'solenoid');

  // Re-plug Wire 1: grab sol_black and move to hh_black (start point out_black stays fixed!)
  const hhBlack = { userData: { role: 'hall_terminal_helmholtz', portId: 'hh_black' } };
  handlers.beginManipulation(solBlack);
  assert.equal(ctx.state.data.terminalDragFrom, 'out_black');
  assert.equal(ctx.state.data.terminalOriginalFrom, 'sol_black');
  handlers.endManipulation(solBlack, { hoverTarget: hhBlack });
  assert.deepEqual(ctx.state.data.wires, [['out_red', 'sol_red'], ['out_black', 'hh_black']]);

  // Re-plug Wire 2: grab sol_red and move to hh_red (start point out_red stays fixed!)
  const hhRed = { userData: { role: 'hall_terminal_helmholtz', portId: 'hh_red' } };
  handlers.beginManipulation(solRed);
  assert.equal(ctx.state.data.terminalDragFrom, 'out_red');
  assert.equal(ctx.state.data.terminalOriginalFrom, 'sol_red');
  handlers.endManipulation(solRed, { hoverTarget: hhRed });
  assert.deepEqual(ctx.state.data.wires, [['out_black', 'hh_black'], ['out_red', 'hh_red']]);
  assert.equal(ctx.state.data.wiring.energized, true);
  assert.equal(ctx.state.data.wiring.target, 'helmholtz');
});

test('Hall effect holographic screen exposes pickable hall-chart and hall-fit buttons with correct labels and toggle behavior', () => {
  const mockCtx = {
    save: () => {}, restore: () => {}, clearRect: () => {}, fillRect: () => {}, strokeRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, arc: () => {}, arcTo: () => {},
    closePath: () => {}, fill: () => {}, stroke: () => {}, fillText: () => {}, strokeText: () => {},
    measureText: (text) => ({ width: (text || '').length * 10 }),
    setLineDash: () => {}, createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }), clip: () => {},
  };

  const W = 960, H = 720;
  const ctx = createContext({
    expId: 'hall_effect',
    stepId: 'scan',
    equipment: { electro: { updateHall: () => {}, setHallWiring: () => {} } },
  });
  const handlers = createElectroHandlers(ctx);
  ctx.state.stepIndex = 1;
  ctx.state.data.stepIndex = 1;
  ctx.state.data.identified = { hall_helmholtz: true, hall_solenoid: true, hall_probe: true, hall_console: true };
  ctx.state.data.records = [
    { target: 'solenoid', pos: 0, vh: 1.0, b: 0.05, Im: 0.5, Is: 5 },
    { target: 'solenoid', pos: 1, vh: 2.0, b: 0.10, Im: 0.5, Is: 5 },
  ];

  // Render initial measurement state (data table mode)
  let renderRes = drawHoloScreen(mockCtx, W, H, {
    surface: 'display',
    accentHex: '#f472b6',
    fullTitle: '电磁学',
    enTitle: 'ELECTROMAGNETISM',
    active: true,
    hud: {
      running: true,
      experiment: { id: 'hall_effect', steps: [{ text: '扫描' }, { text: '扫描' }] },
      stepIndex: 1,
      data: ctx.state.data,
    },
  });

  let hits = renderRes.hits || [];
  const chartHit = hits.find((h) => h.action === 'hall-chart');
  const fitHit = hits.find((h) => h.action === 'hall-fit');
  assert.ok(chartHit, 'hall-chart button hit region should exist');
  assert.ok(fitHit, 'hall-fit button hit region should exist');
  assert.equal(chartHit.label, '生成曲线');
  assert.equal(fitHit.label, '拟合曲线');

  // Verify pickHoloScreen resolves UV coordinate in button region
  const chartU = (chartHit.x + chartHit.w / 2) / W;
  const chartV = 1 - (chartHit.y + chartHit.h / 2) / H;
  const pickedChart = pickHoloScreen(chartU, chartV, W, H, hits, 1);
  assert.ok(pickedChart);
  assert.equal(pickedChart.action, 'hall-chart');
  assert.equal(pickedChart.label, '生成曲线');

  const fitU = (fitHit.x + fitHit.w / 2) / W;
  const fitV = 1 - (fitHit.y + fitHit.h / 2) / H;
  const pickedFit = pickHoloScreen(fitU, fitV, W, H, hits, 1);
  assert.ok(pickedFit);
  assert.equal(pickedFit.action, 'hall-fit');
  assert.equal(pickedFit.label, '拟合曲线');

  // Click hall-chart: toggles to curve/scatter view
  assert.equal(handlers.onUiAction('hall-chart', pickedChart), true);
  assert.equal(ctx.state.data.showCurve, true);
  assert.equal(!!ctx.state.data.showFit, false);

  // Re-render in curve view: button 0 becomes '返回记录'
  renderRes = drawHoloScreen(mockCtx, W, H, {
    surface: 'display',
    accentHex: '#f472b6',
    fullTitle: '电磁学',
    enTitle: 'ELECTROMAGNETISM',
    active: true,
    hud: {
      running: true,
      experiment: { id: 'hall_effect', steps: [{ text: '扫描' }, { text: '扫描' }] },
      stepIndex: 1,
      data: ctx.state.data,
    },
  });
  hits = renderRes.hits || [];
  const updatedChartHit = hits.find((h) => h.action === 'hall-chart');
  assert.ok(updatedChartHit);
  assert.equal(updatedChartHit.label, '返回记录');

  // Click hall-fit: activates fit curve overlay
  assert.equal(handlers.onUiAction('hall-fit', pickedFit), true);
  assert.equal(ctx.state.data.showFit, true);

  // Re-render: button 1 becomes '隐藏拟合'
  renderRes = drawHoloScreen(mockCtx, W, H, {
    surface: 'display',
    accentHex: '#f472b6',
    fullTitle: '电磁学',
    enTitle: 'ELECTROMAGNETISM',
    active: true,
    hud: {
      running: true,
      experiment: { id: 'hall_effect', steps: [{ text: '扫描' }, { text: '扫描' }] },
      stepIndex: 1,
      data: ctx.state.data,
    },
  });
  hits = renderRes.hits || [];
  const updatedFitHit = hits.find((h) => h.action === 'hall-fit');
  assert.ok(updatedFitHit);
  assert.equal(updatedFitHit.label, '隐藏拟合');
});

test('Hall effect formatExperimentData reflects showCurve and showFit modes in data summary', () => {
  const dataTable = {
    target: 'solenoid',
    records: [{ target: 'solenoid', pos: 0, vh: 1, b: 0.1 }],
    showCurve: false,
    showFit: false,
  };
  const summaryTable = formatExperimentData('electro', 'hall_effect', dataTable);
  assert.ok(summaryTable.includes('记录表'), 'Table mode should include 记录表 indicator');

  const dataScatter = { ...dataTable, showCurve: true, showFit: false };
  const summaryScatter = formatExperimentData('electro', 'hall_effect', dataScatter);
  assert.ok(summaryScatter.includes('曲线散点图'), 'Scatter mode should include 曲线散点图 indicator');
  assert.notEqual(summaryTable, summaryScatter, 'Summary string must change when entering curve view');

  const dataFitted = { ...dataTable, showCurve: true, showFit: true };
  const summaryFitted = formatExperimentData('electro', 'hall_effect', dataFitted);
  assert.ok(summaryFitted.includes('曲线图[已拟合]'), 'Fitted mode should include 已拟合 indicator');
  assert.notEqual(summaryScatter, summaryFitted, 'Summary string must change when fit is enabled');

  // Verify Helmholtz probe display (meters with 3 decimals) vs Solenoid (cm with 1 decimal)
  const helmData = { target: 'helmholtz', probePos: -0.010, showCurve: false };
  const helmSummary = formatExperimentData('electro', 'hall_effect', helmData);
  assert.ok(helmSummary.includes('X = -0.010 m'), 'Helmholtz summary must show X in meters with 3 decimals');

  const solData = { target: 'solenoid', probePos: 16.0, showCurve: false };
  const solSummary = formatExperimentData('electro', 'hall_effect', solData);
  assert.ok(solSummary.includes('X = 16.0 cm'), 'Solenoid summary must show X in cm with 1 decimal');
});

test('Hall effect chart renders data points with + cross markers instead of circles', () => {
  let arcCalled = false;
  let linesDrawn = 0;
  const mockCtx = {
    save: () => {}, restore: () => {}, clearRect: () => {}, fillRect: () => {}, strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => { linesDrawn += 1; },
    arc: () => { arcCalled = true; },
    arcTo: () => {},
    closePath: () => {}, fill: () => {}, stroke: () => {}, fillText: () => {}, strokeText: () => {},
    measureText: (text) => ({ width: (text || '').length * 10 }),
    setLineDash: () => {}, createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }), clip: () => {},
  };

  const W = 960, H = 720;
  const data = {
    target: 'solenoid',
    stepIndex: 1,
    identified: { hall_helmholtz: true, hall_solenoid: true, hall_probe: true, hall_console: true },
    showCurve: true,
    showFit: false,
    records: [
      { target: 'solenoid', pos: 5, vh: 1.0, b: 0.05, Im: 0.5, Is: 5, direction: 0 },
      { target: 'solenoid', pos: 10, vh: 2.0, b: 0.10, Im: 0.5, Is: 5, direction: 0 },
    ],
    direction: 0,
    Im: 0.5,
  };

  drawHoloScreen(mockCtx, W, H, {
    surface: 'display',
    accentHex: '#38bdf8',
    fullTitle: '电磁学',
    enTitle: 'ELECTROMAGNETISM',
    active: true,
    hud: {
      running: true,
      experiment: { id: 'hall_effect', steps: [{ text: '识别' }, { text: '测量' }] },
      stepIndex: 1,
      data,
    },
  });

  // Chart data points must be rendered using cross lines, not arc circles
  assert.equal(arcCalled, false, 'Measured points on Hall chart should not use arc/circles');
  assert.ok(linesDrawn >= 4, 'Each of the 2 data points should draw horizontal and vertical cross lines');
});

test('Hall effect export report script parses cleanly and defines export handlers on window', () => {
  let reportHtml = '';
  const origWindow = globalThis.window;
  globalThis.window = {
    open: () => ({
      document: {
        open: () => {},
        write: (h) => { reportHtml = h; },
        close: () => {},
      }
    })
  };

  try {
    const data = {
      target: 'solenoid',
      records: [
        { target: 'solenoid', pos: 1.0, vh: 0.005, b: 0.001, Im: 0.5, Is: 0.005 },
        { target: 'solenoid', pos: 2.0, vh: 0.006, b: 0.0012, Im: 0.5, Is: 0.005 },
      ]
    };

    assert.equal(exportHallDataReport(data), true);
    assert.ok(reportHtml.length > 0);

    const scriptMatch = reportHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Report HTML must contain a <script> tag');

    // Verify the script is syntactically valid JavaScript (compiles without error)
    const scriptCode = scriptMatch[1];
    const fn = new Function(scriptCode);
    assert.equal(typeof fn, 'function');

    // Verify export functions are defined and attached to window
    assert.ok(scriptCode.includes('window.exportExcel = exportExcel'));
    assert.ok(scriptCode.includes('window.exportCSV = exportCSV'));
    assert.ok(scriptCode.includes('window.exportJSON = exportJSON'));
  } finally {
    globalThis.window = origWindow;
  }
});
