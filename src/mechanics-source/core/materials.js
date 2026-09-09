import * as THREE from 'three';

/** Shared modern-lab material palette + procedural maps */

const texCache = new Map();

function canvasTexture(draw, size = 512, opts = {}) {
  const key = opts.key || draw.toString() + size;
  if (texCache.has(key)) return texCache.get(key);

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  texCache.set(key, tex);
  return tex;
}

export function floorTileMap() {
  return canvasTexture(
    (ctx, s) => {
      // cool epoxy lab floor with subtle grid
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, '#1a2338');
      g.addColorStop(0.5, '#151c2e');
      g.addColorStop(1, '#1c2640');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      const tile = s / 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const px = x * tile;
          const py = y * tile;
          const shade = ((x + y) % 2) * 6;
          ctx.fillStyle = `rgba(120, 150, 200, ${0.03 + shade * 0.004})`;
          ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
          ctx.strokeStyle = 'rgba(180, 200, 230, 0.08)';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, tile - 2, tile - 2);
        }
      }

      // speckles
      for (let i = 0; i < 800; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
      }
    },
    1024,
    { key: 'floorTile', repeat: [6, 6] }
  );
}

export function wallMap() {
  return canvasTexture(
    (ctx, s) => {
      ctx.fillStyle = '#d8dee8';
      ctx.fillRect(0, 0, s, s);
      // soft noise
      for (let i = 0; i < 4000; i++) {
        const a = Math.random() * 0.04;
        ctx.fillStyle = `rgba(0,0,0,${a})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      // horizontal panel lines
      ctx.strokeStyle = 'rgba(100, 120, 140, 0.12)';
      ctx.lineWidth = 2;
      for (let y = 0; y < s; y += s / 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
      }
    },
    512,
    { key: 'wall', repeat: [4, 2] }
  );
}

export function brushedMetalMap() {
  return canvasTexture(
    (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#c8d0dc');
      g.addColorStop(0.5, '#9aa6b8');
      g.addColorStop(1, '#b8c2d0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i++) {
        const a = 0.02 + Math.random() * 0.08;
        ctx.fillStyle = `rgba(${200 + Math.random() * 40},${210 + Math.random() * 30},${220}, ${a})`;
        ctx.fillRect(0, i, s, 1);
      }
      // occasional bright streaks
      for (let i = 0; i < 40; i++) {
        const y = Math.random() * s;
        ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.06})`;
        ctx.fillRect(0, y, s, 1 + Math.random() * 2);
      }
    },
    512,
    { key: 'brushed', repeat: [2, 2] }
  );
}

export function carbonFiberMap() {
  return canvasTexture(
    (ctx, s) => {
      ctx.fillStyle = '#1a1e24';
      ctx.fillRect(0, 0, s, s);
      const step = 8;
      for (let y = 0; y < s; y += step) {
        for (let x = 0; x < s; x += step) {
          const on = (Math.floor(x / step) + Math.floor(y / step)) % 2 === 0;
          ctx.fillStyle = on ? '#252a32' : '#14181e';
          ctx.fillRect(x, y, step, step);
        }
      }
      // diagonal weave highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      for (let i = -s; i < s * 2; i += 6) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + s, s);
        ctx.stroke();
      }
    },
    256,
    { key: 'carbon', repeat: [4, 4] }
  );
}

export function woodMap() {
  return canvasTexture(
    (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, 0);
      g.addColorStop(0, '#8b6914');
      g.addColorStop(0.3, '#c4a35a');
      g.addColorStop(0.55, '#a67c3d');
      g.addColorStop(0.8, '#d4b56a');
      g.addColorStop(1, '#9a7430');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 120; i++) {
        const y = Math.random() * s;
        ctx.strokeStyle = `rgba(60, 35, 10, ${0.05 + Math.random() * 0.12})`;
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + Math.random() * 8 - 4, s * 0.7, y + Math.random() * 8 - 4, s, y);
        ctx.stroke();
      }
    },
    512,
    { key: 'wood', repeat: [2, 1] }
  );
}

export function checkerMap(c1 = '#2a3348', c2 = '#1e2638') {
  return canvasTexture(
    (ctx, s) => {
      const n = 8;
      const t = s / n;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          ctx.fillStyle = (x + y) % 2 ? c1 : c2;
          ctx.fillRect(x * t, y * t, t, t);
        }
      }
    },
    256,
    { key: `chk-${c1}-${c2}`, repeat: [2, 2] }
  );
}

