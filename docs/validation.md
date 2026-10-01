# Partie F — Validation sur le scénario `incidents`

Conditions : seed 42, départ 07:45 (heure du site), vitesse 60. Les heures sont des **heures simulées**,
lues sur l'horloge passerelle (`gwTs`). Le tableau se régénère avec `node tools/validation.mjs 20`,
qui rejoue le simulateur à travers le **même moteur d'alertes** que le front.

Délai de détection = heure de levée de l'alerte − heure d'injection de l'incident.

## Incidents injectés et alertes levées

| # | Incident injecté (heure) | Alerte levée | Détection | Délai | Capture |
|---|---|---|---|---|---|
| 1 | Pile de N-EXT-02 à 14 % (07:45) | Pile faible (avertissement), node EXT-02 | 07:45 | < 1 min (heartbeat retenu) | `captures/01-pile.png` |
| 2 | Dérive d'horloge N-TRO-06, 4 s/min (07:45) | Dérive d'horloge (> 60 s) | 08:00 | 15 min (seuil de 60 s atteint) | `captures/02-derive.png` |
| 3 | Porte DES-02 mal refermée (08:10) | Porte ouverte trop longtemps, puis critique ; conséquence : point chaud trop froid à 08:15 | 08:21 | 11 min (tolérance 10 min) | `captures/03-porte-DES-02.png` |
| 4 | Sonde point chaud TRO-03 débranchée (08:25 → 08:37) | Valeur aberrante, sonde déconnectée (-127 °C), critique | 08:25 | < 1 min | `captures/04-sonde-TRO-03.png` |
| 5 | Lampe DES-04 en panne (08:45) | Éclairage insuffisant (5,7 klx / 45 klx), puis point chaud trop froid critique | 08:45 / 08:47 | < 1 min / 2 min | `captures/05-lampe-DES-04.png` |
| 6 | Thermostat TRO-05 bloqué (09:15) | Point chaud trop chaud, critique à 09:31 ; « lampe off » renvoie `applied_but_relay_feedback_on` → **Relais de lampe bloqué** | 09:19 | 4 min (avertissement), 16 min (critique) | `captures/06-relais-TRO-05.png` |
| 7 | N-QUA-03 hors ligne 15 min (09:30) | Node hors ligne (Last Will), puis node muet ; au retour, horloge non synchronisée | 09:30 | < 1 min | `captures/07-QUA-03.png` |
| 8 | Reset intermittent de la sonde froide SOI-02 (09:45 → 10:15) | Valeur aberrante, reset de sonde (85 °C). Les 85 °C sont **exclus** des seuils et des courbes | 09:45 | < 1 min | `captures/08-sonde-SOI-02.png` |
| 9 | Coupure secteur de la quarantaine (10:25 → 10:47) | Coupure probable · Quarantaine (5 nodes secteur hors ligne en même temps) | 10:25 | < 1 min | `captures/09-coupure-QUA.png` |
| 10 | Pile EXT-02 en décharge rapide (11:05) | Node hors ligne (Last Will) à 11:15, node muet à 11:31 | 11:15 | 10 min après le début de la décharge | `captures/10-EXT-02.png` |
| 11 | Intrusion nocturne, local nourriture (02:37) | Ouverture hors horaires, critique | 02:37 | < 1 min | `captures/11-intrusion.png` |

La porte apparaît sur le front en moins de 2 s réelles : le message `door` est publié en QoS 1 dès l'événement
et le rendu est limité à 300 ms.

## Ce que le système n'a pas détecté, ou mal, et pourquoi

1. **Les mouvements de porte pendant une coupure sont perdus.** Le simulateur ne transmet rien quand un node est
   éteint (comme un vrai node sans secteur). À la coupure de la quarantaine, QUA-04 était ouverte (visite de
   10:21) ; sa fermeture n'a jamais été reçue. Sans correctif, le front affichait « ouverte depuis 1043 min ».
   Correctif apporté : le node republie l'état de son contact au démarrage. L'**heure réelle** de fermeture
   reste inconnue. Il faudrait une pile tampon (supercondensateur) ou une mémoire des événements dans le node.
2. **La cause de l'incident n'est pas identifiée, seulement ses effets.** Pour DES-04, l'alerte dit « éclairage
   insuffisant + point chaud trop froid » ; le système ne sait pas si c'est la lampe, son alimentation ou le
   relais. Pour TRO-05, le relais collé n'est **confirmé** que si un opérateur envoie « lampe off ». Il faudrait
   un capteur de courant sur la lampe (ACS712 ou une simple mesure de tension) pour le diagnostic direct.
3. **Décharge rapide de la pile d'EXT-02 non anticipée.** La pile n'est remontée que toutes les 30 min (heartbeat
   batterie). Entre 14 % et 0 %, la décharge accélérée prend moins de 30 min : aucune alerte « critique » n'a
   précédé la mort du node. Seuls le Last Will et le silence l'ont détectée. Il faudrait remonter la tension à
   chaque mesure (5 min) et calculer une **pente** de décharge.
4. **Dérive d'horloge détectée seulement au-delà de 60 s.** TRO-06 dérivait dès 07:45 ; l'alerte arrive à 08:00.
   C'est voulu : `gwTs` fait foi, donc une dérive plus faible n'a aucun effet sur les alertes.
5. **Détection du node muet « idéalisée ».** Le Last Will part immédiatement, car la coupure de connexion est
   franche dans le simulateur. Sur un vrai node qui perd l'alimentation, le broker attend 1,5 × keepalive
   (45 s). Sur un node LoRa, il n'y a pas de Last Will : la détection se fait par silence, en 15 min pour EXT.
6. **Alertes réelles mais non injectées.** La nuit, TRO-04 (caméléon) et TRO-06 (gecko diurne) sortent de leur
   plage nocturne : la salle tropicale reste à 27 °C alors que ces espèces attendent 16–23 °C. C'est un
   **vrai constat d'installation** (déplacer ces animaux ou climatiser la salle), pas un faux positif du système.
   Au retour du secteur en quarantaine, les points chauds sont « trop froids » pendant 5 min : conséquence
   réelle de la coupure.

## Réglages qui ont évité de fausses alertes

| Problème observé lors du rejeu | Réglage |
|---|---|
| Une alerte ouverte et fermée à chaque mesure près d'un seuil (TRO-04, geckos DES) | Hystérésis de 0,5 °C et anti-rebond de 2 mesures |
| Une alerte par valeur 85 °C (SOI-02) | Le défaut capteur n'est levé qu'après 10 mesures valides |
| Tous les terrariums en alerte la nuit (salles à 25–27 °C, tapis chauffant) | Marge nocturne côté chaud plus large que côté froid ; le froid reste le danger principal |
| Alertes au réveil des lampes (07:00–08:00) | Phase de transition d'1 h après l'allumage et l'extinction : seule une surchauffe franche alerte |
