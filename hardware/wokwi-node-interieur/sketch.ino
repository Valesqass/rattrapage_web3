// Node d'enclos interieur (ESP32-C3) : 2 sondes DS18B20 (point chaud / point froid) sur un meme bus 1-Wire,
// capteur de lumiere, contact de porte sur INTERRUPTION, relais de lampe pilotable par MQTT.
// Messages au format v1 de docs/protocole.md.
//
// Wokwi : la photoresistance remplace le VEML7700 retenu (absent du catalogue Wokwi) ; l'interrupteur
// a glissiere joue le contact reed ; la LED represente le relais de la lampe chauffante.
// Le broker public de test remplace le broker du site (pas d'acces au reseau local depuis Wokwi).

#include <WiFi.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

// ------------------------------------------------------------------ configuration
static const char *WIFI_SSID = "Wokwi-GUEST";
static const char *MQTT_HOST = "test.mosquitto.org";
static const uint16_t MQTT_PORT = 1883;
static const char *NODE_ID = "N-DES-01";
static const char *ZONE = "DES";
static const char *FW = "1.4.2";

static const int PIN_ONEWIRE = 4;
static const int PIN_LIGHT = 1;   // ADC1
static const int PIN_DOOR = 5;    // contact reed vers GND, pull-up interne
static const int PIN_LAMP = 6;    // commande du relais

// Numero de serie (octets 1 a 6 de l'adresse ROM) de chaque sonde, releve a l'installation.
// L'index sur le bus suit l'ordre de recherche 1-Wire, pas le cablage : on ne s'y fie jamais.
static const uint8_t HOT_SERIAL[6] = {0x11, 0x11, 0x11, 0x11, 0x11, 0x11};
static const uint8_t COLD_SERIAL[6] = {0x22, 0x22, 0x22, 0x22, 0x22, 0x22};

static const uint32_t READ_PERIOD_MS = 30000;
static const uint32_t HEARTBEAT_PERIOD_MS = 300000;
static const uint32_t DS18B20_CONVERSION_MS = 750; // 12 bits
static const uint32_t DOOR_DEBOUNCE_MS = 30;

// ------------------------------------------------------------------ etat
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature probes(&oneWire);
WiFiClient net;
PubSubClient mqtt(net);

volatile bool doorEdge = false;
volatile uint32_t doorEdgeMs = 0;
int doorState = -1;               // -1 inconnu, 0 ferme, 1 ouvert
uint32_t seq = 0;
uint32_t lastRead = 0, lastHeartbeat = 0, conversionStarted = 0;
bool conversionPending = false;
char base[48];
DeviceAddress hotAddr, coldAddr;
bool hotFound = false, coldFound = false;

// Associe chaque sonde presente sur le bus a son role grace a son numero de serie.
void mapProbes() {
  DeviceAddress a;
  for (int i = 0; i < probes.getDeviceCount(); i++) {
    if (!probes.getAddress(a, i)) continue;
    if (memcmp(a + 1, HOT_SERIAL, 6) == 0) { memcpy(hotAddr, a, 8); hotFound = true; }
    if (memcmp(a + 1, COLD_SERIAL, 6) == 0) { memcpy(coldAddr, a, 8); coldFound = true; }
  }
  Serial.printf("sonde point chaud %s, point froid %s\n", hotFound ? "OK" : "ABSENTE", coldFound ? "OK" : "ABSENTE");
}

float readProbe(bool found, DeviceAddress addr) {
  return found ? probes.getTempC(addr) : DEVICE_DISCONNECTED_C;
}

void IRAM_ATTR onDoorChange() {
  doorEdge = true;
  doorEdgeMs = millis();
}

// Horodatage device : epoch NTP si synchronise, sinon uptime (la passerelle fait foi de toute facon).
uint64_t deviceTs() {
  time_t now = time(nullptr);
  if (now > 1577836800) return (uint64_t)now * 1000ULL;
  return millis();
}

void publish(const char *suffix, const char *body, bool retain) {
  char topic[96], payload[256];
  snprintf(topic, sizeof topic, "%s/%s", base, suffix);
  snprintf(payload, sizeof payload, "{\"v\":1,\"node\":\"%s\",\"ts\":%llu,\"seq\":%lu,%s}", NODE_ID, deviceTs(), (unsigned long)++seq, body);
  mqtt.publish(topic, payload, retain); // PubSubClient : QoS 0 en emission (QoS 1 sur le firmware cible, cf. dossier)
  Serial.printf("-> %s %s\n", topic, payload);
}

void publishDoor() {
  doorState = digitalRead(PIN_DOOR) == HIGH ? 1 : 0; // HIGH : contact ouvert (aimant eloigne)
  char body[64];
  snprintf(body, sizeof body, "\"type\":\"door\",\"state\":\"%s\"", doorState ? "open" : "closed");
  publish("door", body, true);
}

float readLux() {
  // Conversion de la photoresistance Wokwi (gamma 0,7, RL10 50 kOhm). Remplacee par une lecture I2C sur le VEML7700.
  const float GAMMA = 0.7, RL10 = 50;
  float voltage = analogRead(PIN_LIGHT) / 4095.0 * 3.3;
  if (voltage >= 3.29) return 0;
  float resistance = 2000 * voltage / (1 - voltage / 3.3);
  return pow(RL10 * 1e3 * pow(10, GAMMA) / resistance, 1 / GAMMA);
}

