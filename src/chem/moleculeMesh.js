/**
 * Build a lightweight Three.js ball-stick group from SDF text or atom list.
 * Avoids mounting full-page 3Dmol so models live inside the lab scene.
 */

/** Jmol / 3Dmol default CPK-ish colors (match original HoloChem stick look). */
const ELEMENT_COLORS = {
  H: 0xffffff,
  C: 0x909090,
  N: 0x3050f8,
  O: 0xff0d0d,
  S: 0xffff30,
  P: 0xff8000,
  F: 0x90e050,
  CL: 0x1ff01f,
  BR: 0xa62929,
  I: 0x940094,
  NA: 0xab5cf2,
  K: 0x8f40d4,
  CA: 0x3dff00,
  MG: 0x8aff00,
  FE: 0xe06633,
  CU: 0xc88033,
  ZN: 0x7d80b0,
  AG: 0xc0c0c0,
  AL: 0xbfa6a6,
  SI: 0xf0c8a0,
  B: 0xffb5b5,
  LI: 0xcc80ff,
};

/** Realistic Van der Waals Radii (in Ångströms) for space-filling and relative scaling */
const VDW_RADIUS = {
  H: 1.20,
  C: 1.70,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  S: 1.80,
  P: 1.80,
  CL: 1.75,
  BR: 1.85,
  I: 1.98,
  NA: 2.27,
  K: 2.75,
  CA: 2.31,
  MG: 1.73,
  FE: 2.05,
  CU: 1.40,
  ZN: 1.39,
  AG: 1.72,
  AL: 1.84,
  SI: 2.10,
  B: 1.92,
  LI: 1.82,
  default: 1.50,
};

/**
 * Parse a minimal SDF / MOL block into atoms + bonds.
 * @param {string} sdf
 * @returns {{ atoms: { elem: string, x: number, y: number, z: number }[], bonds: { a: number, b: number, order: number }[] }}
 */
export function parseSdf(sdf) {
  const lines = String(sdf || '').replace(/\r\n/g, '\n').split('\n');
  // Find counts line: " aaabb..." after 3 header lines, or scan for pattern
  let countsIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i += 1) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      countsIdx = i;
      break;
    }
  }
  if (countsIdx < 0) return { atoms: [], bonds: [] };
  const counts = lines[countsIdx].trim().split(/\s+/);
  const nAtoms = parseInt(counts[0], 10) || 0;
  const nBonds = parseInt(counts[1], 10) || 0;
  const atoms = [];
  for (let i = 0; i < nAtoms; i += 1) {
    const line = lines[countsIdx + 1 + i] || '';
    // Fixed-width-ish: x y z elem
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    atoms.push({
      x: parseFloat(parts[0]) || 0,
      y: parseFloat(parts[1]) || 0,
      z: parseFloat(parts[2]) || 0,
      elem: String(parts[3] || 'C').toUpperCase(),
    });
  }
  const bonds = [];
  for (let i = 0; i < nBonds; i += 1) {
    const line = lines[countsIdx + 1 + nAtoms + i] || '';
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const a = (parseInt(parts[0], 10) || 1) - 1;
    const b = (parseInt(parts[1], 10) || 1) - 1;
    const order = parseInt(parts[2], 10) || 1;
    if (a >= 0 && b >= 0 && a < atoms.length && b < atoms.length) {
      bonds.push({ a, b, order });
    }
  }
  return { atoms, bonds };
}

/**
 * @param {typeof import('three')} THREE
 * @param {{ atoms: any[], bonds: any[] } | string} source  atoms/bonds or SDF string
 * @param {{ scale?: number }} [opts]
 */
