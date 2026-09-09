import * as THREE from 'three';

/** Shared modern-lab material factory */
export function metal(color = 0x8a94a6, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.82,
    roughness: opts.roughness ?? 0.28,
    envMapIntensity: 1.2,
    ...opts,
  });
}

export function brushedMetal(color = 0xb8c0cc) {
  return metal(color, { metalness: 0.72, roughness: 0.38 });
}

export function darkMetal(color = 0x2c3340) {
  return metal(color, { metalness: 0.88, roughness: 0.32 });
}

export function chrome(color = 0xdde3ea) {
  return metal(color, { metalness: 0.95, roughness: 0.12 });
}

export function plastic(color = 0x1a2332, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.55,
    ...opts,
  });
}

export function glass(color = 0xc8e0f5, opacity = 0.28) {
  return new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function emissivePanel(color = 0x00d4aa, intensity = 0.4) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.3,
    roughness: 0.4,
  });
}

export function rubber(color = 0x1a1a1a) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.9,
  });
}

/** Temperature → scientific false-color (blue→cyan→green→yellow→red) */
export function tempToColor(t, tMin = 200, tMax = 800, target = new THREE.Color()) {
  const u = THREE.MathUtils.clamp((t - tMin) / (tMax - tMin), 0, 1);
  // multi-stop gradient
  if (u < 0.25) {
    target.setRGB(0.15 + u * 0.4, 0.35 + u * 1.2, 0.85);
  } else if (u < 0.5) {
    const v = (u - 0.25) / 0.25;
    target.setRGB(0.25 + v * 0.2, 0.75 + v * 0.15, 0.85 - v * 0.55);
  } else if (u < 0.75) {
    const v = (u - 0.5) / 0.25;
    target.setRGB(0.45 + v * 0.5, 0.9 - v * 0.2, 0.3 - v * 0.25);
  } else {
    const v = (u - 0.75) / 0.25;
    target.setRGB(0.95, 0.7 - v * 0.45, 0.05 + v * 0.1);
  }
  return target;
}
