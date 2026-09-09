/**
 * DOM molecule overlay disabled — molecules render on the lab table pedestal
 * via Three.js ball-stick (see moleculeMesh.js / cupRig.showMoleculeFromSdf).
 * Kept as a no-op so existing imports do not break.
 */

export function getMoleculePanel() {
  return {
    async showSdf() {
      /* no DOM white panel */
    },
    hide() {},
    clear() {},
  };
}
