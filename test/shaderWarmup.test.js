import test from 'node:test';
import assert from 'node:assert/strict';
import { createShaderWarmupController } from '../src/runtime/shaderWarmup.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('shader warm-up persists completed experiment keys and resumes partial work', async () => {
  const storage = createStorage();
  const firstCalls = [];
  const first = createShaderWarmupController({
    keys: ['electro:a', 'optics:b', 'thermo:c'],
    signature: 'sig-1',
    storage,
    prepare: async (key) => {
      firstCalls.push(key);
      return { prepared: key !== 'optics:b' };
    },
  });

  const firstResult = await first.run();
  assert.deepEqual(firstCalls, ['electro:a', 'optics:b', 'thermo:c']);
  assert.deepEqual(firstResult.completed, ['electro:a', 'thermo:c']);
  assert.deepEqual(firstResult.failed, ['optics:b']);

  const secondCalls = [];
  const second = createShaderWarmupController({
    keys: ['electro:a', 'optics:b', 'thermo:c'],
    signature: 'sig-1',
    storage,
    prepare: async (key) => {
      secondCalls.push(key);
      return true;
    },
  });
  const secondResult = await second.run();
  assert.deepEqual(secondCalls, ['optics:b']);
  assert.equal(secondResult.complete, true);
});

test('targeted warm-up does not traverse unrelated experiments', async () => {
  const calls = [];
  const warmup = createShaderWarmupController({
    keys: ['mechanics:a', 'optics:b'],
    signature: 'sig-2',
    storage: createStorage(),
    prepare: async (key) => {
      calls.push(key);
      return true;
    },
  });

  await warmup.warm('optics:b', { force: true });
  assert.deepEqual(calls, ['optics:b']);
  assert.deepEqual(warmup.completedExperiments, ['optics:b']);
  assert.equal(warmup.isComplete(), false);
});

test('revalidate reruns persisted jobs without blocking the room entry path', async () => {
  const storage = createStorage();
  const first = createShaderWarmupController({
    keys: ['a', 'b'],
    signature: 'sig-revalidate',
    storage,
    prepare: async () => true,
  });
  await first.run();

  const calls = [];
  const second = createShaderWarmupController({
    keys: ['a', 'b'],
    signature: 'sig-revalidate',
    storage,
    prepare: async (key) => {
      calls.push(key);
      return true;
    },
  });

  const result = await second.run({ revalidate: true });
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(result.complete, true);
  assert.deepEqual(second.completedExperiments, ['a', 'b']);
});

test('revalidation removes a stale success when the current GPU prepare fails', async () => {
  const storage = createStorage();
  const first = createShaderWarmupController({
    keys: ['a'],
    signature: 'sig-revalidate-failure',
    storage,
    prepare: async () => true,
  });
  await first.run();

  const second = createShaderWarmupController({
    keys: ['a'],
    signature: 'sig-revalidate-failure',
    storage,
    prepare: async () => ({ prepared: false }),
  });
  const result = await second.run({ revalidate: true });
  assert.equal(result.complete, false);
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.failed, ['a']);
});

test('abort stops the queue and preserves already completed work', async () => {
  const storage = createStorage();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const warmup = createShaderWarmupController({
    keys: ['a', 'b'],
    signature: 'sig-3',
    storage,
    prepare: async (key, signal) => {
      calls.push(key);
      if (key === 'a') return true;
      await gate;
      if (signal.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return true;
    },
  });

  const pending = warmup.run();
  await new Promise((resolve) => setImmediate(resolve));
  warmup.cancel();
  release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(warmup.completedExperiments, ['a']);
  assert.deepEqual(calls, ['a', 'b']);
});
