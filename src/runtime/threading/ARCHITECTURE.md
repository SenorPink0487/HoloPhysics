# Multi-thread lab runtime

Phased cutover for Vite + Three.js + cannon-es (+ Tauri) so physics and optional
render work can leave the main UI thread without breaking the existing room.

## Thread model

```
┌──────────────────────── Main (UI) ────────────────────────┐
│  labShell / FrameCoordinator / experiment DOM              │
│  #c WebGLRenderer  ← primary canvas stays here             │
│  PhysicsBackend (main | worker proxy)                      │
│  RenderBackend (main wrapper | optional island worker)     │
│  FrameBridge (isolated pairs / tests)                      │
└───────────┬───────────────────────────────┬────────────────┘
            │ postMessage / SAB             │ Offscreen transfer
            ▼                               ▼
┌─ Physics Worker ─┐              ┌─ Render Worker ─┐
│  cannon-es world │              │  isolated Three │
│  pose pack       │              │  primitives only│
│  SAB or transfer │              │  present()      │
└──────────────────┘              └─────────────────┘
```

| Role | Owns | Does not own |
|------|------|--------------|
| **Main** | DOM, lab scene graph, `#c`, experiment lifecycle | Heavy free-fall step when worker mode is on |
| **Physics worker** | cannon-es world, body commands, pose publish | Three meshes, UI |
| **Render worker** | Isolated OffscreenCanvas + primitive meshes | Primary room (`#c`) until full scene migrate |

## Phases (status)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **0** | `PhysicsBackend` on main, BodyHandle + pose stride 10 | Done |
| **1** | Physics worker + postMessage proxy, latest-complete-wins | Done |
| **2** | COOP/COEP (Vite) + SharedArrayBuffer pose path | Done |
| **3** | `RenderBackend` main wrapper + worker Offscreen scaffold | Done |
| **4** | Docs, `index.js`, optional Offscreen island, smoke tests | Done |
| **5** | `SimDriver` owns fixed-step; mechanics physics default `auto` | Done |
| **6** | Generic `SimBackend` + thermo kinds (mix / FD / ideal-gas) | Done |
| **7** | Thermo convection + electro / optics kinds; host wiring | Done |
| **8** | Optional second compute worker (`simWorkerPool` slots 0/1) | Done |

## Sim clock (Phase 5)

Live experiment integration is owned by **`SimDriver`** (`src/runtime/simDriver.js`),
driven from `FrameCoordinator.onFixedUpdate` — not from `expManager.update` in
`animate()`.

```
animate()
  input / holdInteract
  expManager.update(..., { simulate: false })   // light sync only
  frameCoordinator.frame()
    simDriver.fixedUpdate(dt)  → expManager.fixedUpdate → handler simulate
    simDriver.visualUpdate(α)
    renderBackend.present()
```

Soft-switch calls `simDriver.pause()` so present continues while sim freezes.

**Physics default mode is `auto`** (worker when available, main fallback).
Force main with `mode:'main'` or `globalThis.__PHYSICS_BACKEND_MODE__ = 'main'`.

## ExperimentSimBackend (Phase 6–8)

Generic pure-compute backend for station sims that are **not** cannon-es:

```
createSimBackend({ kind, mode?, options?, workerSlot? })
  command(op, payload)
  step(dt) → snapshot { simTime, generation, scalars, fields?, particles?, deferred? }
  stepAsync(dt)
  getSnapshot()
  reinit(kind, options?)
  dispose()
```

| Kind id | Used by | Snapshot payload |
|---------|---------|------------------|
| `thermo.calorimetryMix` | calorimetry mix clock | `scalars.mixProgress`, `tCurrent`, `teq` |
| `thermo.heatConduction` | heat-conduction 1D FD | `fields.temps` Float32Array |
| `thermo.idealGas` | ideal-gas particles | `particles` stride-6 + `collisionsPerSec` |
| `thermo.convection` | natural convection plume | `particles` stride-7 (pos/vel/temp) + Ra/h/Q |
| `electro.electricFieldLines` | static E-field decorations | `fields.fieldLines` packed polylines |
| `electro.gaussMetrics` | Gauss theorem HUD | `scalars.qEnclosed`, `flux`, `meanField` |
| `electro.hallCarriers` | Hall carrier demo | `particles` stride-6 + `vh` |
| `optics.diffractionFringe` | multi-slit fringe samples | `fields.intensity` + fringe spacing |
| `optics.geometricAngles` | geometric HUD θ₁/θ₂ | `scalars.theta1/2`, `tir` (mesh rays stay main) |

**Modes**: `main` | `worker` | `auto` (default). Flags:
`globalThis.__SIM_BACKEND_MODE__`, same policy as physics.

**Worker**: `sim.worker.js` — transferable field/particle buffers; latest-complete-wins
coalesces in-flight `step` into one queued dt.

**Worker pool** (`simWorkerPool.js`, Phase 8):
- Slot **0** — primary (mix / FD / field lines / optics samples)
- Slot **1** — secondary continuous particles (convection / hall / ideal-gas)
- **Exclusive ownership** per slot (one live backend); busy → dedicated Worker
- Workers stay warm on release (next owner re-inits kind)
- `preferredWorkerSlot(kind)` + `createSimBackend({ workerSlot })`
- Flags: `globalThis.__SIM_WORKER_POOL_SIZE__ = 1|2`, `__SIM_WORKER_POOL__ = false` to disable

**Host wiring**:
- `experiments/thermo.js` — mix / FD / ideal-gas / **convection**; source
  `_hostFieldOwned` / `_hostParticlesOwned` so rigs only paint
- `experiments/electro.js` — field lines (dirty-sig rebuild), gauss metrics,
  hall carriers (`applyHallDemoHostParticles` + host-owned flag)
