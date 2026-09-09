/**
 * Experiment open timing harness.
 *
 * Supports true cold contexts (fresh browser context per case when LAB_COLD=1),
 * multi-round stats, and request logging for station/Cannon/MediaPipe gates.
 *
 * Usage:
 *   node scripts/measure_experiment_open.mjs
 *   node scripts/measure_experiment_open.mjs all
 *   node scripts/measure_experiment_open.mjs mechanics/pendulum
 *   LAB_COLD=1 LAB_ROUNDS=3 node scripts/measure_experiment_open.mjs all
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const START_PORT = Number(process.env.LAB_PORT || 4173);
const BASE_URL = process.env.LAB_URL || `http://127.0.0.1:${START_PORT}`;
const ROUNDS = Math.max(1, Number(process.env.LAB_ROUNDS || 1));
const COLD = process.env.LAB_COLD === '1';

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

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startDevServer() {
  if (await reachable(BASE_URL)) return { url: BASE_URL, process: null };
  const viteCli = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
  const child = spawn(process.execPath, [
    fileURLToPath(viteCli),
    '--host', '127.0.0.1', '--port', String(START_PORT),
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  const url = `http://127.0.0.1:${START_PORT}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await reachable(url)) return { url, process: child };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`Vite did not start at ${url}`);
}

function selectedCases(arg) {
  if (!arg || arg === 'all') return CASES;
  const [stationId, expId] = arg.split('/');
  const match = CASES.find(([station, exp]) => station === stationId && exp === expId);
  if (!match) throw new Error(`Unknown case ${arg}; use station/experiment or all`);
  return [match];
}

function isHeavyUrl(url) {
  return /stations\/(mechanics|thermo|optics|electro)|experiments\/(mechanics|thermo|optics|electro)|cannon|mediapipe|tasks-vision|GLTF|PMREM|RoomEnvironment|reli\/experiments/i
    .test(url);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const targetCases = selectedCases(process.argv[2]);
const server = await startDevServer();
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
const consoleErrors = [];
const allResults = [];
const bootRequests = [];

async function runCase(page, stationId, expId, { prewarm, openMenu, measurementType }) {
  const result = await page.evaluate(({ stationId: sid, expId: eid, prewarm: shouldPrewarm, openMenu: shouldOpenMenu }) => (
    Promise.race([
      window.__labDebug.measureOpen({
        stationId: sid,
        expId: eid,
        prewarm: shouldPrewarm,
        openMenu: shouldOpenMenu,
      }),
      new Promise((resolve) => setTimeout(
        () => resolve({ stationId: sid, expId: eid, error: 'measure timeout' }),
        30000,
      )),
    ])
  ), { stationId, expId, prewarm, openMenu });
  return {
    ...result,
    measurementType,
    ...(measurementType === 'first-open'
      ? { firstOpenMs: result.wallMs }
      : { switchMs: result.wallMs }),
  };
}

async function preparePage(context) {
  const page = await context.newPage();
  const requestLog = [];
  page.on('request', (req) => {
    requestLog.push({
      url: req.url(),
      resourceType: req.resourceType(),
      t: Date.now(),
      heavy: isHeavyUrl(req.url()),
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (process.env.LAB_TRACE === '1' && (message.text().includes('[open-trace]') || message.text().includes('[frame-trace]') || message.text().includes('[render-trace]') || message.text().includes('[post-trace]') || message.text().includes('[post-prewarm-trace]') || message.text().includes('[gpu-prewarm-trace]') || message.text().includes('[gpu-prewarm-render-trace]'))) {
      console.error(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(`${server.url}/?measure=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'), null, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__labDebug?.measureOpen, null, { timeout: 30000 });

  const preIntentHeavy = requestLog.filter((r) => r.heavy);
  bootRequests.push(...preIntentHeavy.map((r) => r.url));

  return { page, requestLog, preIntentHeavy };
}

try {
  const prewarm = process.env.LAB_PREWARM === '1';

  for (let round = 0; round < ROUNDS; round += 1) {
    if (COLD) {
      // True cold: one fresh context per experiment.
      for (const [stationId, expId] of targetCases) {
        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 1,
        });
        const { page, requestLog, preIntentHeavy } = await preparePage(context);
        const result = await runCase(page, stationId, expId, {
          prewarm,
          openMenu: true,
          measurementType: 'first-open',
        });
        allResults.push({
          ...result,
          round,
          cold: true,
          preIntentHeavy: preIntentHeavy.map((r) => r.url),
          requestCount: requestLog.length,
          stationRequests: requestLog.filter((r) => /stations\//i.test(r.url)).map((r) => r.url),
          experimentRequests: requestLog.filter((r) => /experiments\//i.test(r.url)).map((r) => r.url),
        });
        await context.close();
      }
    } else {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      const { page, requestLog, preIntentHeavy } = await preparePage(context);
      let previousStation = null;
      for (const [stationId, expId] of targetCases) {
        const before = requestLog.length;
        const measurementType = previousStation === stationId ? 'switch' : 'first-open';
        const result = await runCase(page, stationId, expId, {
          prewarm,
          openMenu: measurementType === 'first-open',
          measurementType,
        });
        const during = requestLog.slice(before);
        allResults.push({
          ...result,
          round,
          cold: false,
          preIntentHeavy: preIntentHeavy.map((r) => r.url),
          requestsDuringOpen: during.filter((r) => r.heavy).map((r) => r.url),
        });
        previousStation = stationId;
      }
      await context.close();
    }
  }

  const walls = allResults.map((r) => Number(r.wallMs) || 0).filter((n) => n > 0);
  const firstOpenWalls = allResults
    .filter((r) => r.measurementType === 'first-open')
    .map((r) => Number(r.firstOpenMs) || 0)
    .filter((n) => n > 0);
  const switchWalls = allResults
    .filter((r) => r.measurementType === 'switch')
    .map((r) => Number(r.switchMs) || 0)
    .filter((n) => n > 0);
  const output = {
    url: server.url,
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    rounds: ROUNDS,
    cold: COLD,
    cases: allResults,
    stats: {
      openP50: percentile(walls, 50),
      openP95: percentile(walls, 95),
      openP99: percentile(walls, 99),
      count: walls.length,
      firstOpenP50: percentile(firstOpenWalls, 50),
      firstOpenP95: percentile(firstOpenWalls, 95),
      switchP50: percentile(switchWalls, 50),
      switchP95: percentile(switchWalls, 95),
      firstOpenCount: firstOpenWalls.length,
      switchCount: switchWalls.length,
    },
    preIntentHeavyRequests: [...new Set(bootRequests)],
    consoleErrors,
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
  server.process?.kill();
}
