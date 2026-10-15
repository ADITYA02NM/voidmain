"""Server bridge: envelope shape, allowlist, ACK safety."""
import json

from server.bridge import SUB_TOPICS, VALID_T, map_message, envelope, Bridge, Hub
from server.config import Config


def _p(obj) -> bytes:
    return json.dumps(obj).encode()


def test_subscribe_allowlist_is_frozen():
    assert SUB_TOPICS == (
        "voidmain/health/#", "voidmain/alert/#", "voidmain/risk/score", "voidmain/risk/band",
        "voidmain/lan/#", "voidmain/tripwire/#", "voidmain/suricata/#", "voidmain/wifi/#",
        "voidmain/device/#",
    )


def test_score_and_band_mapping():
    assert map_message("voidmain/risk/score", _p({"v": 42})) == {"t": "score", "d": {"v": 42}}
    assert map_message("voidmain/risk/score", b"57") == {"t": "score", "d": {"v": 57}}
    assert map_message("voidmain/risk/band", _p({"b": "red"})) == {"t": "band", "d": {"b": "RED"}}
    assert map_message("voidmain/risk/band", _p({"b": "MAUVE"})) is None
    assert map_message("voidmain/risk/score", _p({"v": "nope"})) is None


def test_suricata_and_wifi_become_events_tagged_by_kind():
    m = map_message("voidmain/suricata/0", _p({"signature": "ET SCAN", "severity": "red"}))
    assert m["t"] == "event" and m["d"]["kind"] == "suricata" and m["d"]["summary"] == "ET SCAN"
    w = map_message("voidmain/wifi/0", _p({"title": "Rogue AP"}))
    assert w["t"] == "event" and w["d"]["kind"] == "wifi" and w["d"]["summary"] == "Rogue AP"


def test_health_lan_tripwire_shapes():
    assert map_message("voidmain/health/pi4", _p({"up": 10}))["t"] == "health"
    assert map_message("voidmain/health/pi4", _p({"up": 10}))["d"]["node"] == "pi4"
    assert map_message("voidmain/lan/x", _p({"mac": "AA"}))["t"] == "lan"
    tw = map_message("voidmain/tripwire/pi3a", _p({}))
    assert tw["t"] == "tripwire" and tw["d"]["node"] == "pi3a" and tw["d"]["edge"] == "open"


def test_unlisted_topic_is_dropped():
    assert map_message("voidmain/other/x", _p({"a": 1})) is None
    assert map_message("voidmain/ack/1", _p({"id": "1"})) is None


def test_all_mapped_types_are_valid():
    for topic in ("voidmain/risk/score", "voidmain/risk/band", "voidmain/alert/1",
                  "voidmain/health/pi4", "voidmain/lan/x", "voidmain/tripwire/pi3a",
                  "voidmain/suricata/0", "voidmain/wifi/0", "voidmain/device/door-1"):
        m = map_message(topic, _p({"v": 1, "b": "RED", "mac": "A", "severity": "red"}))
        if m is not None:
            assert m["t"] in VALID_T


def test_device_topic_maps_to_device_envelope():
    m = map_message("voidmain/device/door-1",
                    _p({"name": "Front Door", "kind": "lock", "room": "Entrance",
                        "sev": "red", "state": "Tamper detected", "locked": True}))
    assert m["t"] == "device"
    assert m["d"]["id"] == "door-1"
    assert m["d"]["sev"] == "red"


def test_envelope_stamps_ts():
    e = envelope("score", {"v": 1})
    assert e["t"] == "score" and e["d"] == {"v": 1} and isinstance(e["ts"], float)


async def test_publish_ack_is_safe_when_offline():
    # Read-only safety: no client connected -> no publish, returns False.
    b = Bridge(Config(), Hub())
    assert b.connected is False
    assert await b.publish_ack("evil id/../#") is False
