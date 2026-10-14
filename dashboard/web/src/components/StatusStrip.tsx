import { memo } from "react";
import { useStore } from "../store/store";

function StatusStripImpl() {
  const s = useStore((st) => ({
    events: st.eventCount, open: st.openCount, ackTotal: st.ackTotal,
    ackDone: st.ackDone, conn: st.conn, newDevs: st.layers.lanToday,
  }));
  const ackRate = s.ackTotal ? Math.round((s.ackDone / s.ackTotal) * 100) + "%" : "—";
  const uptime = s.conn === "offline" ? "—" : "100%";

  return (
    <div className="status-strip">
      <span className="ss-cell"><b className="num">{s.events}</b> events/24h</span>
      <span className="ss-cell"><b className="num">{s.open}</b> open</span>
      <span className="ss-cell">ack rate <b className="num">{ackRate}</b></span>
      <span className="ss-cell">uptime <b className="num">{uptime}</b></span>
      <span className="ss-cell"><b className="num">{s.newDevs}</b> new devices</span>
      <span className="ss-cell ss-decay">governance: −2 pts / 10s → baseline 0</span>
      <span className="ss-sep" />
      <span className="ss-cell">MQTT <span className="num">127.0.0.1:1883</span></span>
      <span className="ss-cell">evidence <span className="num">/mnt/pendrive/ultron/ultron.db</span></span>
    </div>
  );
}

export const StatusStrip = memo(StatusStripImpl);
