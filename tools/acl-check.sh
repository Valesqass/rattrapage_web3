#!/bin/sh
# Verifie l'authentification et les ACL du broker, depuis le conteneur broker :
#   docker compose exec -T broker sh < tools/acl-check.sh
# En MQTT 3.1.1, Mosquitto acquitte une publication refusee puis la jette : on verifie donc la LIVRAISON.
set -u
ADMIN_PW="$MQTT_ADMIN_PASSWORD"
FRONT_PW="$MQTT_FRONT_PASSWORD"
node_pw() { printf '%s:%s' "$MQTT_NODE_SECRET" "$1" | sha256sum | cut -c1-24; }
fails=0

# delivered <user> <pw> <topic> : publie un marqueur et regarde si l'admin le recoit
delivered() {
  marker="acl-$$-$(date +%s)-$RANDOM"
  mosquitto_sub -u admin -P "$ADMIN_PW" -i "acl-watch-$$" -t "$3" -C 1 -W 3 -R > /tmp/got 2>/dev/null &
  sub=$!
  sleep 1
  mosquitto_pub -u "$1" -P "$2" -i "acl-pub-$$" -t "$3" -m "$marker" -q 1 2>/dev/null
  wait $sub
  grep -q "$marker" /tmp/got
}

check() { # check <attendu: yes|no> <libelle> <user> <pw> <topic>
  if delivered "$3" "$4" "$5"; then got=yes; else got=no; fi
  if [ "$got" = "$1" ]; then echo "OK    $2"; else echo "ECHEC $2 (livre=$got, attendu=$1)"; fails=$((fails + 1)); fi
}

P1=$(node_pw N-DES-01)
check yes "node publie sa propre mesure"             N-DES-01 "$P1" rc/v1/DES/N-DES-01/reading/zz_acl_test
check no  "node ne peut pas usurper un autre node"   N-DES-01 "$P1" rc/v1/DES/N-DES-02/reading/zz_acl_test
check no  "node ne peut pas commander un autre node" N-DES-01 "$P1" rc/v1/DES/N-DES-02/cmd
check no  "front ne peut pas publier de mesure"      front "$FRONT_PW" rc/v1/DES/N-DES-01/reading/zz_acl_test
check yes "front peut envoyer une commande"          front "$FRONT_PW" rc/v1/ZZ/N-ZZ-TEST/cmd

if mosquitto_sub -u N-DES-01 -P "$P1" -i "acl-read-$$" -t 'rc/v1/TRO/#' -C 1 -W 3 >/dev/null 2>&1; then
  echo "ECHEC node lit les mesures d'une autre salle"; fails=$((fails + 1))
else echo "OK    node ne lit pas le reste du site"; fi
if mosquitto_sub -u front -P mauvais -t 'rc/v1/#' -C 1 -W 3 >/dev/null 2>&1; then
  echo "ECHEC mauvais mot de passe accepte"; fails=$((fails + 1))
else echo "OK    mauvais mot de passe refuse"; fi
if mosquitto_sub -t 'rc/v1/#' -C 1 -W 3 >/dev/null 2>&1; then
  echo "ECHEC connexion anonyme acceptee"; fails=$((fails + 1))
else echo "OK    connexion anonyme refusee"; fi

echo "$fails echec(s)"
exit "$fails"
