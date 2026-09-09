/** Shared props that are not owned by a single experiment category. */
export function createSharedProps(ctx) {
  const { THREE, materials: mat, primitives } = ctx;
  const { rbox, cyl, torus } = primitives;
  const animators = [];

  function makeHoloTerminal() {
    const g = new THREE.Group();
    const base = rbox(0.5, 0.04, 0.35, mat.carbon, 0.02);
    base.position.y = 0.02;
    g.add(base);
    // floating holo screens
    const screens = [];
    for (let i = 0; i < 3; i++) {
      const s = rbox(0.28 - i * 0.04, 0.2 - i * 0.03, 0.008, mat.hologram, 0.005);
      s.position.set(0, 0.25 + i * 0.08, -0.05 + i * 0.04);
      s.rotation.x = -0.15 - i * 0.05;
      g.add(s);
      screens.push(s);
    }
    // projector beam
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.25, 16, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.5,
        transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    cone.position.set(0, 0.15, 0);
    cone.rotation.x = Math.PI;
    g.add(cone);

    animators.push((t) => {
      screens.forEach((s, i) => {
        s.position.y = 0.25 + i * 0.08 + Math.sin(t * 2 + i) * 0.015;
        s.material.opacity = 0.4 + 0.2 * Math.sin(t * 3 + i);
      });
    });
    return g;
  }

  // —— Beakers with tech stands ——
  function makeBeaker(h = 0.15, r = 0.045, liquid = 0x38bdf8) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.95, h, 28, 1, true),
      mat.glass
    );
    wall.position.y = h / 2;
    g.add(wall);
    const rim = torus(r, 0.006, mat.chrome, 8, 24);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = h;
    g.add(rim);
    const bottom = cyl(r * 0.95, r * 0.95, 0.008, mat.glass, 24);
    bottom.position.y = 0.004;
    g.add(bottom);
    if (liquid != null) {
      const liq = cyl(r * 0.88, r * 0.88, h * 0.5, new THREE.MeshPhysicalMaterial({
        color: liquid, metalness: 0, roughness: 0.15, transparent: true, opacity: 0.7,
        emissive: liquid, emissiveIntensity: 0.15,
      }), 20);
      liq.position.y = h * 0.28;
      g.add(liq);
    }
    return g;
  }

  // —— Thermodynamics station ——

  return { makeHoloTerminal, makeBeaker, animators };
}
