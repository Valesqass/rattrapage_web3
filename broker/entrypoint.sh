#!/bin/sh
# Genere le fichier de mots de passe a partir des variables d'environnement puis lance Mosquitto.
# Aucun secret n'est stocke dans l'image ni dans le depot.
set -eu

: "${MQTT_ADMIN_PASSWORD:?MQTT_ADMIN_PASSWORD manquant}"
: "${MQTT_FRONT_PASSWORD:?MQTT_FRONT_PASSWORD manquant}"
: "${MQTT_GW_PASSWORD:?MQTT_GW_PASSWORD manquant}"
: "${MQTT_NODE_SECRET:?MQTT_NODE_SECRET manquant}"

AUTH_DIR=/mosquitto/auth
PASSWD="$AUTH_DIR/passwd"
mkdir -p "$AUTH_DIR"
umask 077

mosquitto_passwd -c -b "$PASSWD" admin "$MQTT_ADMIN_PASSWORD"
mosquitto_passwd -b "$PASSWD" front "$MQTT_FRONT_PASSWORD"
mosquitto_passwd -b "$PASSWD" gw-sim "$MQTT_GW_PASSWORD"

count=0
while IFS= read -r id || [ -n "$id" ]; do
  id=$(printf '%s' "$id" | tr -d '\r')
  case "$id" in '' | \#*) continue ;; esac
  pw=$(printf '%s:%s' "$MQTT_NODE_SECRET" "$id" | sha256sum | cut -c1-24)
  mosquitto_passwd -b "$PASSWD" "$id" "$pw"
  count=$((count + 1))
done < /mosquitto/config/nodes.txt

# La configuration est montee en lecture seule : copie de l'ACL avec les droits exiges par Mosquitto.
cp /mosquitto/config/acl "$AUTH_DIR/acl"
chown -R mosquitto:mosquitto "$AUTH_DIR" /mosquitto/data
chmod 700 "$AUTH_DIR"
chmod 600 "$PASSWD" "$AUTH_DIR/acl"
echo "entrypoint: $count nodes + admin, front, gw-sim provisionnes"

exec mosquitto -c /mosquitto/config/mosquitto.conf
