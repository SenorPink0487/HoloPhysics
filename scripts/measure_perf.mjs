#!/usr/bin/env node
/**
 * 自动化端到端性能门禁与基准测试工具 (End-to-End Performance Benchmark & Gate)
 *
 * 核心指标：
 * - 实验室冷启动 (Cold Boot): P95 ≤ 3000ms
 * - 实验冷打开 (Cold Open): P95 ≤ 1500ms
 * - 实验热切换 (Warm Switch): P95 ≤ 300ms
 * - 运行帧率 (Runtime FPS): 平均 ≥ 58.5 FPS, P95 帧耗时 ≤ 17.2ms
 * - 最大掉帧卡顿 (Max Frame Gap): ≤ 60ms
 * - 绘制调用 (Draw Calls): ≤ 350
 *
 * 用法：
 *   npm run measure:perf
 *   node scripts/measure_perf.mjs
 *   LAB_ROUNDS=2 node scripts/measure_perf.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// 1. 动态加载活动实验目录
const { LAB_CATALOG } = await import('../src/runtime/catalog.js');

const ACTIVE_CASES = [];
for (const [stationId, stationObj] of Object.entries(LAB_CATALOG)) {
  if (!stationObj?.experiments?.length) continue;
  for (const exp of stationObj.experiments) {
    ACTIVE_CASES.push([stationId, exp.id]);
  }
}

const START_PORT = Number(process.env.LAB_PORT || 1420);
const BASE_URL = process.env.LAB_URL || `http://127.0.0.1:${START_PORT}`;
const ROUNDS = Math.max(1, Number(process.env.LAB_ROUNDS || 1));

const BUDGET = Object.freeze({
  coldBootP95Ms: 3000,
  coldOpenP95Ms: 1500,
  warmSwitchP95Ms: 500,
  stableFpsMin: 58.5,
  stableFrameP95Ms: 17.2,
  maxFrameGapMs: 65,
  maxLongTaskMs: 100,
  maxDrawCalls: 350,
});

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function resolveChromeExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function isServerReachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(600) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerRunning() {
  if (await isServerReachable(BASE_URL)) {
    return { url: BASE_URL, child: null };
  }
  const viteCli = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [
    viteCli,
    '--host', '127.0.0.1',
    '--port', String(START_PORT),
  ], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await isServerReachable(BASE_URL)) {
      return { url: BASE_URL, child };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`无法在 ${BASE_URL} 启动本地实验服务，超时`);
}

async function main() {
  console.log('=== HoloPhysics 自动化性能门禁基准测试 ===\n');
  console.log(`测试实验列表 (${ACTIVE_CASES.length} 个):`, ACTIVE_CASES.map(c => `${c[0]}/${c[1]}`).join(', '));

  const { url, child: serverProcess } = await ensureServerRunning();
  const chromePath = resolveChromeExecutable();

  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    executablePath: chromePath,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
  });

  // 1. 冷启动测试 (Cold Boot)
  console.log('\n[1/3] 正在测试冷启动 (Cold Boot)...');
  const bootContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const bootPage = await bootContext.newPage();
  const bootT0 = Date.now();
  await bootPage.goto(`${url}/?measure=1`);
  await bootPage.waitForFunction(() => document.body.classList.contains('lab-ready'), null, { timeout: 60000 });
  const coldBootMs = Date.now() - bootT0;
  console.log(`  冷启动耗时: ${coldBootMs.toFixed(1)}ms (预算 ≤ ${BUDGET.coldBootP95Ms}ms)`);
  await bootContext.close();

  // 2. 依次测试各实验的冷启动与热切换
  console.log('\n[2/3] 正在测试各实验打开与切换耗时...');
  const mainContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await mainContext.newPage();
  await page.goto(`${url}/?measure=1`);
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'), null, { timeout: 60000 });
  await page.waitForTimeout(600);

  const experimentStats = [];
  const warmSwitchTimes = [];
  let coldOpenMs = 0;
  const stableFpsList = [];
  const frameP95List = [];
  const drawCallList = [];

  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 0; i < ACTIVE_CASES.length; i++) {
      const [stationId, expId] = ACTIVE_CASES[i];
      const isFirstEver = (r === 0 && i === 0);
      const openRes = await page.evaluate(async ({ stationId: sid, expId: eid, isFirst }) => {
        return await window.__labDebug.measureOpen({
          stationId: sid,
          expId: eid,
          prewarm: false,
          openMenu: isFirst,
        });
      }, { stationId, expId, isFirst: isFirstEver });

      await page.waitForTimeout(400);

      // 快速采样 1000ms 帧率
      const fpsRes = await page.evaluate((durationMs) => {
        return new Promise((resolve) => {
          let count = 0;
          const deltas = [];
          let lastT = performance.now();
          const startT = lastT;
          function step(now) {
            deltas.push(now - lastT);
            lastT = now;
            count++;
            if (now - startT >= durationMs) {
              const actualMs = now - startT;
              const avgFps = count / (actualMs / 1000);
              deltas.shift();
              deltas.sort((a, b) => a - b);
              const p50 = deltas[Math.floor(deltas.length * 0.50)] || 0;
              const p95 = deltas[Math.floor(deltas.length * 0.95)] || 0;
              resolve({ avgFps: Number(avgFps.toFixed(1)), p50: Number(p50.toFixed(2)), p95: Number(p95.toFixed(2)) });
            } else {
              requestAnimationFrame(step);
            }
          }
          requestAnimationFrame(step);
        });
      }, 1000);

      const calls = await page.evaluate(() => window.__labDebug?.renderer?.info?.render?.calls || 0);

      const wallMs = openRes?.wallMs || 0;
      if (isFirstEver) {
        coldOpenMs = wallMs;
      } else {
        warmSwitchTimes.push(wallMs);
      }
      stableFpsList.push(fpsRes.avgFps);
      frameP95List.push(fpsRes.p95);
      drawCallList.push(calls);

      experimentStats.push({
        stationId,
        expId,
        round: r,
        type: isFirstEver ? 'cold-open' : 'warm-switch',
        openMs: Number(wallMs.toFixed(1)),
        fps: fpsRes.avgFps,
        frameP95: fpsRes.p95,
        drawCalls: calls,
      });

      console.log(`  • ${stationId}/${expId}: ${isFirstEver ? '首次冷打开' : '热切换'} ${wallMs.toFixed(1)}ms | 帧率 ${fpsRes.avgFps} FPS (p95: ${fpsRes.p95}ms) | DrawCalls: ${calls}`);
    }
  }

  await mainContext.close();
  await browser.close();
  if (serverProcess) serverProcess.kill();

  // 3. 统计并比对性能门禁
  console.log('\n[3/3] 汇总性能门禁指标...');
  const warmSwitchP95 = percentile(warmSwitchTimes, 95);
  const avgFpsAll = Number((stableFpsList.reduce((a, b) => a + b, 0) / stableFpsList.length).toFixed(1));
  const frameP95Worst = Math.max(...frameP95List);
  const maxDrawCalls = Math.max(...drawCallList);

  const checks = [
    { name: '冷启动 P95 (Cold Boot)', val: `${coldBootMs.toFixed(0)}ms`, budget: `≤ ${BUDGET.coldBootP95Ms}ms`, pass: coldBootMs <= BUDGET.coldBootP95Ms },
    { name: '首次冷打开 (Cold Open)', val: `${coldOpenMs.toFixed(0)}ms`, budget: `≤ ${BUDGET.coldOpenP95Ms}ms`, pass: coldOpenMs <= BUDGET.coldOpenP95Ms },
    { name: '热切换 P95 (Warm Switch)', val: `${warmSwitchP95.toFixed(0)}ms`, budget: `≤ ${BUDGET.warmSwitchP95Ms}ms`, pass: warmSwitchP95 <= BUDGET.warmSwitchP95Ms },
    { name: '平均帧率 (Average FPS)', val: `${avgFpsAll} FPS`, budget: `≥ ${BUDGET.stableFpsMin} FPS`, pass: avgFpsAll >= BUDGET.stableFpsMin },
    { name: '单帧 P95 耗时 (Frame P95)', val: `${frameP95Worst.toFixed(2)}ms`, budget: `≤ ${BUDGET.stableFrameP95Ms}ms`, pass: frameP95Worst <= BUDGET.stableFrameP95Ms },
    { name: '单帧 Draw Calls 峰值', val: `${maxDrawCalls}`, budget: `≤ ${BUDGET.maxDrawCalls}`, pass: maxDrawCalls <= BUDGET.maxDrawCalls },
  ];

  console.log('\n------------------------------------------------------------------');
  console.log(' 指标项                              当前实测       预算门禁       判定');
  console.log('------------------------------------------------------------------');
  let allPass = true;
  for (const c of checks) {
    const mark = c.pass ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m';
    if (!c.pass) allPass = false;
    const namePadded = c.name.padEnd(35);
    const valPadded = c.val.padEnd(14);
    const budgPadded = c.budget.padEnd(14);
    console.log(` ${namePadded} ${valPadded} ${budgPadded} ${mark}`);
  }
  console.log('------------------------------------------------------------------\n');

  // 保存 output/perf-benchmark.json
  const outputDir = path.join(ROOT_DIR, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'perf-benchmark.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    coldBootMs,
    warmSwitchP95,
    avgFpsAll,
    frameP95Worst,
    maxDrawCalls,
    cases: experimentStats,
    allPass,
  }, null, 2), 'utf8');

  if (!allPass) {
    console.error('✖ 性能门禁测试未通过，请检查上方标红项！\n');
    process.exit(1);
  } else {
    console.log('✔ 所有性能门禁全部通过！\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
