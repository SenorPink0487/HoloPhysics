/**
 * Resolves API URLs for both the website and packaged Tauri application.
 *
 * Web builds keep relative `/api/*` paths so the hosting web server's reverse
 * proxy remains the single ingress. A packaged Tauri webview has no HTTP
 * origin, so it uses that same ingress explicitly instead of connecting to an
 * AI provider or a local sidecar directly.
 */
const DESKTOP_API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || 'https://hologrip.cn').replace(/\/+$/, '');

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  return isTauriRuntime() ? `${DESKTOP_API_ORIGIN}${path}` : path;
}

export function apiWebSocketUrl(path: string): string {
  const url = new URL(apiUrl(path), window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
