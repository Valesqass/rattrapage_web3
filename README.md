# Supervision temps réel — centre de réhabilitation pour reptiles

Chaîne de bout en bout :

```
Simulateur (28 nodes) <-- MQTT TCP 1883 --> Mosquitto <-- MQTT over WebSocket 9001 --> Front web (navigateur)
```

## Démarrage

Prérequis : Docker Desktop (ou Docker Engine + plugin compose).

```bash
docker compose up --build
```

Puis ouvrir **http://localhost:8080** et se connecter :

| Champ | Valeur de démonstration |
|---|---|
| Broker | `ws://localhost:9001` (prérempli) |
| Utilisateur | `front` |
| Mot de passe | `demo-front` |

Aucune autre commande n'est nécessaire. Les secrets ont des valeurs de démonstration par défaut.
Pour un déploiement réel, copier `.env.example` en `.env` et renseigner chaque variable.

### Variables d'environnement

| Variable | Service | Rôle | Défaut (démo) |
|---|---|---|---|
| `MQTT_ADMIN_PASSWORD` | broker | compte `admin` (accès complet) | `demo-admin-a-changer` |
| `MQTT_FRONT_PASSWORD` | broker | compte `front` (opérateurs) | `demo-front` |
| `MQTT_GW_PASSWORD` | broker, simulateur | compte `gw-sim` (passerelle) | `demo-gw-a-changer` |
| `MQTT_NODE_SECRET` | broker, simulateur | secret maître : mot de passe node = `sha256(secret:id)[0:24]` | `demo-node-secret-a-changer` |
| `SIM_SCENARIO` | simulateur | `normal`, `incidents`, `chaos` | `incidents` |
| `SIM_SPEED` | simulateur | accélération du temps (60 : 1 s = 1 min) | `60` |
| `SIM_SEED` | simulateur | graine aléatoire | `42` |
| `MQTT_URL`, `MQTT_TOPIC_ROOT`, `MQTT_KEEPALIVE_S`, `MQTT_RECONNECT_MS`, `MQTT_BUFFER_MAX`, `MQTT_GW_STATUS_PERIOD_MS` | simulateur | réglages de l'adaptateur MQTT | voir `simulator/src/outputs/mqtt/config.js` |

### Commandes utiles

```bash
docker compose logs -f simulator                  # sortie console du simulateur (toujours active)
docker attach $(docker compose ps -q simulator)   # taper une commande JSON sur stdin, ou "snapshot"
docker compose stop broker; sleep 60; docker compose start broker   # test de coupure : rien n'est perdu
docker compose down -v                            # arrêt + suppression de la persistance du broker
```

Observer le trafic avec le compte administrateur :

```bash
docker compose exec broker mosquitto_sub -u admin -P demo-admin-a-changer -t 'rc/v1/#' -v
```

## Organisation du dépôt

```
broker/              configuration Mosquitto (écoutes, persistance, ACL) + génération des comptes
simulator/           simulateur fourni (simulator.js et scenarios.js NON modifiés)
  src/outputs/mqtt/  adaptateur MQTT (partie C)
  test/              tests unitaires de l'adaptateur
front/               front web statique (partie E), servi par nginx
  public/js/         engine.js (alertes), rules.js (seuils), connection.js (MQTT), views/
  test/              tests du moteur d'alertes + rejeu du scénario incidents
docs/                protocole (partie B), conception matérielle (partie A), validation (partie F)
tools/validation.mjs rejoue le scénario incidents et produit le tableau de détection
```

## Tests

```bash
cd simulator && npm ci && npm test     # adaptateur MQTT (topics, commandes, tampon, config)
cd front && npm ci && npm test         # moteur d'alertes + rejeu complet du scénario incidents
node tools/validation.mjs 20           # tableau des alertes sur 20 h simulées (partie F)
docker compose exec -T broker sh < tools/acl-check.sh   # authentification + ACL (stack lancée)
```

## Développement du front sans Docker

```bash
cd front && npm ci && npm run vendor   # copie mqtt.js, uPlot et les polices dans public/vendor
npx serve public                       # ou tout serveur statique
```

## Documentation

- [Conception matérielle — partie A](docs/conception-materielle.md) · node Wokwi : https://wokwi.com/projects/477218768956652545 (sources : `hardware/wokwi-node-interieur/`)
- [Protocole MQTT — partie B](docs/protocole.md)
- [Validation du scénario incidents — partie F](docs/validation.md)
