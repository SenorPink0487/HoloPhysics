import { createStationEquipment as createMechanicsStation } from './mechanics.js';
import { createStationEquipment as createOpticsStation } from './optics.js';
import { createStationEquipment as createElectroStation } from './electro.js';
import { createStationEquipment as createThermoStation } from './thermo.js';
import { createStationEquipment as createChemStation } from './chem.js';

export const STATION_SCENE_MODULES = Object.freeze({
  mechanics: createMechanicsStation,
  optics: createOpticsStation,
  electro: createElectroStation,
  thermo: createThermoStation,
  chem: createChemStation,
});
