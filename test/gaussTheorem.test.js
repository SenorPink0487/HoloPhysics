import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gaussEnclosedCharge,
  gaussFlux,
  gaussFluxParticleEmphasis,
  gaussFluxParticleRadiusNorm,
  gaussFluxParticleSpeed,
  gaussMeanNormalField,
  gaussNormalFluxDensity,
  getIrregularBump,
  K_COULOMB,
  EPSILON_0,
  chargeUiToCoulomb,
} from '../src/experiments/electro.js';
import { getHoloScreenLayoutSize } from '../src/holoScreen.js';

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

test('Gauss flux depends on enclosed net charge, not external charge (SI Φ_E=Q/ε₀)', () => {
  const charges = [
    { q: 2, x: 0, y: 0, z: 0 },
    { q: -0.5, x: 1, y: 0, z: 0 },
    { q: 9, x: 5, y: 0, z: 0 },
  ];
  assert.equal(gaussEnclosedCharge(charges, 2.4), 1.5);
  close(gaussFlux(charges, 2.4), chargeUiToCoulomb(1.5) / EPSILON_0);
});

test('Gauss flux is invariant under radius changes that cross no charge', () => {
  const charges = [
    { q: 1, x: 0.3, y: 0, z: 0 },
    { q: -2, x: 4.8, y: 0, z: 0 },
  ];
  const expected = chargeUiToCoulomb(1) / EPSILON_0;
  close(gaussFlux(charges, 1.2), expected);
  close(gaussFlux(charges, 4.2), expected);
  assert.ok(gaussMeanNormalField(charges, 1.2) > gaussMeanNormalField(charges, 4.2));
});

test('Gauss flux changes sign and cancels for equal opposite enclosed charges', () => {
  close(gaussFlux([{ q: -3, x: 0, y: 0, z: 0 }], 2.4), chargeUiToCoulomb(-3) / EPSILON_0);
  close(gaussFlux([
    { q: 1.5, x: 0, y: 0, z: 0 },
    { q: -1.5, x: 1, y: 0, z: 0 },
  ], 2.4), 0);
});

test('External charge leaves zero net flux but a non-zero surface field', () => {
  const external = [{ q: 1, x: 5, y: 0, z: 0 }];
  assert.equal(gaussFlux(external, 2.4), 0);
  assert.ok(gaussMeanNormalField(external, 2.4) > 0);
});

test('centered charge mean field is E=kQ/R²', () => {
  const R = 2.4;
  const mean = gaussMeanNormalField([{ q: 1, x: 0, y: 0, z: 0 }], R);
  close(mean, (K_COULOMB * chargeUiToCoulomb(1)) / (R * R));
});

test('local E·n is outward for centered positive charge and mixed for external charge', () => {
  const inside = [{ q: 2, x: 0, y: 0, z: 0 }];
  assert.ok(gaussNormalFluxDensity(inside, { x: 1, y: 0, z: 0 }, 2.4) > 0);
  assert.ok(gaussNormalFluxDensity(inside, { x: -1, y: 0, z: 0 }, 2.4) > 0);

  const outside = [{ q: 2, x: 5, y: 0, z: 0 }];
  const near = gaussNormalFluxDensity(outside, { x: 1, y: 0, z: 0 }, 2.4);
  const far = gaussNormalFluxDensity(outside, { x: -1, y: 0, z: 0 }, 2.4);
  assert.ok(near < 0, `expected inward flux on near face, got ${near}`);
  assert.ok(far > 0, `expected outward flux on far face, got ${far}`);
  assert.ok(Math.abs(near) > Math.abs(far));
});

test('flux tracers travel outward or inward according to local E·n', () => {
  assert.equal(gaussFluxParticleRadiusNorm(0, 0.5), null);
  const outStart = gaussFluxParticleRadiusNorm(1, 0);
  const outEnd = gaussFluxParticleRadiusNorm(1, 1);
  const inStart = gaussFluxParticleRadiusNorm(-1, 0);
  const inEnd = gaussFluxParticleRadiusNorm(-1, 1);
  assert.ok(outStart < 1 && outEnd > 1);
  assert.ok(inStart > 1 && inEnd < 1);
  assert.ok(gaussFluxParticleSpeed(2) > gaussFluxParticleSpeed(0.2));
  assert.ok(gaussFluxParticleEmphasis(1, 1) > gaussFluxParticleEmphasis(1, 1.4));
});

test('Gauss content display reserves the dense control layout', () => {
  const size = getHoloScreenLayoutSize({
    active: true,
    surface: 'display',
    hud: { running: true, experiment: { id: 'gauss_theorem' } },
  });
  assert.deepEqual(size, { width: 1280, height: 880 });
});

test('Irregular Gaussian surface bump varies with seed', () => {
  const theta = 0.5;
  const phi = 1.2;
  const bump0 = getIrregularBump(theta, phi, 0);
  const bump1 = getIrregularBump(theta, phi, 1);
  const bump2 = getIrregularBump(theta, phi, 2);

  // Seed 0 matches legacy formula
  const expected0 = 1 + 0.24 * Math.sin(3 * theta) * Math.cos(4 * phi)
                      + 0.15 * Math.cos(5 * theta) * Math.sin(2 * phi)
                      + 0.08 * Math.sin(7 * phi);
  close(bump0, expected0);

  // Different seeds produce distinct bumps
  assert.notEqual(bump1, bump0);
  assert.notEqual(bump2, bump1);
});

