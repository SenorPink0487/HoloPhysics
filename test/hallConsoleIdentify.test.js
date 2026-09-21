import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStationEquipment as createElectroEquipment } from '../src/scene/stations/electro.js';

test('HCC-2 console recognition target: geometry covers entire console and raycast stays active in off mode', () => {
  const origDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          width: 640,
          height: 140,
          getContext: () => ({
            clearRect: () => {},
            fillRect: () => {},
            strokeRect: () => {},
            fillText: () => {},
            strokeText: () => {},
            measureText: () => ({ width: 10 }),
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
            beginPath: () => {},
            closePath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            arc: () => {},
            arcTo: () => {},
            ellipse: () => {},
            fill: () => {},
            stroke: () => {},
            save: () => {},
            restore: () => {},
            setLineDash: () => {},
          }),
        };
      }
      return {};
    },
  };

  try {
    const station = createElectroEquipment({
      THREE,
      renderer: { compileAsync: async () => {} },
      camera: new THREE.PerspectiveCamera(),
      scene: new THREE.Scene(),
    });

    station.equipment.createRuntime('hall_effect');
    station.equipment.setMode('hall');

    // Find the hall_console hit mesh
    let consoleHit = null;
    let consoleOutline = null;
    station.root.traverse((child) => {
      if (child.userData?.role === 'hall_console') {
        if (child.isMesh && child.geometry?.type === 'BoxGeometry') {
          consoleHit = child;
        }
      }
    });

    assert.ok(consoleHit, 'hall_console hit mesh must exist');
    assert.equal(consoleHit.userData.title, 'HCC-2 测磁仪');
    assert.equal(consoleHit.userData.interactive, true);

    // Verify console hit box covers meters (-0.38 to +0.38) and knobs (z=0.32)
    const geom = consoleHit.geometry;
    geom.computeBoundingBox();
    const bb = geom.boundingBox.clone();
    bb.translate(consoleHit.position);

    assert.ok(bb.min.x <= -0.38, 'Bounding box must cover left meter at x=-0.38');
    assert.ok(bb.max.x >= 0.38, 'Bounding box must cover right meter at x=0.38');
    assert.ok(bb.max.z >= 0.32, 'Bounding box must cover knobs at z=0.32');

    // Test mode 'off': MUST keep raycast active and interactive true
    station.equipment.setHallPartState('hall_console', 'off');
    assert.equal(consoleHit.userData.interactive, true);
    assert.equal(consoleHit.raycast, THREE.Mesh.prototype.raycast);

    // Test mode 'hover': outline visible and raycast active
    station.equipment.setHallPartState('hall_console', 'hover');
    assert.equal(consoleHit.userData.interactive, true);
    assert.equal(consoleHit.raycast, THREE.Mesh.prototype.raycast);

    // Test mode 'done': raycast disabled
    station.equipment.setHallPartState('hall_console', 'done');
    assert.equal(consoleHit.userData.interactive, false);

    // Reset to 'off' for step re-entry
    station.equipment.setHallPartState('hall_console', 'off');
    assert.equal(consoleHit.userData.interactive, true);

    // Test clearHallIdentifyVisuals disables console raycast for post-identify steps
    station.equipment.clearHallIdentifyVisuals();
    assert.equal(consoleHit.userData.interactive, false);

    // Test resetHallIdentifyVisuals restores console raycast on experiment re-entry
    station.equipment.resetHallIdentifyVisuals();
    assert.equal(consoleHit.userData.interactive, true);
    assert.equal(consoleHit.raycast, THREE.Mesh.prototype.raycast);

  } finally {
    globalThis.document = origDoc;
  }
});
