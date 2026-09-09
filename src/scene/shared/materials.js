import * as THREE from 'three';

/** Create the shared material palette used by the lab shell and all stations. */
export function createMaterials() {
  return {
    wall: new THREE.MeshStandardMaterial({ color: 0xf4f9ff, roughness: 0.15, roughness: 0.55 }),
  wallPanel: new THREE.MeshStandardMaterial({ color: 0xe8f2fc, metalness: 0.35, roughness: 0.4 }),
  // Keep the lab floor matte so ceiling area lights do not form large reflected
  // hotspots in the player's view.
  floor: new THREE.MeshStandardMaterial({ color: 0xeef6ff, metalness: 0, roughness: 0.92 }),
  floorAccent: new THREE.MeshStandardMaterial({ color: 0xc8e4ff, metalness: 0, roughness: 0.88 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xf8fbff, metalness: 0.2, roughness: 0.5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0.35 }),
    whiteGloss: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe8eef5, metalness: 1, roughness: 0.12 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xb8c4d4, metalness: 0.92, roughness: 0.22 }),
    darkGlass: new THREE.MeshPhysicalMaterial({
      color: 0xa8c8e8, metalness: 0.1, roughness: 0.05,
      thickness: 0.5, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      clearcoat: 0.8, clearcoatRoughness: 0.1,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xd0ecff, metalness: 0, roughness: 0.02,
      thickness: 0.35, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
      clearcoat: 1, clearcoatRoughness: 0.05,
    }),
  cyan: new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.4, roughness: 0.3, emissive: 0x0e7490, emissiveIntensity: 0.35 }),
    cyanGlow: new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.2, metalness: 0.2, roughness: 0.3 }),
  blueGlow: new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x2563eb, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.35 }),
    pinkGlow: new THREE.MeshStandardMaterial({ color: 0xf9a8d4, emissive: 0xec4899, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.35 }),
    greenGlow: new THREE.MeshStandardMaterial({ color: 0x6ee7b7, emissive: 0x10b981, emissiveIntensity: 0.8, metalness: 0.2, roughness: 0.35 }),
    orangeGlow: new THREE.MeshStandardMaterial({ color: 0xfdba74, emissive: 0xf97316, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.35 }),
    violetGlow: new THREE.MeshStandardMaterial({ color: 0xc4b5fd, emissive: 0x8b5cf6, emissiveIntensity: 0.75, metalness: 0.2, roughness: 0.35 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.45 }),
  softBlue: new THREE.MeshStandardMaterial({ color: 0xbae6fd, metalness: 0.3, roughness: 0.4 }),
    hologram: new THREE.MeshStandardMaterial({
      color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.6,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    }),
  };
}
