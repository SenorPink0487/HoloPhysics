import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

/**
 * Cross-origin isolation so SharedArrayBuffer is available for the physics
 * worker pose path (Phase 2). COEP credentialless is enough for same-origin
 * workers/modules and avoids breaking most third-party assets that lack CORP.
 */
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [],
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Keep one three.js graph even when a parent monorepo also depends on three.
  resolve: {
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: ['three'],
  },

  server: {
    port: 1420,
    // If 1420 is occupied, Vite automatically tries the next available port.
    strictPort: false,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    headers: crossOriginIsolationHeaders,
    watch: {
      // Ignore Rust crate to avoid unnecessary reloads
      ignored: ['**/src-tauri/**'],
    },
  },

  preview: {
    headers: crossOriginIsolationHeaders,
  },

  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // es2022 for top-level await (boot yields between station builds).
    // Tauri desktops: Chromium 105+ / Safari 15+ both support TLA.
    target: process.env.TAURI_ENV_PLATFORM === 'windows'
      ? 'chrome105'
      : process.env.TAURI_ENV_PLATFORM
        ? 'safari15'
        : 'es2022',
    // Don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Manifest enables check:perf recursive entry gzip accounting.
    manifest: true,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
