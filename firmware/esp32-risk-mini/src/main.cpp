// VoidMain ESP32 risk mini
// OLED: system name + risk number + 4 node boxes (pi4/pi3a/pi3b/esp32)
// LED: colour + motion = current system state
//   BLUE  throbbing  — offline / connecting
//   GREEN throbbing  — normal
//   YELLOW blinking  — detection (unusual)
//   RED   blinking   — alert
//   PURPLE throbbing — action taken
//
// Driven by the same local MQTT broker as the dashboard.

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include <Adafruit_NeoPixel.h>
#include <Wire.h>
#include <math.h>
#include "config.h"

static uint32_t pack(uint8_t r, uint8_t g, uint8_t b) {
  return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

// band colours (VoidMain tokens.css)
static const uint32_t RGB_GREEN  = pack(0x3a, 0xc8, 0x70);
static const uint32_t RGB_YELLOW = pack(0xd4, 0xb0, 0x30);
static const uint32_t RGB_RED    = pack(0xd0, 0x48, 0x38);
static const uint32_t RGB_PURPLE = pack(0xa0, 0x60, 0xd0);
static const uint32_t RGB_BLUE   = pack(0x38, 0x6c, 0xd0);

WiFiClient net;
PubSubClient mqtt(net);
Adafruit_NeoPixel pixel(1, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);

Adafruit_SSD1306 oled64(128, 64, &Wire, -1);
Adafruit_SSD1306 oled32(128, 32, &Wire, -1);
static Adafruit_SSD1306* display = nullptr;

// ---- live state ----
enum LedMode { LED_OFFLINE, LED_NORMAL, LED_DETECT, LED_ALERT, LED_ACTION };
static LedMode ledMode = LED_OFFLINE;

static int  score = 0;
static char band[12] = "GREEN";
static bool dirty = true;

// 4 node boxes: pi4, pi3a, pi3b, esp32
static const char* NODES[4] = {"pi4", "pi3a", "pi3b", "esp32"};
static bool nodeUp[4] = {false, false, false, false};

static uint32_t wifiAttemptAt = 0;
static bool wifiWasConnected = false;

// ---- LED engine: throbbing vs blinking ----
static void ledUpdate() {
  uint32_t now = millis();
  uint32_t color;
  bool throb;  // true = smooth pulse, false = hard blink
  switch (ledMode) {
    case LED_NORMAL:  color = RGB_GREEN;  throb = true;  break;
    case LED_DETECT:  color = RGB_YELLOW; throb = false; break;
    case LED_ALERT:   color = RGB_RED;    throb = false; break;
    case LED_ACTION:  color = RGB_PURPLE; throb = true;  break;
    default:          color = RGB_BLUE;   throb = true;  break; // offline/connecting
  }
  uint8_t bri;
  if (throb) {
    // smooth sine 0..255, ~1.6s period
    float t = sinf((now % 1600) / 1600.0f * 2.0f * PI);
    bri = (uint8_t)(40 + 180 * (t * 0.5f + 0.5f));
  } else {
    bri = ((now / 250) & 1) ? 255 : 0;  // hard blink @2Hz
  }
  uint8_t r = (uint8_t)((color >> 16) * bri / 255);
  uint8_t g = (uint8_t)((color >> 8 & 0xFF) * bri / 255);
  uint8_t b = (uint8_t)((color & 0xFF) * bri / 255);
  pixel.setPixelColor(0, r, g, b);
  pixel.show();
}

// ---- I2C + OLED ----
static bool initOled() {
  Wire.begin(OLED_SDA, OLED_SCL);
  int addr = -1;
  for (uint8_t a = 0x3C; a <= 0x3D; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { addr = a; break; }
  }
  if (addr < 0) {
    for (uint8_t a = 0x08; a < 0x78; a++) {
      Wire.beginTransmission(a);
      if (Wire.endTransmission() == 0) { addr = a; break; }
    }
  }
  if (addr < 0) { Serial.println("[oled] no I2C device"); return false; }
  if (oled64.begin(SSD1306_SWITCHCAPVCC, addr)) display = &oled64;
  else if (oled32.begin(SSD1306_SWITCHCAPVCC, addr)) display = &oled32;
  Serial.printf("[oled] ok @0x%02X %s\n", addr, display ? "up" : "init-fail");
  return display != nullptr;
}

// ---- render: name + score + band + 4 node boxes ----
static void render() {
  if (!display) return;
  int h = display->height();
  display->clearDisplay();
  display->setTextColor(SSD1306_WHITE);

  // system name
  display->setTextSize(1);
  display->setCursor(0, 0);
  display->print("VoidMain ");
  display->print(SIM_LABEL);

  // risk number — big
  display->setTextSize(h >= 64 ? 3 : 2);
  display->setCursor(0, h >= 64 ? 12 : 10);
  display->printf("%3d", score);

  // band label next to score
  display->setTextSize(1);
  int bx = 62;
  display->setCursor(bx, h >= 64 ? 16 : 12);
  display->print(band);

  // status word under band
  const char* st =
      ledMode == LED_ALERT   ? "ALERT" :
      ledMode == LED_DETECT  ? "DETECT" :
      ledMode == LED_ACTION  ? "AUTO" :
      ledMode == LED_NORMAL  ? "NORMAL" : "OFFLINE";
  display->setCursor(bx, h >= 64 ? 26 : 22);
  display->print(st);

  // 4 node boxes along the bottom
  int boxW = 28, boxH = 16, gap = 4;
  int totalW = 4 * boxW + 3 * gap;
  int x0 = (128 - totalW) / 2;
  int y0 = h - boxH - 2;
  display->setTextSize(1);
  for (int i = 0; i < 4; i++) {
    int x = x0 + i * (boxW + gap);
    if (nodeUp[i]) {
      display->fillRect(x, y0, boxW, boxH, SSD1306_WHITE);
      display->setTextColor(SSD1306_BLACK);
    } else {
      display->drawRect(x, y0, boxW, boxH, SSD1306_WHITE);
      display->setTextColor(SSD1306_WHITE);
    }
    int tw = strlen(NODES[i]) * 6;
    display->setCursor(x + (boxW - tw) / 2, y0 + (boxH - 8) / 2);
    display->print(NODES[i]);
    display->setTextColor(SSD1306_WHITE);
  }
  display->display();
}

// ---- boot animation: eyes open -> look around -> blink -> scoreboard ----
static float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

static void drawEye(int cx, int cy, int R, float openAmt, float lookX) {
  if (openAmt <= 0.03f) {  // closed: a single lid line
    display->drawLine(cx - R, cy, cx + R, cy, SSD1306_WHITE);
    return;
  }
  display->drawCircle(cx, cy, R, SSD1306_WHITE);
  int pr = R / 3;
  int px = cx + (int)(lookX * (R - pr - 3));
  display->fillCircle(px, cy, pr, SSD1306_WHITE);
  if (openAmt < 0.97f) {  // lids: black out top/bottom, white lid edges
    int half = (int)(R * openAmt);
    display->fillRect(cx - R - 2, cy - R - 2, 2 * R + 4, R - half + 2, SSD1306_BLACK);
    display->fillRect(cx - R - 2, cy + half, 2 * R + 4, R - half + 2, SSD1306_BLACK);
    display->drawLine(cx - R, cy - half, cx + R, cy - half, SSD1306_WHITE);
    display->drawLine(cx - R, cy + half, cx + R, cy + half, SSD1306_WHITE);
  }
}

static void bootAnimation() {
  if (!display) return;
  int h = display->height();
  int cy  = h >= 64 ? 36 : 16;
  int R   = h >= 64 ? 15 : 11;
  int cxA = h >= 64 ? 40 : 44;
  int cxB = h >= 64 ? 88 : 84;
  const uint32_t T_OPEN_END = 1000, T_LOOK_END = 2800, T_TOTAL = 3150;
  uint32_t t0 = millis();
  Serial.println("[boot] eyes animation");
  while (millis() - t0 < T_TOTAL) {
    uint32_t e = millis() - t0;
    float openAmt = 0.0f, lookX = 0.0f;
    if (e < 300) {
      openAmt = 0.0f;                                // eyes closed
    } else if (e < T_OPEN_END) {
      float p = (e - 300) / 700.0f;                  // lids opening
      openAmt = p * p;
    } else if (e < T_LOOK_END) {
      openAmt = 1.0f;
      uint32_t t = e - T_OPEN_END;                   // look L -> R -> center
      if (t < 600)       lookX = -(float)t / 600.0f;
      else if (t < 1200) lookX = -1.0f + 2.0f * ((t - 600) / 600.0f);
      else               lookX = 1.0f - (float)(t - 1200) / 600.0f;
      lookX = clampf(lookX, -1.0f, 1.0f);
    } else {
      float p = (float)(e - T_LOOK_END) / 350.0f;    // one blink
      openAmt = 1.0f - sinf(clampf(p, 0.0f, 1.0f) * PI);
    }
    display->clearDisplay();
    display->setTextColor(SSD1306_WHITE);
    if (h >= 64) {
      display->setTextSize(1);
      display->setCursor(34, 4);
      display->print("VoidMain");
    }
    drawEye(cxA, cy, R, openAmt, lookX);
    drawEye(cxB, cy, R, openAmt, lookX);
    display->display();
    ledUpdate();
    delay(15);
  }
  Serial.println("[boot] scoreboard");
  dirty = true;  // loop() takes over with the risk scoreboard
}

// ---- WiFi (non-blocking) ----
static void wifiStart() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  wifiAttemptAt = millis();
  Serial.printf("[wifi] connecting %s", WIFI_SSID);
}

