'use strict';

// Description du site. Les distances et contraintes sont reprises dans l'enonce.
// Chaque "node" correspond a UN microcontroleur (celui que vous dimensionnez dans la partie A).
// Un node de terrarium porte : sonde point chaud, sonde point froid, capteur de lumiere, contact de porte.
// Un node de salle porte : sonde d'ambiance, contact de porte de salle.

const rooms = [
  { id: 'DES', label: 'Salle desertique', ambient: 25, distanceToGatewayM: 12, walls: 'placo' },
  { id: 'TRO', label: 'Salle tropicale', ambient: 27, distanceToGatewayM: 18, walls: 'placo' },
  { id: 'QUA', label: 'Quarantaine (batiment annexe)', ambient: 24, distanceToGatewayM: 42, walls: 'beton 30 cm x2' },
  { id: 'SOI', label: 'Soins intensifs', ambient: 26, distanceToGatewayM: 9, walls: 'placo' },
  { id: 'EXT', label: 'Enclos exterieurs', ambient: null, distanceToGatewayM: 65, walls: 'exterieur' },
];

const enclosures = [
  { id: 'DES-01', room: 'DES', species: 'pogona', power: 'mains' },
  { id: 'DES-02', room: 'DES', species: 'pogona', power: 'mains' },
  { id: 'DES-03', room: 'DES', species: 'pogona', power: 'mains' },
  { id: 'DES-04', room: 'DES', species: 'uromastyx', power: 'mains' },
  { id: 'DES-05', room: 'DES', species: 'eublepharis', power: 'mains' },
  { id: 'DES-06', room: 'DES', species: 'eublepharis', power: 'mains' },
  { id: 'TRO-01', room: 'TRO', species: 'python', power: 'mains' },
  { id: 'TRO-02', room: 'TRO', species: 'python', power: 'mains' },
  { id: 'TRO-03', room: 'TRO', species: 'boa', power: 'mains' },
  { id: 'TRO-04', room: 'TRO', species: 'chameleon', power: 'mains' },
  { id: 'TRO-05', room: 'TRO', species: 'iguana', power: 'mains' },
  { id: 'TRO-06', room: 'TRO', species: 'phelsuma', power: 'mains' },
  { id: 'QUA-01', room: 'QUA', species: 'quarantine', power: 'mains' },
  { id: 'QUA-02', room: 'QUA', species: 'quarantine', power: 'mains' },
  { id: 'QUA-03', room: 'QUA', species: 'quarantine', power: 'mains' },
  { id: 'QUA-04', room: 'QUA', species: 'quarantine', power: 'mains' },
  { id: 'SOI-01', room: 'SOI', species: 'hospital', power: 'mains' },
  { id: 'SOI-02', room: 'SOI', species: 'hospital', power: 'mains' },
  { id: 'SOI-03', room: 'SOI', species: 'hospital', power: 'mains' },
  { id: 'EXT-01', room: 'EXT', species: 'tortoise', power: 'battery' },
  { id: 'EXT-02', room: 'EXT', species: 'tortoise', power: 'battery' },
];

// Portes "batiment" (hors terrariums)
const buildingDoors = [
  { id: 'DOOR-MAIN', label: 'Entree principale', power: 'battery' },
  { id: 'DOOR-SAS', label: 'Sas sanitaire', power: 'battery' },
  { id: 'DOOR-FEED', label: 'Local nourriture (insectes, rongeurs congeles)', power: 'battery' },
];

module.exports = { rooms, enclosures, buildingDoors };
