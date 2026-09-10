import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = fs.readFileSync(path.join(root, 'src-tauri', 'nsis', 'installer.nsi'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src', 'labShell.js'), 'utf8');

test('single-file build uses the MSVC Tauri binary directly', () => {
  assert.match(packageJson.scripts['build:tauri'], /tauri build .*x86_64-pc-windows-msvc.*-b nsis/);
});

test('desktop build is fixed to the MSVC target', () => {
  assert.match(packageJson.scripts['build:tauri'], /x86_64-pc-windows-msvc/);
  const cargoConfig = fs.readFileSync(path.join(root, 'src-tauri', '.cargo', 'config.toml'), 'utf8');
  assert.match(cargoConfig, /target\s*=\s*"x86_64-pc-windows-msvc"/);
});

test('NSIS installs only the single launcher and has no external WebView2 DLL copy', () => {
  assert.doesNotMatch(installer, /WebView2Loader\.dll/);
  assert.doesNotMatch(installer, /D:\\wuli/);
  assert.match(installer, /File "\$\{MAINBINARYSRCPATH\}"/);
  assert.match(installer, /Delete "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/);
});

test('boot creates station proxies instead of constructing electro at 26 percent', () => {
  assert.doesNotMatch(shell, /装配电磁学实验台/);
  assert.match(shell, /const station = createStationProxy\(stationId\)/);
  assert.match(shell, /ensureStationLoaded\(stationId\)/);
});
