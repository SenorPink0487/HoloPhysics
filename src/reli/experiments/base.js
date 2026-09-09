import * as THREE from 'three';
import { tempToColor } from '../lab/materials.js';

/**
 * Compatibility base for the original thermo apparatus.
 * The host room owns scene, camera, environment, lighting, shadows and input.
 */
export class Experiment {
  constructor(renderer, canvas, options = {}) {
    this.renderer = renderer;
    this.canvas = canvas;
    // Source setup() methods still add their legacy bench here, but the host
    // adapter mounts only `rig`; this detached group is never rendered.
    this.scene = options.scene || new THREE.Group();
    this.camera = options.camera || new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    this.controls = options.controls || {
      enabled: false,
      target: new THREE.Vector3(0, 1.4, 0),
      update() {},
      dispose() {},
    };
    this.clock = new THREE.Clock();
    this.params = {};
    this._disposed = false;
  }

  get meta() {
    return {
      id: 'base',
      name: 'Base',
      tag: '',
      title: '',
      description: '',
      formula: '',
    };
  }

  get controlDefs() {
    return [];
  }

  get readoutDefs() {
    return [];
  }

  setup() {
    // Subclasses build only their apparatus rig. Host presentation stays in
    // the shared room and is never duplicated per experiment.
  }

  reset() {
    this.clock.start();
  }

  update(_dt) {
    this.controls.update();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  getReadouts() {
    return {};
  }

  onParamChange(_key, _value) {}

  dispose() {
    this._disposed = true;
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }

  makeLabelSprite(text, color = '#c8d4e8') {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 640, 128);
    ctx.fillStyle = 'rgba(10, 16, 28, 0.72)';
    roundRect(ctx, 24, 28, 592, 72, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 212, 170, 0.35)';
    ctx.lineWidth = 2;
    roundRect(ctx, 24, 28, 592, 72, 16);
    ctx.stroke();

    ctx.font = '600 36px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 320, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.8, 0.36, 1);
    return sprite;
  }

  tempColor(t, tMin = 200, tMax = 600) {
    return tempToColor(t, tMin, tMax);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
