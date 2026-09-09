/**
 * Build-time performance budget gate.
 *
 * Boot graph = parser entry + the labShell dynamic import it always awaits,
 * plus each node's static imports. Intent-only dynamic imports (stations,
 * experiments, Cannon, MediaPipe, GLTF, PMREM) are excluded.
 *
 * Target: initial JS gzip ≤ 350 KiB. A small overage is allowed (soft warn
 * up to hardLimitKiB); only a large regression fails the gate.
 *
 * Usage: npm run check:perf   (expects dist/ from vite build)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const BUDGET = Object.freeze({
  /** Soft target from the performance plan. */
  initialJsGzipKiB: 350,
  /** Hard fail only above this — slight overage of the soft target is OK. */
  initialJsGzipHardKiB: 420,
  initialImageKiB: 750,
});

const FORBIDDEN_BOOT = [
  /stations\/(mechanics|thermo|optics|electro)/i,
  /experiments\/(mechanics|thermo|optics|electro)/i,
  /cannon-es/i,
  /@mediapipe/i,
  /tasks-vision/i,
  /GLTFLoader/i,
  /PMREMGenerator/i,
  /RoomEnvironment/i,
  /reli\/experiments/i,
  /handTracking/i,
  /arInteraction/i,
];

function fail(message) {
  console.error(`[check:perf] FAIL ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  console.warn(`[check:perf] WARN ${message}`);
}

function ok(message) {
  console.log(`[check:perf] OK   ${message}`);
}

function gzipSize(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Walk static imports only. Optionally seed extra keys (e.g. boot labShell).
 */
function walkStatic(manifest, keys, seen = new Set()) {
  const queue = [...keys];
  while (queue.length) {
    const key = queue.pop();
    if (!key || seen.has(key)) continue;
    const entry = manifest[key];
    if (!entry) continue;
    seen.add(key);
    for (const imp of entry.imports || []) queue.push(imp);
  }
  return seen;
}

function findManifest() {
  const candidates = [
    path.join(dist, '.vite', 'manifest.json'),
    path.join(dist, 'manifest.json'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function collectFiles(manifest, keys) {
  const files = new Set();
  for (const key of keys) {
    const entry = manifest[key];
    if (!entry) continue;
    if (entry.file) files.add(entry.file);
    for (const css of entry.css || []) files.add(css);
    for (const asset of entry.assets || []) files.add(asset);
  }
  return [...files];
}

/** labShell is the only dynamic import that always runs during cold boot. */
function bootDynamicSeeds(manifest, entryKey) {
  const entry = manifest[entryKey];
  const seeds = [];
  for (const dyn of entry?.dynamicImports || []) {
    const node = manifest[dyn];
    const name = node?.name || dyn;
    if (/labShell/i.test(name) || /labShell/i.test(dyn) || /labShell/i.test(node?.file || '')) {
      seeds.push(dyn);
    }
  }
  return seeds;
}

function main() {
  if (!fs.existsSync(dist)) {
    fail('dist/ missing — run npm run build first');
    return;
  }

  const manifestPath = findManifest();
  if (!manifestPath) {
    fail('vite manifest.json not found (build.manifest must be true)');
    return;
  }

  const manifest = readJson(manifestPath);
  const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry)
    || Object.keys(manifest).find((key) => /main\.(js|ts|mjs)$/.test(key))
    || 'index.html';

  if (!manifest[entryKey]) {
    fail(`entry key not found in manifest (tried ${entryKey})`);
    return;
  }

  const seeds = [entryKey, ...bootDynamicSeeds(manifest, entryKey)];
  const bootKeys = walkStatic(manifest, seeds);
  const bootFiles = collectFiles(manifest, bootKeys);

  let jsGzip = 0;
  let imageBytes = 0;
  const jsFiles = [];
  const imageFiles = [];

  for (const rel of bootFiles) {
    const abs = path.join(dist, rel);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    if (/\.(m?js|css)$/i.test(rel)) {
      const gz = gzipSize(buf);
      jsGzip += gz;
      jsFiles.push({ file: rel, gzip: gz });
    } else if (/\.(png|jpe?g|webp|gif|avif|svg|ico)$/i.test(rel)) {
      imageBytes += buf.length;
      imageFiles.push({ file: rel, bytes: buf.length });
    }
  }

  // HTML-referenced scripts that might not appear as manifest assets.
  const indexHtml = path.join(dist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    const html = fs.readFileSync(indexHtml, 'utf8');
    const re = /(?:src|href)="([^"]+\.(?:js|css))"/g;
    let match;
    while ((match = re.exec(html))) {
      const rel = match[1].replace(/^\//, '');
      if (bootFiles.includes(rel)) continue;
      const abs = path.join(dist, rel);
      if (!fs.existsSync(abs)) continue;
      const gz = gzipSize(fs.readFileSync(abs));
      jsGzip += gz;
      jsFiles.push({ file: rel, gzip: gz, via: 'html' });
    }
  }

  const jsKiB = jsGzip / 1024;
  const imgKiB = imageBytes / 1024;
  jsFiles.sort((a, b) => b.gzip - a.gzip);

  if (jsKiB > BUDGET.initialJsGzipHardKiB) {
    fail(`boot JS gzip ${jsKiB.toFixed(1)} KiB > hard limit ${BUDGET.initialJsGzipHardKiB} KiB`);
    jsFiles.slice(0, 12).forEach((f) => {
      console.error(`  ${(f.gzip / 1024).toFixed(1)} KiB  ${f.file}`);
    });
  } else if (jsKiB > BUDGET.initialJsGzipKiB) {
    warn(
      `boot JS gzip ${jsKiB.toFixed(1)} KiB > soft target ${BUDGET.initialJsGzipKiB} KiB `
      + `(allowed ≤ ${BUDGET.initialJsGzipHardKiB} KiB)`,
    );
    jsFiles.slice(0, 8).forEach((f) => {
      console.warn(`  ${(f.gzip / 1024).toFixed(1)} KiB  ${f.file}`);
    });
  } else {
    ok(`boot JS gzip ${jsKiB.toFixed(1)} KiB ≤ ${BUDGET.initialJsGzipKiB} KiB`);
  }

  if (imgKiB > BUDGET.initialImageKiB) {
    fail(`initial images ${imgKiB.toFixed(1)} KiB > ${BUDGET.initialImageKiB} KiB`);
  } else {
    ok(`initial images ${imgKiB.toFixed(1)} KiB ≤ ${BUDGET.initialImageKiB} KiB`);
  }

  // Forbidden modules must not appear in the boot graph (static + labShell).
  let forbiddenHit = false;
  for (const key of bootKeys) {
    for (const pattern of FORBIDDEN_BOOT) {
      if (pattern.test(key) || pattern.test(manifest[key]?.file || '')) {
        fail(`boot graph contains forbidden module: ${key}`);
        forbiddenHit = true;
      }
    }
  }
  if (!forbiddenHit) {
    ok('boot graph excludes station / Cannon / MediaPipe / GLTF / PMREM');
  }

  const summary = {
    entryKey,
    bootSeeds: seeds,
    initialJsGzip: jsGzip,
    initialJsGzipKiB: Number(jsKiB.toFixed(2)),
    initialImageBytes: imageBytes,
    initialImageKiB: Number(imgKiB.toFixed(2)),
    initialFiles: jsFiles,
    imageFiles,
    budget: BUDGET,
    ok: process.exitCode !== 1,
  };
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'output', 'perf-budget.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log('[check:perf] wrote output/perf-budget.json');
}

main();
