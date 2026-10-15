#pragma once
// ---- VoidMain ESP32 risk mini configuration ----
// WiFi: house network (SSID is case-sensitive — ALL CAPS per scan)
#define WIFI_SSID "CURVE02NM"
#define WIFI_PASSWORD "iuji7321"

// MQTT broker = laptop LAN IP (mosquitto listens on 0.0.0.0:1883)
#define MQTT_HOST "10.200.87.1"
#define MQTT_PORT 1883
#define MQTT_CLIENT_ID "voidmain-esp32-mini"

// Pins (ESP32-C3 mini + RGB NeoPixel)
#define NEOPIXEL_PIN 8   // onboard WS2812 RGB NeoPixel
#define OLED_SDA 5
#define OLED_SCL 6
#define OLED_ADDR 0x3C

// Simulated-data label shown on the OLED
#define SIM_LABEL "SIMULATED"
