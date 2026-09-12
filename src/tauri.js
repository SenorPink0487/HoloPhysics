/**
 * Thin wrappers around the Tauri 2 JS API.
 * Safe to import from pure web builds — all calls no-op outside Tauri.
 */

export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Bind the renderer lifecycle to the native window without making web builds
 * import Tauri at startup. Focus covers hide/minimize; close is the final
 * release point and resize/scale invalidate the WebGL viewport.
 */
export async function installTauriWindowLifecycle({
  onHidden = () => {},
  onShown = () => {},
  onClose = () => {},
  onResize = () => {},
} = {}) {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const currentWindow = getCurrentWindow();
  const unlisten = await Promise.all([
    currentWindow.onFocusChanged(({ payload }) => {
      try { (payload ? onShown : onHidden)(); } catch { /* lifecycle is best effort */ }
    }),
    currentWindow.onResized(() => {
      try { onResize(); } catch { /* lifecycle is best effort */ }
    }),
    currentWindow.onScaleChanged(() => {
      try { onResize(); } catch { /* lifecycle is best effort */ }
    }),
    currentWindow.onCloseRequested(() => {
      try { onClose(); } catch { /* release must not block native close */ }
    }),
  ]);
  return () => unlisten.forEach((remove) => remove?.());
}

/** @returns {Promise<{ name: string, version: string, description: string } | null>} */
export async function getAppInfo() {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('app_info');
}

/**
 * Open a URL in the system browser (desktop only).
 * @param {string} url
 */
export async function openUrl(url) {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { openUrl: open } = await import('@tauri-apps/plugin-opener');
  await open(url);
}

/**
 * Opens an HTML report in the system default browser.
 * In desktop (Tauri), it invokes the native open_html_report command which writes
 * the HTML to a temporary file and opens it via the system default browser.
 * In web builds, it opens a new browser window/tab with blob fallback.
 * @param {string} html
 * @param {string} [title]
 * @returns {Promise<boolean> | boolean}
 */
export function openHtmlReport(html, title = '实验报告') {
  if (isTauri()) {
    return import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('open_html_report', { title, html }).then(() => true)
    );
  }
  const win = typeof window !== 'undefined' && window.open ? window.open('', '_blank') : null;
  if (!win) {
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return true;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}


