# VoidMain · ESP32 risk mini

Live miniature of the dashboard **risk section** on an ESP32-C3 SuperMini:

| Hardware | Wiring |
|---|---|
| WS2812 NeoPixel (onboard) | **GPIO 8** |
| SSD1306 OLED 128×64 (I2C) | **SDA → GPIO 5**, **SCL → GPIO 6**, addr `0x3C` |

## What it shows

- **OLED** — `VoidMain · SIMULATED` header, current **band** banner (GREEN / YELLOW / RED / PURPLE), **risk score** number + bar, and the latest alert/device line.
- **NeoPixel** — follows the band colour (same palette as the dashboard: `#3ac870` / `#d4b030` / `#d04838` / `#a060d0`), slow blink while GREEN.

Everything is driven by the **same local MQTT broker** the dashboard uses, so when the **SIM TOUR** runs, the panel changes with it.

## Topics consumed

| Topic | Payload |
|---|---|
| `voidmain/risk/score` | `{"v": 42}` |
| `voidmain/risk/band` | `{"b": "YELLOW"}` |
| `voidmain/alert/#` | `{"title": "...", ...}` |
| `voidmain/device/#` | `{"name": "...", "state": "...", ...}` |

## Config — `src/config.h`

```c
WIFI_SSID     "Curve02NM"
WIFI_PASSWORD "iuji7321"
MQTT_HOST     "10.237.33.129"   // laptop LAN IP — update if it changes
```

Change `MQTT_HOST` to your laptop's LAN IP if it changes (`ip -4 -o addr show scope global`).

## Flash (PlatformIO)

```bash
cd firmware/esp32-risk-mini
pio run -t upload        # USB serial
pio device monitor       # 115200 baud
```

Arduino IDE alternative: create a sketch with the same `src/*.cpp|h` contents
(board: **ESP32C3 Dev Module**, USB CDC On Boot: *Enabled*), install
*ArduinoJson*, *PubSubClient*, *Adafruit SSD1306*, *Adafruit GFX*,
*Adafruit NeoPixel*.

## Demo

1. Start the stack (`./start.sh`) — mosquitto + backend + mock feed + web.
2. Flash the board once; it joins WiFi and subscribes.
3. Press **▶ SIM TOUR** in the dashboard — band/score/alerts stream to the
   OLED and LED in real time.

*All data shown is simulated demo data.*
