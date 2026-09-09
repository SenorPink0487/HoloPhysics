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
