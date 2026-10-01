# Partie B — Protocole MQTT

Ce document est la spécification suivie par l'adaptateur MQTT du simulateur (`simulator/src/outputs/mqtt/`)
et par le front (`front/`). Toute évolution du code doit d'abord passer par ce document.

## 1. Arborescence des topics

```
rc/v1/{zone}/{nodeId}/status              état de connexion du node (Last Will)
rc/v1/{zone}/{nodeId}/heartbeat           santé : uptime, RSSI, firmware, pile
rc/v1/{zone}/{nodeId}/reading/{sensor}    mesure (temp_hot, temp_cold, light, temp_ambient)
rc/v1/{zone}/{nodeId}/door                état de la porte (open / closed)
rc/v1/{zone}/{nodeId}/boot                démarrage du node
rc/v1/{zone}/{nodeId}/cmd                 commande front -> node
rc/v1/{zone}/{nodeId}/ack                 acquittement node -> front
rc/v1/gw/{gwId}/status                    passerelle : en ligne + horloge de référence (Last Will)
rc/v1/alerts/{alertId}/ack                acquittement d'une alerte par un opérateur
```

- `zone` ∈ `DES`, `TRO`, `QUA`, `SOI`, `EXT`, `BLD` (portes de bâtiment).
- `nodeId` reprend l'identifiant du simulateur (`N-DES-01`, `N-ROOM-TRO`, `N-DOOR-FEED`…).

**Justification**

| Choix | Pourquoi |
|---|---|
| Préfixe `rc` (reptile center) | Isole le projet si le broker est partagé avec d'autres usages. |
| `v1` dans le topic | Version **majeure** : une refonte de l'arborescence publie sur `rc/v2/…` et les deux versions cohabitent pendant la migration des nodes. |
| `zone` avant `nodeId` | Abonnement par salle (`rc/v1/QUA/#`) pour un écran de salle ou un diagnostic. Permet aussi de corréler une panne de zone (coupure secteur de la quarantaine). |
| Un topic par capteur | Le message retenu de chaque capteur est indépendant : le front obtient la dernière valeur de **chaque** sonde dès l'abonnement. Une ACL ou un abonnement peut aussi viser un seul type de mesure (`rc/v1/+/+/reading/light`). |
| `cmd` / `ack` sous le node | L'ACL d'un node se réduit à « son » sous-arbre (motif `%u`, voir §7). |
| Alertes hors des nodes | Les alertes sont calculées par le front ; seul leur acquittement est partagé entre opérateurs. |

## 2. Format des messages (version 1)

JSON UTF-8. Champs communs à tout message émis par un node :

