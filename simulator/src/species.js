'use strict';

// Profils d'elevage indicatifs (valeurs de travail pour l'exercice, pas une fiche veterinaire).
// hotDay   : consigne point chaud le jour (degC)
// coldDay  : plage attendue cote froid le jour [min, max]
// night    : plage attendue la nuit (tout le terrarium) [min, max]
// photo    : photoperiode [heure allumage, heure extinction]
// luxDay   : eclairement typique sous la rampe en journee (lux)
module.exports = {
  pogona: {
    label: 'Agame barbu (Pogona vitticeps)',
    hotDay: 40, coldDay: [24, 29], night: [18, 23], photo: [7, 20], luxDay: 32000,
  },
  uromastyx: {
    label: 'Fouette-queue (Uromastyx geyri)',
    hotDay: 45, coldDay: [26, 31], night: [20, 24], photo: [7, 20], luxDay: 45000,
  },
  eublepharis: {
    label: 'Gecko leopard (Eublepharis macularius)',
    hotDay: 32, coldDay: [23, 27], night: [19, 23], photo: [8, 20], luxDay: 3500,
  },
  python: {
    label: 'Python royal (Python regius)',
    hotDay: 32, coldDay: [25, 28], night: [23, 26], photo: [7, 19], luxDay: 2500,
  },
  boa: {
    label: 'Boa constricteur (Boa imperator)',
    hotDay: 33, coldDay: [25, 28], night: [22, 25], photo: [7, 19], luxDay: 3000,
  },
  chameleon: {
    label: 'Cameleon casque (Chamaeleo calyptratus)',
    hotDay: 33, coldDay: [22, 27], night: [16, 21], photo: [7, 19], luxDay: 18000,
  },
  iguana: {
    label: 'Iguane vert (Iguana iguana)',
    hotDay: 37, coldDay: [26, 30], night: [22, 26], photo: [7, 19], luxDay: 22000,
  },
  phelsuma: {
    label: 'Gecko diurne (Phelsuma grandis)',
    hotDay: 34, coldDay: [24, 28], night: [19, 23], photo: [7, 19], luxDay: 15000,
  },
  quarantine: {
    label: 'Arrivant non identifie (profil conservateur)',
    hotDay: 32, coldDay: [24, 28], night: [21, 25], photo: [8, 19], luxDay: 6000,
  },
  hospital: {
    label: 'Bac hospitalier (temperature stable)',
    hotDay: 29, coldDay: [27, 29.5], night: [26, 29], photo: [8, 18], luxDay: 1200,
  },
  tortoise: {
    label: "Tortue d'Hermann (Testudo hermanni), enclos exterieur",
    hotDay: null, coldDay: null, night: null, photo: null, luxDay: null,
  },
};