- `experiments/optics.js` — fringe intensity samples + geometric analytic angles;
  `stations/optics.js` paints screen from `_simIntensity` when present
  (progressive mesh raytrace remains main-thread)

## Pose layout

Shared by physics and render (`POSE_STRIDE` / `RENDER_POSE_STRIDE` = **10**):

```
[px, py, pz, qx, qy, qz, qw, vx, vy, vz]
```

- Sparse body slots are **not** compacted after `removeBody` (holes stay).
- Worker `addBody` is synchronous on the client via a pre-allocated `bodyId`.

## PhysicsBackend contract

Stable across `main` / `worker` / `auto`:

```
addBody(desc) → bodyId
removeBody(bodyId)
getHandle(bodyId) → BodyHandle   // Cannon-like surface
command(bodyId, op, payload)
setGravity(x, y, z)
step(dt, { onPreStep, forceStep }) → { simTime, steps, poses, skipped, deferred? }
stepAsync(dt, …)                   // wait for worker completion
syncMeshes(meshes)                 // main path: copy pose → mesh
getPose(bodyId) → Float32Array | null
resetClock()
dispose()
```

**Modes**

- `main` (default) — cannon-es on the calling thread.
- `worker` — `physics.worker.js` proxy; falls back to main if Worker fails.
- `auto` — try worker, fall back quietly.

**Flags**

- `globalThis.__PHYSICS_BACKEND_MODE__ = 'worker' | 'main' | 'auto'`
- Experiment options: `physicsMode` (mechanics source runtime).

**Formula labs** with no dynamic Cannon bodies skip empty steps (no worker thrash).

## SharedArrayBuffer path (Phase 2)

Requires cross-origin isolation. Vite sets:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

(`vite.config.js` `server` + `preview` headers.)

**Tauri** does not currently inject custom security headers the same way; without
isolation the worker uses **transferable Float32Array** copies.

### SAB layout

```
bytes 0..31   Int32 control header (Atomics)
bytes 32..    Float32 payload: [simTime, pose0…, poseN]
```

Header indices (`SAB_I32`): `GENERATION`, `CAPACITY_SLOTS`, `BODY_COUNT`,
`DYNAMIC_COUNT`, `STEPS`, `SKIPPED`, `POSE_SLOTS`, `VERSION`.

**Writer (worker)**

1. `Atomics.store(GENERATION, odd)` — writing  
2. Write floats + meta  
3. `Atomics.store(GENERATION, even)` — complete  

**Reader (main)**

1. Load generation; if odd → skip (keep previous)  
2. Read floats  
3. If generation changed → torn; keep previous  

**latest-complete-wins**: in-flight `step` does not block the next UI frame;
main keeps the last good poses.

## RenderBackend contract

```
present() / presentAsync()
resize(w, h, dpr?)
upsertMesh / removeMesh / applyPoses / setCamera   // worker; main no-ops
whenReady()
dispose()
```

**Modes**

- `main` (default) — wraps existing Three `renderer.render(scene, camera)`.
- `worker` — OffscreenCanvas + `render.worker.js` **isolated** primitive world.
- `auto` — try worker, fall back to main when host provides a main renderer.

**Flags**: `globalThis.__RENDER_BACKEND_MODE__`.

### Hard rule: primary canvas

Do **not** call `transferControlToOffscreen` on the lab primary canvas (`#c`)
until the full station scene graph has been migrated. Worker render is for:

- physics pose islands / previews  
- progressive cutover demos  
- tests with mock workers  

See `createOffscreenIsland` in this package.

## FrameBridge

Coordinates one frame for isolated pairs (and tests):

```
physics.step → collect poses → render.applyPoses → render.present
```

Optional `syncMainMeshes` keeps the SourceEngineAdapter mesh path working when
physics still drives main-thread Three objects.

```js
import { createFrameBridge, createPhysicsBackend, createRenderBackend } from './index.js';

const physics = createPhysicsBackend({ mode: 'main' });
const render = createRenderBackend({ mode: 'main', renderer, scene, camera });
const bridge = createFrameBridge({ physics, render, meshIds: [ballId] });
bridge.tick(1 / 60);
```

labShell still owns the real room present; FrameBridge is the contract for
worker pairs and smoke tests, not a forced replacement of the rAF loop.

## Host wiring (today)

| Host | Backend usage |
|------|----------------|
| `mechanicsSourceRuntime` | `createPhysicsBackend({ mode })` |
| `mechanics-source/core/engine` | main physics backend |
| freeFall / projectile / inclinedPlane | BodyHandle via labkit |
| `labShell` | `SimDriver` + `createRenderBackend({ mode: 'main' })` |
| `experiments/thermo` | `createSimBackend` mix / FD / ideal-gas / convection |
| `experiments/electro` | field lines / gauss metrics / hall carriers |
| `experiments/optics` | fringe samples / geometric angles |

## Public entry

```js
import {
  createPhysicsBackend,
  createRenderBackend,
  createFrameBridge,
  createOffscreenIsland,
  createSimBackend,
  createSimDriver,
  preferredWorkerSlot,
  POSE_STRIDE,
  BODY_TYPE,
  SIM_KIND,
} from './runtime/threading/index.js';
```

## Out of scope / next

- Zero-copy SAB → render worker (physics → main → render still copies today).
- Migrating primary `#c` + full station graph into a render worker.
- Custom COOP/COEP headers inside Tauri webview (product decision).
- Multi-station concurrent sims sharing a pool slot (today: exclusive or ad-hoc Worker).

## Testing

Node mock workers exercise postMessage protocols without real Worker / WebGL:

- `test/physicsBackend.test.js`
- `test/renderBackend.test.js`
- `test/simBackend.test.js`
- `test/threadingIndex.test.js`
- `test/simDriver.test.js`