| Champ | Type | Rôle |
|---|---|---|
| `v` | entier | Version du **schéma** du payload (évolution compatible : un champ ajouté ne change pas `v`, un champ retiré ou renommé l'incrémente). |
| `node` | chaîne | Identifiant de l'émetteur (redondant avec le topic, utile pour les journaux). |
| `type` | chaîne | `reading`, `door`, `heartbeat`, `boot`, `ack`. |
| `ts` | entier (ms) | Horodatage **du device** (informatif, voir §5). |
| `gwTs` | entier (ms) | Horodatage de **réception par la passerelle** (fait foi, voir §5). |
| `seq` | entier | Compteur monotone de l'émetteur : détection de pertes et de doublons (QoS 1). |

Exemples :

```json
{"v":1,"node":"N-DES-04","type":"reading","ts":1790840700000,"gwTs":1790840700000,"seq":812,"sensor":"temp_hot","value":38.25,"unit":"C"}
{"v":1,"node":"N-DES-02","type":"door","ts":1790840700000,"gwTs":1790840700000,"seq":813,"state":"open"}
{"v":1,"node":"N-EXT-02","type":"heartbeat","ts":1790840700000,"gwTs":1790840700000,"seq":814,"uptimeS":86400,"rssi":-109,"fw":"1.4.2","battery":14}
{"v":1,"online":false,"reason":"lwt"}
```

Un message dont `v` est inconnu est ignoré et journalisé, jamais interprété au hasard.

## 3. QoS et retain par type de message

| Message | QoS | Retain | Justification |
|---|---|---|---|
| `status` | 1 | oui | Le front connaît immédiatement l'état de tous les nodes à l'abonnement. Retenu aussi pour le Last Will (`online:false`). |
| `heartbeat` | 1 | oui | Contient la pile : un front qui arrive doit voir tout de suite une pile faible sans attendre 30 min (période batterie). |
| `reading/*` | 1 | oui | Les alertes de seuil sont calculées **dans le front** (pas de backend). La file de session persistante du broker est donc le seul tampon côté consommateur. Or le broker ne met en file que les messages QoS ≥ 1. En QoS 0, une coupure côté front ferait perdre la mesure qui déclenche l'alerte « lampe bloquée ». Le retain donne la valeur courante à l'ouverture. Volume : 21 nodes × 3 mesures / 30 s, négligeable. |
| `door` | 1 | oui | Événement critique (porte mal refermée, intrusion). Il doit arriver au moins une fois. Les doublons du QoS 1 sont absorbés par `seq`. Retain = état courant de la porte. QoS 2 écarté : l'état est idempotent (un doublon `open` ne change rien), le coût de la double poignée de main ne se justifie pas. |
| `boot` | 1 | non | Événement ponctuel. Retenu, il ferait croire à un redémarrage à chaque ouverture du front. |
| `cmd` | 1 | **non** | Une commande retenue serait rejouée à chaque reconnexion du node (boucle de `reboot`). Le QoS 1 et la session persistante du node mettent la commande en file s'il est brièvement déconnecté. L'expiration `exp` évite d'appliquer une commande périmée (§6). |
| `ack` | 1 | non | Réponse à une commande précise, sans valeur pour un front qui arrive après coup. |
| `gw/+/status` | 1 | oui | Horloge de référence et présence de la passerelle (Last Will). |
| `alerts/+/ack` | 1 | oui | Un acquittement fait par un opérateur est visible des autres écrans et survit au rechargement de la page. |

Côté abonnés, le front et les nodes se connectent en **session persistante** (`clean: false`, clientId stable)
et s'abonnent en QoS 1. Le broker (persistance disque activée) stocke les messages pendant une coupure
(`max_queued_messages 50000`, `persistent_client_expiration 2d`).

## 4. Last Will et convention de clientId

| Rôle | clientId | Utilisateur MQTT |
|---|---|---|
| Node | `rc-node-{nodeId}` (ex. `rc-node-N-DES-01`) | `{nodeId}` |
| Passerelle / adaptateur | `rc-gw-{gwId}` | `gw-{gwId}` |
| Front | `rc-front-{8 car. aléatoires}`, tiré une fois puis conservé dans le navigateur | `front` |
| Administrateur | `rc-admin-{nom}` | `admin` |

- Le clientId est **stable** pour un même appareil : c'est la clé de la session persistante. Deux connexions avec le même clientId s'éjectent mutuellement, ce qui révèle aussi un clone ou un double déploiement.
- Préfixe par rôle : lisible dans les journaux du broker (`connection_messages true`).
- **Last Will** de chaque node : `rc/v1/{zone}/{nodeId}/status` = `{"v":1,"online":false,"reason":"lwt"}`, QoS 1, retenu. À la connexion, le node publie `{"v":1,"online":true}` retenu, ce qui écrase le testament précédent. Keepalive 30 s : un node qui disparaît sans se déconnecter est déclaré hors ligne par le broker au plus tard après 45 s (1,5 × keepalive).
- Last Will de la passerelle : même principe sur `rc/v1/gw/{gwId}/status`.
- Le Last Will ne couvre que la **connexion MQTT**. Un node connecté mais dont une sonde ne répond plus reste « en ligne ». Le front détecte donc aussi le **silence** (capteur ou node muet) à partir de la période de mesure attendue.

## 5. Horodatage : qui fait foi ?

**C'est l'horloge de la passerelle (`gwTs`) qui fait foi.** L'horodatage du device (`ts`) est conservé mais seulement à titre informatif.

Raisons, observées dans le simulateur :
1. Après un redémarrage, un node n'a pas de synchro NTP pendant environ 2 min. Son `ts` repart de 0, soit des dates en **1970**.
2. Une horloge peut **dériver** : N-TRO-06 prend 4 s par minute simulée, soit 1 min en 15 min.
3. Les nodes basse consommation (LoRa) n'ont pas d'horloge fiable du tout.
4. Une **seule** horloge synchronisée (passerelle sur NTP) rend comparables les événements de nodes différents. On en a besoin pour corréler une coupure de zone ou mesurer un délai de détection.

`gwTs` est apposé **à la réception par la passerelle, avant la mise en tampon**. Un message envoyé après une coupure réseau garde donc l'heure réelle de l'événement, pas l'heure de sa réémission.

Le front compare `ts` et `gwTs` :
- `ts < 2020-01-01` : alerte informative « horloge non synchronisée » ;
- `|ts − gwTs| > 60 s` : alerte « dérive d'horloge » (maintenance NTP).

Le front n'utilise pas sa propre horloge pour juger un silence. Son « maintenant » est le dernier `gwTs` reçu, mis à jour toutes les 5 s par `rc/v1/gw/{gwId}/status`. Une machine opérateur mal réglée ou un temps simulé accéléré ne faussent donc pas les alertes.

Limite connue : l'accélération du temps fait que le simulateur ne connaît pas l'heure réelle de la passerelle. `gwTs` y vaut donc l'heure **simulée** au moment de l'émission.

## 6. Commandes et acquittements

Commande (front vers node), topic `rc/v1/{zone}/{nodeId}/cmd` :

```json
{"v":1,"id":"7f3c9a2e-…","action":"lamp","value":"off","exp":1790841000000}
```

Acquittement (node vers front), topic `rc/v1/{zone}/{nodeId}/ack` :

```json
{"v":1,"node":"N-TRO-05","type":"ack","ts":…,"gwTs":…,"seq":…,"cmdId":"7f3c9a2e-…","action":"lamp","ok":true,"detail":"applied_but_relay_feedback_on"}
```

- **Corrélation** : `id` est un UUID v4 généré par le front, renvoyé tel quel dans `cmdId`. Le front tient la table des commandes en attente et rapproche l'ack par `cmdId`, jamais par l'ordre d'arrivée.
- **Idempotence** : une commande renvoyée avec le **même** `id` (nouvel essai manuel) a le même effet qu'un seul envoi. Les actions sont des consignes d'état (`lamp=off`), pas des bascules.
- **Expiration** : `exp` (en heure de référence) vaut l'instant d'émission + 5 min. Une commande reçue après `exp`, par exemple livrée depuis la file d'un node resté longtemps hors ligne, **n'est pas appliquée**. Le node répond `ok:false, detail:"expired"`.
- **Délai d'attente côté front** : 10 s réelles. Un node Wi-Fi répond en moins de 1 s. Au-delà de 10 s, la commande passe à l'état « sans réponse ». Le front affiche l'état du node (Last Will, dernier message reçu) pour orienter l'opérateur. Il n'y a **aucun nouvel essai automatique** : relancer un `reboot` ou un `safety_cut` doit rester une décision humaine. Le bouton « Renvoyer » réutilise le même `id`.
- **Node qui ne répond pas** : la commande reste dans la file de session du node (QoS 1, clean=false). Si le node revient avant `exp`, il l'applique et acquitte. Le front, qui a déjà affiché « sans réponse », passe alors la commande à l'état « acquittée en retard ». Après `exp`, elle est rejetée.
- **Nodes LoRa (EXT, classe A)** : la liaison descendante n'est possible qu'après une émission du node (toutes les 5 min). Le délai d'attente doit alors être d'au moins une période d'émission. Seules `interval`, `identify` et `reboot` les concernent.
- **Ack ok mais anomalie** : `detail` porte le retour du terrain. `applied_but_relay_feedback_on` (relais collé) déclenche une **alerte critique** dans le front, même si `ok` vaut `true`.
- Validation : une commande mal formée (JSON invalide, `v` inconnu, action inconnue) est acquittée `ok:false, detail:"bad_request"` si elle porte un `id`, sinon journalisée et ignorée.

## 7. Sécurité du broker

- `allow_anonymous false` : tout client s'authentifie (fichier de mots de passe Mosquitto, hachage PBKDF2-SHA512).
- Mot de passe **propre à chaque node** : `sha256(NODE_SECRET + ":" + nodeId)`, tronqué à 24 caractères hexadécimaux. Il est calculé au provisionnement. Le vol d'un node ne compromet pas les autres, et le secret maître ne quitte pas la passerelle ni l'atelier de provisionnement.
- Les secrets sont passés par **variables d'environnement** (`.env`, non versionné). `docker-compose.yml` contient des valeurs de démonstration à changer.
- ACL par rôle (`broker/config/acl`) :

| Rôle | Lecture | Écriture |
|---|---|---|
| node (`%u` = son identifiant) | `rc/v1/+/%u/cmd` | `rc/v1/+/%u/{status,heartbeat,door,boot,ack}`, `rc/v1/+/%u/reading/+` |
| passerelle | — | `rc/v1/gw/{gwId}/#` |
| front | `rc/v1/#` | `rc/v1/+/+/cmd`, `rc/v1/alerts/+/ack` |
| admin | `#` (dont `$SYS`) | `#` |

  Un node compromis ne peut ni usurper un autre node, ni lire les mesures du site, ni commander un autre terrarium.
  Le front ne peut pas publier de fausses mesures.
- Le front s'authentifie via un formulaire de connexion. Les identifiants ne sont **pas** embarqués dans le JavaScript servi.
- Hors périmètre de la démonstration, mais **requis en production** : TLS sur 8883 et WSS sur 443 (reverse proxy), car le mot de passe circule sinon en clair. Il faudrait aussi un VLAN IoT isolé et la rotation des secrets.
