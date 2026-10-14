import { rc } from "../dev/rc";
import { memo, useEffect, useRef } from "react";
import { useStore } from "../store/store";
import type { AlertD } from "../contracts/ws";
import { transport } from "../transport/transport";
import { utcTime } from "../lib/format";
import { useReducedMotion } from "../hooks/useNow";
import { cssVar } from "../lib/cssVars";

const AlertCard = memo(function AlertCard({ a, isNew }: { a: AlertD; isNew: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!isNew || reduce || !ref.current) return;
    const el = ref.current;
    el.animate(
      [{ transform: `translateY(-${cssVar("--enter-offset")})`, opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: parseFloat(cssVar("--dur-enter")), easing: cssVar("--ease") }
    );
  }, [isNew, reduce]);
  return (
    <div className={"alert sev-" + (a.sev || "info") + (a.ack ? " acked" : "")} ref={ref}>
      <div className="bar" />
      <div className="body">
        <div className="hd">
          <span className="ttl">{a.title || "Alert"}</span>
          <span className="src">{a.src}</span>
          <span className="tm">{a.ts ? utcTime(a.ts) : ""}</span>
        </div>
        <div className="txt">{a.body}</div>
        {a.ack && <div className="stamp">ACK · {utcTime(a.ack_ts ?? a.ts)}</div>}
      </div>
      <button className="ackbtn" disabled={a.ack} onClick={() => transport.sendAck(a.id)}>
        {a.ack ? "ACKED" : "ACK"}
      </button>
    </div>
  );
});

function AlertFeedImpl() {
  rc("AlertFeed");
  const alerts = useStore((s) => s.alerts);
  const topId = useRef<string | null>(null);
  const isNewTop = alerts[0] ? alerts[0].id !== topId.current : false;
  topId.current = alerts[0]?.id ?? null;

  if (!alerts.length) {
    return <div className="feed"><div className="empty">No active alerts — mesh nominal</div></div>;
  }
  return (
    <div className="feed">
      {alerts.map((a, i) => <AlertCard key={a.id} a={a} isNew={i === 0 && isNewTop} />)}
    </div>
  );
}

export const AlertFeed = memo(AlertFeedImpl);
