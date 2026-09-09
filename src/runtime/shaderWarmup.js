/**
 * Persistent, resumable shader warm-up coordinator.
 *
 * This module deliberately knows nothing about Three.js. The caller supplies
 * one prepare function per logical experiment key; the coordinator only
 * serializes those jobs, persists their completion state, and yields between
 * jobs so the loader/compositor can keep painting.
 */

export const SHADER_WARMUP_SCHEMA_VERSION = 1;
export const SHADER_WARMUP_STORAGE_KEY = 'physics-lab:shader-warmup:v1';

function abortError() {
  const error = new Error('Shader warm-up aborted');
  error.name = 'AbortError';
  return error;
}

function asKeyList(keys) {
  return [...new Set((Array.isArray(keys) ? keys : []).map((key) => String(key)).filter(Boolean))];
}

function safeRead(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch {
    return null;
  }
}

function safeWrite(storage, key, value) {
  try {
    storage?.setItem?.(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    /* Storage is optional in private/embed contexts. */
  }
}

function normalizeStoredKeys(value) {
  return new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []);
}

/**
 * @typedef {object} ShaderWarmupProgress
 * @property {'idle'|'running'|'complete'|'partial'|'cancelled'} state
 * @property {string|null} key
 * @property {number} index
 * @property {number} total
 * @property {number} completed
 * @property {number} failed
 * @property {boolean} persisted
 */

/**
 * @param {object} options
 * @param {string[]} options.keys
 * @param {string} options.signature
 * @param {(key:string, signal:AbortSignal) => Promise<{prepared?:boolean, error?:Error}|boolean>} options.prepare
 * @param {Storage|{getItem?:Function,setItem?:Function,removeItem?:Function}} [options.storage]
 * @param {string} [options.storageKey]
 * @param {number} [options.schemaVersion]
 * @param {(progress: ShaderWarmupProgress) => void} [options.onProgress]
 * @param {() => Promise<void>} [options.yieldBetween]
 */