export function createMoleculeMesh(THREE, source, opts = {}) {
  const parsed = typeof source === 'string' ? parseSdf(source) : source;
  const { atoms, bonds } = parsed || { atoms: [], bonds: [] };
  const root = new THREE.Group();
  root.name = 'chem-molecule';

  if (!atoms.length) {
    // Placeholder orb so empty still shows something small
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 14, 10),
      new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x059669,
        emissiveIntensity: 0.4,
        metalness: 0.2,
        roughness: 0.35,
      }),
    );
    root.add(orb);
    return root;
  }

  // Center atoms
  let cx = 0; let cy = 0; let cz = 0;
  atoms.forEach((a) => { cx += a.x; cy += a.y; cz += a.z; });
  cx /= atoms.length; cy /= atoms.length; cz /= atoms.length;

  // Calculate max extent from center to auto-fit any molecule (SDF/pm/nm/Å)
  let maxR = 0;
  atoms.forEach((a) => {
    const dist = Math.hypot(a.x - cx, a.y - cy, a.z - cz);
    if (dist > maxR) maxR = dist;
  });

  const style = opts.style || 'ball-and-stick';
  const isSpaceFilling = style === 'space-filling';

  // Target radius for the entire molecule on the pedestal (~0.28m)
  const targetRadius = 0.28;
  // Fit scale clamped between 0.032 and 0.088 to avoid giant water balloons or crowded atom blobs
  const fitScale = Math.min(0.088, Math.max(0.032, targetRadius / (maxR + 0.8)));

  // Ball-and-stick: atoms are 28% of VDW radius * fitScale, bonds are 0.16 Angstroms * fitScale
  // Space-filling: atoms are 90% of VDW radius * fitScale, no bonds
  const atomRadiusMultiplier = isSpaceFilling ? 0.90 : 0.28;
  const bondRadius = isSpaceFilling ? 0.001 : 0.16 * fitScale;

  const atomMeshes = [];
  const atomColors = [];
  atoms.forEach((a) => {
    const elem = String(a.elem || 'C').toUpperCase();
    const color = ELEMENT_COLORS[elem] ?? 0x909090;
    atomColors.push(color);
    
    // Scale by actual VDW radius * style multiplier * fitScale
    const baseR = (VDW_RADIUS[elem] ?? VDW_RADIUS.default);
    const r = baseR * atomRadiusMultiplier * fitScale;
    
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.08,
        metalness: 0.1,
        roughness: isSpaceFilling ? 0.25 : 0.15,
      }),
    );
    mesh.position.set(
      (a.x - cx) * fitScale,
      (a.y - cy) * fitScale,
      (a.z - cz) * fitScale,
    );
    mesh.castShadow = false;
    root.add(mesh);
    atomMeshes.push(mesh);
  });

  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const _mid = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _half = new THREE.Vector3();

  // Half-bonds colored per atom (classic ball-and-stick / 3Dmol stick look)
  if (!isSpaceFilling) {
    bonds.forEach((bond) => {
      const A = atomMeshes[bond.a];
      const B = atomMeshes[bond.b];
      if (!A || !B) return;
      _dir.subVectors(B.position, A.position);
      const len = _dir.length();
      if (len < 1e-5) return;
      _dir.normalize();
      _quat.setFromUnitVectors(_up, _dir);
      const halfLen = len * 0.5;
      const order = Math.max(1, Math.min(3, Number(bond.order) || 1));
      const offsets = order === 1
        ? [0]
        : order === 2
          ? [-bondRadius * 1.6, bondRadius * 1.6]
          : [-bondRadius * 2.2, 0, bondRadius * 2.2];

      offsets.forEach((off) => {
        // Perpendicular offset for multi-bond
        const side = new THREE.Vector3(0, 0, 1).cross(_dir);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(_dir);
        side.normalize().multiplyScalar(off);

        const matA = new THREE.MeshStandardMaterial({
          color: atomColors[bond.a],
          metalness: 0.05,
          roughness: 0.2,
        });
        const matB = new THREE.MeshStandardMaterial({
          color: atomColors[bond.b],
          metalness: 0.05,
          roughness: 0.2,
        });
        const cylA = new THREE.Mesh(
          new THREE.CylinderGeometry(bondRadius, bondRadius, halfLen, 8),
          matA,
        );
        const cylB = new THREE.Mesh(
          new THREE.CylinderGeometry(bondRadius, bondRadius, halfLen, 8),
          matB,
        );
        cylA.quaternion.copy(_quat);
        cylB.quaternion.copy(_quat);
        _half.copy(A.position).addScaledVector(_dir, halfLen * 0.5).add(side);
        cylA.position.copy(_half);
        _half.copy(B.position).addScaledVector(_dir, -halfLen * 0.5).add(side);
        cylB.position.copy(_half);
        root.add(cylA);
        root.add(cylB);
      });
    });
  }

  // Attach a helper function to toggle the style
  root.userData.currentStyle = style;
  root.userData.toggleStyle = () => {
    const nextStyle = root.userData.currentStyle === 'ball-and-stick' ? 'space-filling' : 'ball-and-stick';
    const newRoot = createMoleculeMesh(THREE, parsed, { ...opts, style: nextStyle });
    newRoot.position.copy(root.position);
    newRoot.rotation.copy(root.rotation);
    newRoot.scale.copy(root.scale);
    newRoot.userData = { ...root.userData, currentStyle: nextStyle };
    if (opts.onToggle) opts.onToggle(newRoot, root);
    if (root.parent) {
      root.parent.add(newRoot);
      root.parent.remove(root);
    }
    // Cleanup old meshes
    root.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose?.());
      }
    });
    return newRoot;
  };

  return root;
}

