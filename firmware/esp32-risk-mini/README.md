# VoidMain · ESP32 risk mini

Live miniature of the dashboard **risk section** on an ESP32-C3 SuperMini:

| Hardware | Wiring |
|---|---|
| WS2812 NeoPixel (onboard) | **GPIO 8** |
| SSD1306 OLED 128×64 (I2C) | **SDA → GPIO 5**, **SCL → GPIO 6**, addr `0x3C` |

## What it shows

- **OLED** — `VoidMain · VOIDMAIN` header (boot animation: eyes open → look around → blink → scoreboard), current **band** banner (GREEN / YELLOW / RED / PURPLE), **risk score** number, and 4 node boxes (pi4 / pi3a / pi3b / esp32).
- **NeoPixel** — follows the band colour (same palette as the dashboard: `#3ac870` / `#d4b030` / `#d04838` / `#a060d0`), slow throbbing pulse while GREEN, hard blink while YELLOW/RED, throbbing pulse while PURPLE.

Everything is driven by the **same local MQTT broker** the dashboard uses.

## Topics consumed

| Topic | Payload |
|---|---|
| `voidmain/risk/score` | `{"v": 42}` |
| `voidmain/risk/band` | `{"b": "YELLOW"}` |
| `voidmain/alert/#` | `{"sev": "red", "title": "...", ...}` |
| `voidmain/device/#` | `{"name": "...", "sev": "...", "state": "...", ...}` |
| `voidmain/health/#` | `{"node": "pi4", "up": 3600, ...}` — fills the 4 node boxes |

## Topics published

| Topic | Payload | Why |
|---|---|---|
| `voidmain/health/esp32` (retained, every 5 s) | `{"node":"esp32","up":128,"services":["ok"]}` | `up` = seconds since boot. Keeps the dashboard's **ESP32 node tile** and this panel's own node box in sync with reality. |
| `voidmain/health/esp32` (last-will, retained) | `{"node":"esp32","up":0,"services":[]}` | Fired by the broker when the board drops → the tile ages out to down instead of lying. |

Watch the board's view of the bus with `pio device monitor` — every score/band it
renders is traced as `[rx] score=…` / `[rx] band=…`.

## Config — `src/config.h`

```c
WIFI_SSID     "Farlands Hackathon"
WIFI_PASSWORD "farlands@2026"
MQTT_HOST     "10.10.8.97"   // laptop's wlan0 IP — update if it changes
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


