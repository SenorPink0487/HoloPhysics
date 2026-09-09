import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Fixed high-quality post-processing chain for HoloPhysics.
 *
 * The chain is deliberately owned by the physics page instead of the rocket
 * page so RenderTargets and pass state cannot leak between standalone apps.
 */
export function createPhysicsPostProcessing({ renderer, scene, camera, quality = {} } = {}) {
  if (!renderer || !scene || !camera) {
    throw new TypeError('createPhysicsPostProcessing requires renderer, scene and camera');
  }

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  // Bloom is an accent layer, not a second lighting system. Keep the
  // threshold above ordinary white materials so the room does not turn into
  // a clipped white fog when several emissive props are visible.
  const bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0.12, 0.48, 1.05);
  const ssaoPass = new SSAOPass(scene, camera, 1, 1);
  const outputPass = new OutputPass();

  bloomPass.enabled = quality.bloomEnabled !== false;
  bloomPass.resolution.set(1, 1);
  bloomPass.threshold = 1.05;
  bloomPass.strength = 0.12;
  bloomPass.radius = 0.48;

  ssaoPass.enabled = true;
  ssaoPass.kernelRadius = 9;
  ssaoPass.minDistance = 0.0015;
  ssaoPass.maxDistance = 0.12;

  composer.addPass(renderPass);
  composer.addPass(ssaoPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  const traceEnabled = () => typeof window !== 'undefined' && (
    window.__LAB_TRACE
    || new URLSearchParams(window.location.search).has('trace')
    || new URLSearchParams(window.location.search).has('measure')
  );

  function resize(nextWidth, nextHeight, nextPixelRatio = pixelRatio) {
    width = Math.max(1, Number(nextWidth) || 1);
    height = Math.max(1, Number(nextHeight) || 1);
    pixelRatio = Math.max(0.5, Number(nextPixelRatio) || 1);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    const bloomScale = Math.max(0.5, Math.min(1, Number(quality.bloomScale) || 0.75));
    bloomPass.resolution.set(
      Math.max(1, Math.floor(width * pixelRatio * bloomScale)),
      Math.max(1, Math.floor(height * pixelRatio * bloomScale)),
    );
  }

  let prewarmed = false;

  return {
    composer,
    bloomPass,
    ssaoPass,
    render() {
      const trace = traceEnabled();
      const startedAt = trace ? performance.now() : 0;
      const programsBefore = trace ? (renderer.info?.programs?.length || 0) : 0;
      composer.render();
      if (trace) {
        console.warn('[post-trace]', JSON.stringify({
          ms: Number((performance.now() - startedAt).toFixed(1)),
          programsBefore,
          programsAfter: renderer.info?.programs?.length || 0,
          calls: renderer.info?.render?.calls || 0,
          width,
          height,
          pixelRatio,
        }));
      }
    },
    /**
     * Compile the post-processing passes while an experiment switch loader is
     * still covering the lab. Three's renderer.compile() cannot see the
     * fullscreen pass materials, so the first real composer.render() would
     * otherwise still pay the pass shader setup on the click frame.
     */
    prewarm() {
      if (prewarmed) return;
      prewarmed = true;
      const trace = traceEnabled();
      const startedAt = trace ? performance.now() : 0;
      const programsBefore = trace ? (renderer.info?.programs?.length || 0) : 0;
      const previousRenderToScreen = outputPass.renderToScreen;
      try {
        // A 1×1 pass is sufficient to touch the same post-process programs and
        // keeps the warmup from spending a full-screen quad cost twice.
        outputPass.renderToScreen = false;
        composer.setPixelRatio(1);
        composer.setSize(1, 1);
        composer.render();
      } finally {
        outputPass.renderToScreen = previousRenderToScreen;
        resize(width, height, pixelRatio);
      }
      if (trace) {
        console.warn('[post-prewarm-trace]', JSON.stringify({
          ms: Number((performance.now() - startedAt).toFixed(1)),
          programsBefore,
          programsAfter: renderer.info?.programs?.length || 0,
        }));
      }
    },
    resize,
    dispose() {
      composer.dispose?.();
      renderPass.dispose?.();
      bloomPass.dispose?.();
      ssaoPass.dispose?.();
      outputPass.dispose?.();
    },
    getSize() {
      return { width, height, pixelRatio };
    },
  };
}
