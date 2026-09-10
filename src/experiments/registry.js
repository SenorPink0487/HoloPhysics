/**
 * Station registry — assemble experiment catalogs from category modules.
 */
import * as electro from './electro.js';

const mechanics = {
  station: { id: 'mechanics', title: '力学实验台', accent: '#38bdf8', experiments: [] },
  createHandlers: () => ({}),
};
const optics = {
  station: { id: 'optics', title: '光学实验台', accent: '#fbbf24', experiments: [] },
  createHandlers: () => ({}),
};
const thermo = {
  station: { id: 'thermo', title: '热学实验台', accent: '#fb923c', experiments: [] },
  createHandlers: () => ({}),
};

/** Module map: id → { station, createHandlers } */
export const STATION_MODULES = {
  mechanics,
  optics,
  electro,
  thermo,
};

/** Catalog used by HUD / menus */
export const STATION_EXPERIMENTS = Object.fromEntries(
  Object.values(STATION_MODULES).map((mod) => [mod.station.id, mod.station]),
);