export function parseFormulaToCounts(formula) {
  const f = String(formula || '').trim();
  const counts = {};
  const regex = /([A-Z][a-z]*)(\d*)/g;
  let match;
  while ((match = regex.exec(f)) !== null) {
    if (!match[1]) continue;
    const elem = match[1].toUpperCase();
    const num = parseInt(match[2], 10) || 1;
    counts[elem] = (counts[elem] || 0) + num;
  }
  return counts;
}

export function buildProceduralStructure(formula) {
  const raw = String(formula || '').trim();
  const f = raw.toUpperCase();
  const counts = parseFormulaToCounts(raw);

  // 1. Water
  if (f === 'H2O' || f === 'WATER') {
    return {
      atoms: [
        { elem: 'O', x: 0, y: 0, z: 0 },
        { elem: 'H', x: 0.96, y: 0, z: 0 },
        { elem: 'H', x: -0.24, y: 0.93, z: 0 },
      ],
      bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }],
    };
  }

  // 2. Carbon Dioxide
  if (f === 'CO2') {
    return {
      atoms: [
        { elem: 'C', x: 0, y: 0, z: 0 },
        { elem: 'O', x: -1.16, y: 0, z: 0 },
        { elem: 'O', x: 1.16, y: 0, z: 0 },
      ],
      bonds: [{ a: 0, b: 1, order: 2 }, { a: 0, b: 2, order: 2 }],
    };
  }

  // 3. Sodium Chloride
  if (f === 'NACL') {
    return {
      atoms: [
        { elem: 'NA', x: 0, y: 0, z: 0 },
        { elem: 'CL', x: 2.3, y: 0, z: 0 },
      ],
      bonds: [{ a: 0, b: 1, order: 1 }],
    };
  }

  // 4. Organics / Hydrocarbons (CxHyOz...)
  if (counts.C && counts.C >= 1) {
    const nC = counts.C;
    const nH = counts.H || 0;
    const nO = counts.O || 0;
    const atoms = [];
    const bonds = [];

    // Carbon backbone chain/cluster
    for (let i = 0; i < nC; i += 1) {
      const x = i * 1.25 - (nC - 1) * 0.625;
      const y = (i % 2 === 0 ? 0.35 : -0.35);
      const z = (i % 3 === 0 ? 0.3 : (i % 3 === 1 ? -0.3 : 0));
      atoms.push({ elem: 'C', x, y, z });
      if (i > 0) {
        bonds.push({ a: i - 1, b: i, order: 1 });
      }
    }

    // Oxygen attachments
    for (let i = 0; i < nO; i += 1) {
      const parentC = i % nC;
      const p = atoms[parentC];
      const ox = p.x + (i % 2 === 0 ? 0.75 : -0.75);
      const oy = p.y + 0.85;
      const oz = p.z + (i % 2 === 0 ? 0.45 : -0.45);
      const oIdx = atoms.length;
      atoms.push({ elem: 'O', x: ox, y: oy, z: oz });
      bonds.push({ a: parentC, b: oIdx, order: 1 });
    }

    // Hydrogens distributed to Oxygen & Carbon
    let hCount = 0;
    for (let i = nC; i < nC + nO; i += 1) {
      if (hCount >= nH) break;
      const p = atoms[i];
      const hx = p.x + 0.65;
      const hy = p.y + 0.55;
      const hz = p.z;
      const hIdx = atoms.length;
      atoms.push({ elem: 'H', x: hx, y: hy, z: hz });
      bonds.push({ a: i, b: hIdx, order: 1 });
      hCount += 1;
    }

    const remainingH = nH - hCount;
    if (remainingH > 0) {
      const hPerC = Math.ceil(remainingH / nC);
      let hLeft = remainingH;
      for (let i = 0; i < nC; i += 1) {
        if (hLeft <= 0) break;
        const p = atoms[i];
        const countForThisC = Math.min(hLeft, hPerC);
        for (let j = 0; j < countForThisC; j += 1) {
          const angle = (j * (Math.PI * 2 / 3)) + (i * 0.5);
          const hx = p.x + Math.cos(angle) * 0.90;
          const hy = p.y + (j % 2 === 0 ? -0.80 : 0.80);
          const hz = p.z + Math.sin(angle) * 0.90;
          const hIdx = atoms.length;
          atoms.push({ elem: 'H', x: hx, y: hy, z: hz });
          bonds.push({ a: i, b: hIdx, order: 1 });
          hLeft -= 1;
        }
      }
    }

    return { atoms, bonds };
  }

  // 5. Oxoacids & Heavy Central Atom Compounds (H3PO4, H2SO4, HNO3, KMnO4, etc.)
  const centralElems = ['P', 'S', 'N', 'MN', 'CR', 'FE', 'CU', 'BA', 'SI'];
  const centralKey = Object.keys(counts).find((k) => centralElems.includes(k));
  if (centralKey) {
    const atoms = [{ elem: centralKey, x: 0, y: 0, z: 0 }];
    const bonds = [];
    const nO = counts.O || 0;
    const nH = counts.H || 0;
    const oIndices = [];

    for (let i = 0; i < nO; i += 1) {
      const phi = (i / Math.max(1, nO)) * Math.PI * 2;
      const theta = (i % 2 === 0 ? 0.6 : -0.6);
      const ox = Math.cos(phi) * 1.3;
      const oy = Math.sin(phi) * 1.3;
      const oz = Math.sin(theta) * 0.7;
      const oIdx = atoms.length;
      atoms.push({ elem: 'O', x: ox, y: oy, z: oz });
      bonds.push({ a: 0, b: oIdx, order: i === 0 ? 2 : 1 });
      oIndices.push(oIdx);
    }

    for (let i = 0; i < nH; i += 1) {
      const targetO = oIndices[i % oIndices.length] || 0;
      const p = atoms[targetO];
      const hx = p.x * 1.5;
      const hy = p.y * 1.5 + 0.35;
      const hz = p.z + (i % 2 === 0 ? 0.45 : -0.45);
      const hIdx = atoms.length;
      atoms.push({ elem: 'H', x: hx, y: hy, z: hz });
      bonds.push({ a: targetO, b: hIdx, order: 1 });
    }

    return { atoms, bonds };
  }

  // 6. Generic radial fallback for any arbitrary formula
  const elems = Object.keys(counts);
  const atoms = [];
  const bonds = [];
  elems.forEach((elem) => {
    const n = counts[elem];
    for (let i = 0; i < n; i += 1) {
      const idx = atoms.length;
      if (idx === 0) {
        atoms.push({ elem, x: 0, y: 0, z: 0 });
      } else {
        const phi = (idx / 6) * Math.PI * 2;
        const radius = 1.1 + Math.floor(idx / 6) * 0.75;
        const x = Math.cos(phi) * radius;
        const y = Math.sin(phi) * radius;
        const z = (idx % 2 === 0 ? 0.35 : -0.35);
        atoms.push({ elem, x, y, z });
        bonds.push({ a: 0, b: idx, order: 1 });
      }
    }
  });

  return { atoms, bonds };
}

/** Dynamic procedural 3D ball-and-stick model generator for any chemical formula. */
export function createFallbackMolecule(THREE, formula = 'H2O', opts = {}) {
  const parsed = buildProceduralStructure(formula);
  return createMoleculeMesh(THREE, parsed, opts);
}