export function createShaderWarmupController({
  keys,
  signature,
  prepare,
  storage = globalThis.localStorage,
  storageKey = SHADER_WARMUP_STORAGE_KEY,
  schemaVersion = SHADER_WARMUP_SCHEMA_VERSION,
  onProgress = () => {},
  yieldBetween = () => Promise.resolve(),
} = {}) {
  const allKeys = asKeyList(keys);
  const prepareJob = typeof prepare === 'function' ? prepare : async () => ({ prepared: false });
  const normalizedSignature = String(signature || '');
  let completed = new Set();
  let failed = new Set();
  let running = null;
  let state = 'idle';
  let currentKey = null;
  let currentIndex = 0;
  let persisted = false;

  function readRecord() {
    const record = safeRead(storage, storageKey);
    if (!record || record.schemaVersion !== schemaVersion || record.signature !== normalizedSignature) {
      return null;
    }
    const known = new Set(allKeys);
    const storedCompleted = normalizeStoredKeys(record.completed);
    const storedFailed = normalizeStoredKeys(record.failed);
    completed = new Set([...storedCompleted].filter((key) => known.has(key)));
    failed = new Set([...storedFailed].filter((key) => known.has(key) && !completed.has(key)));
    persisted = !!record.updatedAt;
    return record;
  }

  function writeRecord() {
    const record = {
      schemaVersion,
      signature: normalizedSignature,
      completed: allKeys.filter((key) => completed.has(key)),
      failed: allKeys.filter((key) => failed.has(key) && !completed.has(key)),
      updatedAt: Date.now(),
    };
    persisted = safeWrite(storage, storageKey, record);
    return persisted;
  }

  function emit(extra = {}) {
    const progress = {
      state,
      key: currentKey,
      index: currentIndex,
      total: allKeys.length,
      completed: completed.size,
      failed: failed.size,
      persisted,
      ...extra,
    };
    try { onProgress(progress); } catch { /* progress UI must never break warm-up */ }
    return progress;
  }

  function isComplete() {
    return allKeys.length > 0 && completed.size === allKeys.length;
  }

  function reset({ persist = true } = {}) {
    if (running) running.controller.abort();
    completed = new Set();
    failed = new Set();
    state = 'idle';
    currentKey = null;
    currentIndex = 0;
    persisted = false;
    if (persist) safeRemove(storage, storageKey);
    emit();
  }

  async function run({
    force = false,
    revalidate = false,
    signal,
    keys: requestedKeys = null,
  } = {}) {
    if (running) return running.promise;

    readRecord();
    const selectedKeys = requestedKeys == null
      ? allKeys.slice()
      : asKeyList(requestedKeys).filter((key) => allKeys.includes(key));
    const selectedComplete = selectedKeys.length > 0
      && selectedKeys.every((key) => completed.has(key));
    if (force) {
      selectedKeys.forEach((key) => {
        completed.delete(key);
        failed.delete(key);
      });
    }
    if (!force && !revalidate && selectedComplete) {
      state = 'complete';
      currentKey = null;
      currentIndex = selectedKeys.length === allKeys.length ? allKeys.length : 0;
      emit({ skipped: true });
      return snapshot();
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener?.('abort', abortFromCaller, { once: true });
    const job = { controller, promise: null };

    job.promise = (async () => {
      state = 'running';
      // A persisted record is only a hint about the browser/driver cache. It
      // cannot contain WebGLProgram objects, so a fresh WebView process must
      // still revalidate the actual GPU runtime after the room is visible.
      // `revalidate` keeps that work non-blocking while making the current
      // experiment observable instead of falsely staying at 21/21.
      const pendingKeys = selectedKeys.filter((key) => revalidate || force || !completed.has(key));
      emit({ pending: pendingKeys.length });
      for (let i = 0; i < pendingKeys.length; i += 1) {
        if (controller.signal.aborted) {
          state = 'cancelled';
          currentKey = null;
          emit();
          throw abortError();
        }

        const key = pendingKeys[i];
        currentKey = key;
        currentIndex = allKeys.indexOf(key);
        // Revalidation must not keep a stale persisted success while this
        // process is compiling the same key again. If the job is interrupted
        // or fails, the record must remain partial and retryable.
        if (revalidate || force) completed.delete(key);
        emit({ pending: pendingKeys.length - i });
        try {
          const result = await prepareJob(key, controller.signal);
          if (result === false || (result && result.prepared === false)) {
            const error = result?.error || new Error(`Shader warm-up failed: ${key}`);
            throw error;
          }
          completed.add(key);
          failed.delete(key);
        } catch (error) {
          if (error?.name === 'AbortError' || controller.signal.aborted) {
            state = 'cancelled';
            currentKey = null;
            emit({ error });
            throw error?.name === 'AbortError' ? error : abortError();
          }
          failed.add(key);
          console.warn?.('[shader-warmup] failed', key, error);
        }
        writeRecord();
        emit({ pending: pendingKeys.length - i - 1 });
        if (i < pendingKeys.length - 1) await yieldBetween();
      }
      state = selectedKeys.every((key) => completed.has(key)) ? 'complete' : 'partial';
      currentKey = null;
      currentIndex = allKeys.length;
      writeRecord();
      return snapshot();
    })().finally(() => {
      signal?.removeEventListener?.('abort', abortFromCaller);
      if (running === job) running = null;
      emit();
    });

    running = job;
    return job.promise;
  }

  function cancel() {
    if (!running) return false;
    running.controller.abort();
    return true;
  }

  /** Record a successful compile performed by another lifecycle path. */
  function markComplete(key) {
    const normalizedKey = String(key || '');
    if (!allKeys.includes(normalizedKey)) return false;
    readRecord();
    completed.add(normalizedKey);
    failed.delete(normalizedKey);
    writeRecord();
    if (!running) {
      state = isComplete() ? 'complete' : 'partial';
      currentKey = null;
      emit();
    }
    return true;
  }

  /** Warm one experiment on demand without traversing the full catalog. */
  function warm(key, options = {}) {
    const normalizedKey = String(key || '');
    if (!allKeys.includes(normalizedKey)) {
      return Promise.resolve({
        ...snapshot(),
        state: 'partial',
        failed: [...new Set([...failed, normalizedKey])],
        error: new Error(`Unknown shader warm-up key: ${normalizedKey}`),
      });
    }
    return run({ ...options, keys: [normalizedKey] });
  }

  function snapshot() {
    return {
      state,
      signature: normalizedSignature,
      schemaVersion,
      keys: allKeys.slice(),
      completed: allKeys.filter((key) => completed.has(key)),
      failed: allKeys.filter((key) => failed.has(key)),
      currentKey,
      currentIndex,
      persisted,
      complete: isComplete(),
    };
  }

  readRecord();
  return {
    run,
    warm,
    cancel,
    markComplete,
    reset,
    isComplete,
    snapshot,
    get status() { return state; },
    get completedExperiments() { return allKeys.filter((key) => completed.has(key)); },
    get failedExperiments() { return allKeys.filter((key) => failed.has(key)); },
  };
}