static void wifiMaintain() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.printf(" -> %s\n", WiFi.localIP().toString().c_str());
    }
    return;
  }
  if (wifiWasConnected) { wifiWasConnected = false; ledMode = LED_OFFLINE; wifiStart(); return; }
  if (millis() - wifiAttemptAt > 12000) {
    Serial.println("[wifi] retry");
    WiFi.disconnect(); delay(50);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    wifiAttemptAt = millis();
  }
}

// ---- band -> led mode ----
static void applyBand(const char* b) {
  if (!strcmp(b, "YELLOW")) ledMode = LED_DETECT;
  else if (!strcmp(b, "RED")) ledMode = LED_ALERT;
  else if (!strcmp(b, "PURPLE")) ledMode = LED_ACTION;
  else ledMode = LED_NORMAL;
  strlcpy(band, b, sizeof(band));
}

// ---- MQTT ----
static void onMqtt(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;

  if (strstr(topic, "risk/score")) {
    score = doc["v"] | 0;
  } else if (strstr(topic, "risk/band")) {
    applyBand(doc["b"] | "GREEN");
  } else if (strstr(topic, "health/")) {
    // voidmain/health/<node>  {"node":"pi4","up":true,...}
    const char* node = doc["node"] | "";
    bool up = doc["up"] | false;
    for (int i = 0; i < 4; i++) {
      if (strstr(topic, NODES[i]) || !strcmp(node, NODES[i])) {
        nodeUp[i] = up;
        break;
      }
    }
  } else if (strstr(topic, "alert/")) {
    // severity of newest open alert nudges mode
    const char* sev = doc["sev"] | "";
    if (!strcmp(sev, "red") || !strcmp(sev, "critical")) ledMode = LED_ALERT;
    else if (!strcmp(sev, "yellow") || !strcmp(sev, "warn")) ledMode = LED_DETECT;
    else if (!strcmp(sev, "purple")) ledMode = LED_ACTION;
  } else if (strstr(topic, "device/")) {
    // automation flag -> purple action
    if (doc["automation"] | false) ledMode = LED_ACTION;
    else {
      const char* sev = doc["sev"] | "";
      if (!strcmp(sev, "red")) ledMode = LED_ALERT;
      else if (!strcmp(sev, "yellow")) ledMode = LED_DETECT;
      else if (!strcmp(sev, "purple")) ledMode = LED_ACTION;
    }
  }
  dirty = true;
}

