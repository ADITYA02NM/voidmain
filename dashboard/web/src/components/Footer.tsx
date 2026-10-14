import { rc } from "../dev/rc";
import { memo } from "react";

function FooterImpl() {
  rc("Footer");
  return (
    <footer>
      <span>ULTRON <span className="v">v0.3.0-phase1</span></span>
      <span>MQTT <span className="v">127.0.0.1:1883</span></span>
      <span>EVIDENCE <span className="v">Pi4 USB3 pendrive · /mnt/pendrive/ultron/ultron.db</span></span>
      <span>NODE <span className="v">Pi4 — GOVERNANCE · 192.168.100.1:8080</span></span>
      <span><a href="/debug.html">debug</a> · <span>Phase 1 · notify-only</span></span>
    </footer>
  );
}

export const Footer = memo(FooterImpl);
