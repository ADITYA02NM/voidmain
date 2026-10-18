#pragma once
// ---- VoidMain ESP32 risk mini configuration ----
// WiFi: Farlands Hackathon (laptop wlan0 — same LAN, same AP)
#define WIFI_SSID "Farlands Hackathon"
#define WIFI_PASSWORD "farlands@2026"

// MQTT broker discovery:
//  The hackathon LAN hands out a NEW laptop IP on every reconnect, so we do
//  NOT trust a hardcoded address. Primary path = mDNS lookup of the laptop's
//  hostname (avahi must be running on the laptop). If mDNS fails we fall back
//  to MQTT_HOST (last known laptop IP) so a bare-bones network still links up.
#define MQTT_HOSTNAME "archlinux"     // laptop mDNS name -> archlinux.local
#define MQTT_HOST "10.212.232.129"    // fallback only (last known wlan0 IP)
#define MQTT_PORT 1883
#define MQTT_CLIENT_ID "voidmain-esp32-mini"

// Pins (ESP32-C3 mini + RGB NeoPixel)
#define NEOPIXEL_PIN 8   // onboard WS2812 RGB NeoPixel
#define OLED_SDA 5
#define OLED_SCL 6
#define OLED_ADDR 0x3C

// Simulated-data label shown on the OLED
#define SIM_LABEL "SIMULATED"