void publishReading(const char *sensor, float value, const char *unit) {
  char body[96];
  snprintf(body, sizeof body, "\"type\":\"reading\",\"sensor\":\"%s\",\"value\":%.4g,\"unit\":\"%s\"", sensor, value, unit);
  char suffix[32];
  snprintf(suffix, sizeof suffix, "reading/%s", sensor);
  publish(suffix, body, true);
}

// ------------------------------------------------------------------ commandes
void handleCommand(char *topic, byte *payload, unsigned int len) {
  char msg[200];
  len = min(len, (unsigned int)(sizeof msg - 1));
  memcpy(msg, payload, len);
  msg[len] = 0;
  char id[72] = "";
  const char *p = strstr(msg, "\"id\":\"");
  if (p) sscanf(p + 6, "%70[^\"]", id);
  bool ok = true;
  const char *detail = "ok";
  const char *action = "unknown";
  if (strstr(msg, "\"action\":\"lamp\"")) {
    action = "lamp";
    if (strstr(msg, "\"value\":\"on\"")) digitalWrite(PIN_LAMP, HIGH);
    else if (strstr(msg, "\"value\":\"off\"")) digitalWrite(PIN_LAMP, LOW);
    else { ok = false; detail = "bad_value"; }
  } else if (strstr(msg, "\"action\":\"identify\"")) {
    action = "identify";
    detail = "led_blink_10s";
  } else {
    ok = false;
    detail = "unknown_action";
  }
  char body[160];
  snprintf(body, sizeof body, "\"type\":\"ack\",\"cmdId\":\"%s\",\"action\":\"%s\",\"ok\":%s,\"detail\":\"%s\"", id, action, ok ? "true" : "false", detail);
  publish("ack", body, false);
}

// ------------------------------------------------------------------ connexion
void ensureConnected() {
  if (mqtt.connected()) return;
  char clientId[40], willTopic[64];
  snprintf(clientId, sizeof clientId, "rc-node-%s", NODE_ID);
  snprintf(willTopic, sizeof willTopic, "%s/status", base);
  while (!mqtt.connected()) {
    Serial.print("MQTT... ");
    // Last Will retenu : le broker annonce le node hors ligne s'il disparait sans DISCONNECT.
    if (mqtt.connect(clientId, nullptr, nullptr, willTopic, 1, true, "{\"v\":1,\"online\":false,\"reason\":\"lwt\"}")) {
      Serial.println("connecte");
      mqtt.publish(willTopic, "{\"v\":1,\"online\":true}", true);
      char cmdTopic[64];
      snprintf(cmdTopic, sizeof cmdTopic, "%s/cmd", base);
      mqtt.subscribe(cmdTopic, 1);
      publishDoor(); // etat reel du contact a chaque (re)connexion
    } else {
      Serial.printf("echec rc=%d, nouvel essai dans 2 s\n", mqtt.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  snprintf(base, sizeof base, "rc/v1/%s/%s", ZONE, NODE_ID);
  pinMode(PIN_LAMP, OUTPUT);
  pinMode(PIN_DOOR, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_DOOR), onDoorChange, CHANGE);

  probes.begin();
  probes.setResolution(12);
  probes.setWaitForConversion(false); // conversion non bloquante : la boucle reste reactive aux portes
  Serial.printf("%d sonde(s) DS18B20 sur le bus\n", probes.getDeviceCount());
  mapProbes();

  WiFi.begin(WIFI_SSID, "", 6);
  while (WiFi.status() != WL_CONNECTED) delay(100);
  configTime(0, 0, "pool.ntp.org");
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(handleCommand);
  mqtt.setKeepAlive(30);
}

void loop() {
  ensureConnected();
  mqtt.loop();
  uint32_t now = millis();

  // Porte : l'ISR ne fait que lever un drapeau ; publication apres anti-rebond, en moins de 100 ms.
  if (doorEdge && now - doorEdgeMs >= DOOR_DEBOUNCE_MS) {
    doorEdge = false;
    int state = digitalRead(PIN_DOOR) == HIGH ? 1 : 0;
    if (state != doorState) publishDoor();
  }

  if (!conversionPending && (lastRead == 0 || now - lastRead >= READ_PERIOD_MS)) {
    probes.requestTemperatures();
    conversionStarted = now;
    conversionPending = true;
    lastRead = now;
  }
  if (conversionPending && now - conversionStarted >= DS18B20_CONVERSION_MS) {
    conversionPending = false;
    // -127 (sonde absente) et 85 (reset) sont transmis tels quels : le front les classe en valeur aberrante.
    publishReading("temp_hot", readProbe(hotFound, hotAddr), "C");
    publishReading("temp_cold", readProbe(coldFound, coldAddr), "C");
    publishReading("light", readLux(), "lx");
  }

  if (lastHeartbeat == 0 || now - lastHeartbeat >= HEARTBEAT_PERIOD_MS) {
    lastHeartbeat = now;
    char body[96];
    snprintf(body, sizeof body, "\"type\":\"heartbeat\",\"uptimeS\":%lu,\"rssi\":%d,\"fw\":\"%s\"", (unsigned long)(now / 1000), WiFi.RSSI(), FW);
    publish("heartbeat", body, true);
  }
}
