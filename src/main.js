import { createLabLoader } from './loader.js';

// Keep the parser entry tiny. The room shell and its experiment modules are
// loaded after the loader has painted its first state.
const loader = createLabLoader();
loader.setProgress(0.02, 'Starting the laboratory');
document.body.classList.add('is-loading');
performance.mark?.('lab:bootstrap:start');

try {
  if (globalThis.PerformanceObserver) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50) console.warn('[lab:perf] long task', Math.round(entry.duration));
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  }
} catch { /* unsupported in WebKit/Tauri */ }

try {
  loader.setProgress(0.08, 'Loading the interactive room');
  await import('./labShell.js');
  performance.mark?.('lab:bootstrap:shell-ready');
  performance.measure?.('lab:bootstrap', 'lab:bootstrap:start', 'lab:bootstrap:shell-ready');
} catch (error) {
  console.error('[lab:bootstrap] failed', error);
  document.body.classList.remove('is-loading');
  document.body.dataset.bootError = 'true';
  loader.setProgress(1, 'Unable to load the laboratory');
  const status = document.querySelector('.loader-status');
  if (status) status.textContent = 'Reload to retry';
}
