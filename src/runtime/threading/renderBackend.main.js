/**
 * Main-thread RenderBackend — thin wrapper around an existing Three.js present.
 *
 * labShell keeps owning scene/camera/renderer construction; this adapter is the
 * stable seam for FrameCoordinator and a future worker swap.
 */

/**
 * @param {{
 *   renderer: { render: Function, setSize?: Function, setPixelRatio?: Function, dispose?: Function },
 *   scene: unknown,
 *   camera: unknown,
 *   onAfterPresent?: (ms: number) => void,
 *   render?: () => void,
 * }} options
 */
export function createMainRenderBackend(options = {}) {
  const { renderer, scene, camera, onAfterPresent, render } = options;
  if (!renderer || typeof renderer.render !== 'function') {
    throw new TypeError('createMainRenderBackend: renderer.render is required');
  }

  let disposed = false;
  let lastPresentMs = 0;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;

  return {
    kind: 'main',

    get lastPresentMs() { return lastPresentMs; },
    get width() { return width; },
    get height() { return height; },
    get pixelRatio() { return pixelRatio; },

    /**
     * No-op on main — scene graph already lives here.
     * Kept so worker/main share the same surface.
     */
    upsertMesh() { return false; },
    removeMesh() { return false; },
    applyPoses() { return false; },
    setCamera() { return false; },
    setClearColor() { return false; },

    resize(w, h, dpr) {
      if (disposed) return false;
      width = Math.max(1, w | 0);
      height = Math.max(1, h | 0);
      if (dpr != null) pixelRatio = Number(dpr) || 1;
      if (typeof renderer.setPixelRatio === 'function' && dpr != null) {
        renderer.setPixelRatio(pixelRatio);
      }
      if (typeof renderer.setSize === 'function') {
        // updateStyle false — labShell already sizes the DOM canvas.
        renderer.setSize(width, height, false);
      }
      return true;
    },

    /**
     * Present one frame. Synchronous on main.
     * @returns {{ presented: boolean, ms: number, deferred?: boolean }}
     */
    present() {
      if (disposed) return { presented: false, ms: 0 };
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (typeof render === 'function') render();
      else renderer.render(scene, camera);
      lastPresentMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      onAfterPresent?.(lastPresentMs);
      return { presented: true, ms: lastPresentMs, deferred: false };
    },

    /** Main present is already complete — resolve immediately. */
    async presentAsync() {
      return this.present();
    },

    whenReady() {
      return Promise.resolve(true);
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      // Do not dispose the shared lab renderer/scene — host owns lifetime.
      return true;
    },
  };
}
