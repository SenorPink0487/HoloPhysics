/**
 * Station registry — assemble experiment catalogs from category modules.
 */
import * as mechanics from './mechanics.js';
import * as optics from './optics.js';
import * as electro from './electro.js';
import * as thermo from './thermo.js';
import * as chem from './chem.js';

/** Module map: id → { station, createHandlers } */
export const STATION_MODULES = {
  mechanics,
  optics,
  electro,
  thermo,
  chem,
};

/** Catalog used by HUD / menus */
export const STATION_EXPERIMENTS = Object.fromEntries(
  Object.values(STATION_MODULES).map((mod) => [mod.station.id, mod.station]),
);
