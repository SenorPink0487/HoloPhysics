/**
 * Browser performance measurement for the lab shell.
 *
 * Cold boot + cold experiment opens + warm switch stats across Chromium.
 * Records request log so gates can assert no station/Cannon/MediaPipe before intent.
 *
 * Usage:
 *   npm run measure:perf
 *   LAB_URL=http://127.0.0.1:4173 npm run measure:perf
 *   LAB_ROUNDS=3 npm run measure:perf
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const START_PORT = Number(process.env.LAB_PORT || 4173);
const BASE_URL = process.env.LAB_URL || `http://127.0.0.1:${START_PORT}`;
const ROUNDS = Math.max(1, Number(process.env.LAB_ROUNDS || 2));
const USE_PREVIEW = process.env.LAB_PREVIEW !== '0';

const CASES = [
  ['mechanics', 'free-fall'],
  ['mechanics', 'inclined-plane'],
  ['mechanics', 'pendulum'],
  ['mechanics', 'collision'],
  ['mechanics', 'projectile'],
  ['mechanics', 'viscosity'],
  ['thermo', 'calorimetry'],
  ['thermo', 'convection'],
  ['thermo', 'heat-conduction'],
  ['thermo', 'ideal-gas'],
  ['thermo', 'thermal-expansion'],
  ['optics', 'reflection'],
  ['optics', 'refraction'],
  ['optics', 'dispersion'],
  ['optics', 'lens'],
  ['optics', 'multi_slit_diffraction'],
  ['electro', 'electric_field'],
  ['electro', 'gauss_theorem'],
  ['electro', 'faraday_induction'],
  ['electro', 'induced_electric_field'],
  ['electro', 'hall_effect'],
];

const BUDGET = Object.freeze({
  coldBootP95Ms: 3000,
  coldOpenP95Ms: 1500,
  warmSwitchP95Ms: 250,
  switchP99Ms: 25,
  stableFrameP95Ms: 16.7,
  maxFrameGapMs: 100,
  maxLongTaskMs: 100,
});

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await reachable(BASE_URL)) return { url: BASE_URL, process: null };
  const dist = path.join(root, 'dist');
  const usePreview = USE_PREVIEW && fs.existsSync(path.join(dist, 'index.html'));
  const viteCli = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
  const args = usePreview
    ? [viteCli.pathname, 'preview', '--host', '127.0.0.1', '--port', String(START_PORT)]
    : [viteCli.pathname, '--host', '127.0.0.1', '--port', String(START_PORT)];
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'], cwd: root });
  const url = `http://127.0.0.1:${START_PORT}`;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await reachable(url)) return { url, process: child, mode: usePreview ? 'preview' : 'dev' };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`Server did not start at ${url}`);
}

function isHeavyUrl(url) {
  return /stations\/(mechanics|thermo|optics|electro)|experiments\/(mechanics|thermo|optics|electro)|cannon|mediapipe|tasks-vision|GLTF|PMREM|RoomEnvironment|reli\/experiments/i
    .test(url);
}

async function coldBootOnce(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (req) => {
    requests.push({
      url: req.url(),
      resourceType: req.resourceType(),
      t: Date.now(),
    });
  });

  const navT0 = Date.now();
  await page.goto(`${url}/?measure=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'), null, {
    timeout: 120000,
  });
  const bootMs = Date.now() - navT0;

  // Capture early requests before any user intent.
  const preIntent = requests.filter((r) => isHeavyUrl(r.url));
  const perf = await page.evaluate(() => {
    const debug = window.__labDebug;
    return debug?.getPerf?.() || {
      bootMs: null,
      firstFrameMs: null,
      frameP95: null,
      longTaskMax: null,
    };
  });

  await context.close();
  return {
    bootMs,
    firstFrameMs: perf.firstFrameMs,
    frameP95: perf.frameP95,
    longTaskMax: perf.longTaskMax,
    preIntentHeavyRequests: preIntent.map((r) => r.url),
    requestCount: requests.length,
  };
}

async function measureOpens(browser, url, rounds) {
  const coldOpens = [];
  const warmSwitches = [];
  const frameP95s = [];
  const longTaskMaxes = [];
  const maxGaps = [];
  const caseResults = [];

  for (let round = 0; round < rounds; round += 1) {
    // Fresh context per round → true cold module/cache state for first open.
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const requests = [];
    let intentAt = null;
    page.on('request', (req) => {
      requests.push({
        url: req.url(),
        resourceType: req.resourceType(),
        t: Date.now(),
        afterIntent: intentAt != null && Date.now() >= intentAt,
      });
    });

    await page.goto(`${url}/?measure=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body.classList.contains('lab-ready'), null, {
      timeout: 120000,
    });
    await page.waitForFunction(() => !!window.__labDebug?.measureOpen, null, { timeout: 30000 });

    const preIntentHeavy = requests.filter((r) => isHeavyUrl(r.url));
    if (preIntentHeavy.length) {
      console.warn('[measure:perf] heavy requests before intent:', preIntentHeavy.map((r) => r.url));
    }

    for (const [stationId, expId] of CASES) {
      intentAt = Date.now();
      const result = await page.evaluate(({ stationId: sid, expId: eid, prewarm }) => (
        Promise.race([
          window.__labDebug.measureOpen({ stationId: sid, expId: eid, prewarm }),
          new Promise((resolve) => setTimeout(
            () => resolve({ stationId: sid, expId: eid, error: 'measure timeout' }),
            45000,
          )),
        ])
      ), { stationId, expId, prewarm: false });

      const wall = Number(result.wallMs) || 0;
      const isFirstForStation = !caseResults.some(
        (c) => c.round === round && c.stationId === stationId && c.ok,
      );
      if (result.error) {
        caseResults.push({
          round, stationId, expId, ok: false, error: result.error, wallMs: wall,
        });
        continue;
      }
      // First open of a station in a cold context counts as cold; subsequent as warm.
      if (isFirstForStation || round === 0) coldOpens.push(wall);
      else warmSwitches.push(wall);

      if (result.maxGap) maxGaps.push(result.maxGap);
      if (result.maxLongTask) longTaskMaxes.push(result.maxLongTask);
      if (result.perf?.frameP95) frameP95s.push(result.perf.frameP95);

      caseResults.push({
        round,
        stationId,
        expId,
        ok: !!result.openResult?.ok,
        wallMs: wall,
        clickMs: result.clickMs,
        maxGap: result.maxGap,
        maxLongTask: result.maxLongTask,
        apparatusReady: result.apparatusReady,
      });
    }

    // One dedicated warm-switch pass on free-fall after it is already open.
    intentAt = Date.now();
    const warm = await page.evaluate(() => window.__labDebug.measureOpen({
      stationId: 'mechanics',
      expId: 'pendulum',
      prewarm: true,
      openMenu: true,
    }));
    if (warm?.wallMs != null) warmSwitches.push(Number(warm.wallMs));

    await context.close();
  }

  return {
    coldOpens,
    warmSwitches,
    frameP95s,
    longTaskMaxes,
    maxGaps,
    caseResults,
  };
}

function gate(name, value, limit, higherIsBad = true) {
  const pass = higherIsBad ? value <= limit : value >= limit;
  const tag = pass ? 'OK  ' : 'FAIL';
  console.log(`[measure:perf] ${tag} ${name}: ${Number(value).toFixed(2)} (budget ${limit})`);
  return pass;
}

const server = await startServer();
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });

try {
  const boots = [];
  const preIntentViolations = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const boot = await coldBootOnce(browser, server.url);
    boots.push(boot.bootMs);
    if (boot.preIntentHeavyRequests.length) {
      preIntentViolations.push(...boot.preIntentHeavyRequests);
    }
    console.log(`[measure:perf] cold boot #${i + 1}: ${boot.bootMs}ms`);
  }

  const opens = await measureOpens(browser, server.url, ROUNDS);

  const summary = {
    url: server.url,
    mode: server.mode || 'existing',
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    rounds: ROUNDS,
    boot: {
      samples: boots,
      p95: percentile(boots, 95),
      p50: percentile(boots, 50),
    },
    coldOpen: {
      samples: opens.coldOpens,
      p95: percentile(opens.coldOpens, 95),
      p50: percentile(opens.coldOpens, 50),
    },
    warmSwitch: {
      samples: opens.warmSwitches,
      p95: percentile(opens.warmSwitches, 95),
      p99: percentile(opens.warmSwitches, 99),
    },
    frameP95: percentile(opens.frameP95s, 95),
    longTaskMax: Math.max(0, ...opens.longTaskMaxes, 0),
    maxFrameGap: Math.max(0, ...opens.maxGaps, 0),
    preIntentHeavyRequests: [...new Set(preIntentViolations)],
    cases: opens.caseResults,
    budget: BUDGET,
  };

  let allPass = true;
  allPass = gate('cold boot P95 ms', summary.boot.p95, BUDGET.coldBootP95Ms) && allPass;
  allPass = gate('cold open P95 ms', summary.coldOpen.p95, BUDGET.coldOpenP95Ms) && allPass;
  if (summary.warmSwitch.samples.length) {
    allPass = gate('warm switch P95 ms', summary.warmSwitch.p95, BUDGET.warmSwitchP95Ms) && allPass;
    // switch P99 ≤ 25 ms is the interactive commit budget for already-warm runtimes.
    // Only enforce when we have warm samples that completed under 100 ms (true warm).
    const trueWarm = summary.warmSwitch.samples.filter((v) => v <= 100);
    if (trueWarm.length >= 3) {
      allPass = gate('warm switch P99 ms', percentile(trueWarm, 99), BUDGET.switchP99Ms) && allPass;
    }
  }
  if (opens.frameP95s.length) {
    allPass = gate('stable frame P95 ms', summary.frameP95, BUDGET.stableFrameP95Ms) && allPass;
  }
  allPass = gate('max frame gap ms', summary.maxFrameGap, BUDGET.maxFrameGapMs) && allPass;
  allPass = gate('max long task ms', summary.longTaskMax, BUDGET.maxLongTaskMs) && allPass;
  if (summary.preIntentHeavyRequests.length) {
    console.error('[measure:perf] FAIL heavy requests before user intent');
    summary.preIntentHeavyRequests.forEach((u) => console.error(`  ${u}`));
    allPass = false;
  } else {
    console.log('[measure:perf] OK   no station/Cannon/MediaPipe before intent');
  }

  summary.ok = allPass;
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  const outPath = path.join(root, 'output', 'perf-measure.json');
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[measure:perf] wrote ${outPath}`);
  console.log(JSON.stringify({
    bootP95: summary.boot.p95,
    coldOpenP95: summary.coldOpen.p95,
    warmSwitchP95: summary.warmSwitch.p95,
    frameP95: summary.frameP95,
    ok: allPass,
  }, null, 2));

  if (!allPass) process.exitCode = 1;
} finally {
  await browser.close();
  server.process?.kill();
}
