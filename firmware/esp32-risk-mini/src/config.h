#pragma once
// ---- VoidMain ESP32 risk mini configuration ----
// WiFi: Farlands Hackathon (laptop wlan0 — same LAN, same AP)
#define WIFI_SSID "Farlands Hackathon"
#define WIFI_PASSWORD "farlands@2026"

// MQTT broker = laptop's wlan0 IP (Farlands LAN); mosquitto listens on 0.0.0.0:1883
#define MQTT_HOST "10.10.8.97"
#define MQTT_PORT 1883
#define MQTT_CLIENT_ID "voidmain-esp32-mini"

// Pins (ESP32-C3 mini + RGB NeoPixel)
#define NEOPIXEL_PIN 8   // onboard WS2812 RGB NeoPixel
#define OLED_SDA 5
#define OLED_SCL 6
#define OLED_ADDR 0x3C

// Data label shown on the OLED
#define SIM_LABEL "VOIDMAIN"