export const Mats = {
  brushedAluminum() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xc5cedc,
      map: brushedMetalMap(),
      metalness: 0.92,
      roughness: 0.28,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
    });
  },

  darkMetal() {
    return new THREE.MeshPhysicalMaterial({
      color: 0x3a4250,
      map: brushedMetalMap(),
      metalness: 0.85,
      roughness: 0.35,
      clearcoat: 0.2,
    });
  },

  chrome() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xe8eef8,
      metalness: 1,
      roughness: 0.08,
      envMapIntensity: 1.2,
    });
  },

  /** Matte ball colors — no metal / clearcoat / env reflections */
  ballBlue() {
    return new THREE.MeshStandardMaterial({
      color: 0x3d7aef,
      metalness: 0,
      roughness: 0.92,
      envMapIntensity: 0,
    });
  },

  ballRed() {
    return new THREE.MeshStandardMaterial({
      color: 0xe84a66,
      metalness: 0,
      roughness: 0.92,
      envMapIntensity: 0,
    });
  },

  ballTeal() {
    return new THREE.MeshStandardMaterial({
      color: 0x22c49a,
      metalness: 0,
      roughness: 0.92,
      envMapIntensity: 0,
    });
  },

  anodizedBlue() {
    return this.ballBlue();
  },

  anodizedRed() {
    return this.ballRed();
  },

  anodizedTeal() {
    return this.ballTeal();
  },

  anodizedOrange() {
    return new THREE.MeshStandardMaterial({
      color: 0xff9a3c,
      metalness: 0,
      roughness: 0.85,
      envMapIntensity: 0,
    });
  },

  matteBlack() {
    return new THREE.MeshStandardMaterial({
      color: 0x1a1d24,
      metalness: 0.15,
      roughness: 0.85,
    });
  },

  labPlastic(color = 0x2b3344) {
    return new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.05,
      roughness: 0.45,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
    });
  },

  rubber(color = 0x22262e) {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.05,
      roughness: 0.92,
    });
  },

  acrylic(color = 0x88b4ff, opacity = 0.35) {
    return new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0,
      roughness: 0.08,
      transparent: true,
      opacity,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
  },

  glass() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.05,
      transparent: true,
      opacity: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
  },

  led(color = 0x3ee0b0) {
    return new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.8,
      metalness: 0.2,
      roughness: 0.35,
    });
  },

  screen() {
    return new THREE.MeshStandardMaterial({
      color: 0x0a1628,
      emissive: 0x0d2848,
      emissiveIntensity: 0.6,
      metalness: 0.4,
      roughness: 0.25,
    });
  },

  woodBench() {
    return new THREE.MeshPhysicalMaterial({
      map: woodMap(),
      color: 0xffffff,
      metalness: 0.05,
      roughness: 0.55,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4,
    });
  },

  carbon() {
    return new THREE.MeshPhysicalMaterial({
      map: carbonFiberMap(),
      color: 0xffffff,
      metalness: 0.45,
      roughness: 0.4,
      clearcoat: 0.5,
    });
  },

  epoxyFloor() {
    return new THREE.MeshPhysicalMaterial({
      map: floorTileMap(),
      color: 0xffffff,
      metalness: 0.15,
      roughness: 0.35,
      clearcoat: 0.55,
      clearcoatRoughness: 0.2,
    });
  },

  wallPaint() {
    return new THREE.MeshStandardMaterial({
      map: wallMap(),
      color: 0xffffff,
      metalness: 0.02,
      roughness: 0.88,
    });
  },

  warningYellow() {
    return new THREE.MeshStandardMaterial({
      color: 0xf5c542,
      metalness: 0.2,
      roughness: 0.45,
      emissive: 0x332200,
      emissiveIntensity: 0.15,
    });
  },

  chalkAccent() {
    return new THREE.MeshBasicMaterial({
      color: 0x9ecbff,
      transparent: true,
      opacity: 0.55,
    });
  },
};

/** Plain matte sphere (no chrome rings / reflections) */
export function makeLabSphere(radius, material, { segments = 48 } = {}) {
  const mat =
    material ||
    new THREE.MeshStandardMaterial({
      color: 0x3d7aef,
      metalness: 0,
      roughness: 0.92,
      envMapIntensity: 0,
    });
  // Force no env reflections even if caller passes a shiny material
  if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0;
  if (mat.metalness !== undefined) mat.metalness = 0;
  if (mat.roughness !== undefined) mat.roughness = Math.max(mat.roughness ?? 0, 0.85);
  if (mat.clearcoat !== undefined) mat.clearcoat = 0;

  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  g.userData.radius = radius;
  return g;
}

export function makeLabBlock(sx, sy, sz, material) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // beveled edge strips
  const edgeMat = Mats.chrome();
  const edgeT = 0.02;
  // top edges along length
  for (const z of [-sz / 2, sz / 2]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.98, edgeT, edgeT), edgeMat);
    e.position.set(0, sy / 2, z);
    g.add(e);
  }
  // front face panel line
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(sx * 0.7, sy * 0.35, 0.01),
    Mats.matteBlack()
  );
  panel.position.set(0, 0, sz / 2 + 0.005);
  g.add(panel);

  // corner LEDs
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), Mats.led(0x3ee0b0));
  led.position.set(sx * 0.35, sy * 0.3, sz / 2 + 0.012);
  g.add(led);

  return g;
}