static void mqttMaintain() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!mqtt.connected()) {
    if (mqtt.connect(MQTT_CLIENT_ID)) {
      mqtt.subscribe("voidmain/risk/score");
      mqtt.subscribe("voidmain/risk/band");
      mqtt.subscribe("voidmain/health/#");
      mqtt.subscribe("voidmain/alert/#");
      mqtt.subscribe("voidmain/device/#");
      Serial.println("[mqtt] connected");
      if (ledMode == LED_OFFLINE) ledMode = LED_NORMAL;
    } else {
      static uint32_t last;
      if (millis() - last > 3000) {
        last = millis();
        Serial.printf("[mqtt] rc=%d\n", mqtt.state());
      }
      return;
    }
  }
  mqtt.loop();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[boot] VoidMain risk mini");

  pixel.begin();
  pixel.setBrightness(200);

  initOled();
  wifiStart();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMqtt);
}

void loop() {
  wifiMaintain();
  if (!wifiWasConnected) ledMode = LED_OFFLINE;
  else if (!mqtt.connected() && ledMode != LED_OFFLINE) {
    // wifi ok but broker not yet — keep current band colour; if never connected stay blue
  }
  mqttMaintain();

  ledUpdate();                 // runs every loop: throb/blink
  if (dirty) { dirty = false; render(); }
  delay(15);
}
