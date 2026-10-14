import { memo } from "react";
import { useStore } from "../store/store";
import { ago } from "../lib/format";
import { useNow } from "../hooks/useNow";

function DegradedBannerImpl() {
  const conn = useStore((s) => s.conn);
  const degraded = useStore((s) => s.degraded);
  const scoreTs = useStore((s) => s.scoreTs);
  const now = useNow(1000);
  const show = degraded || conn !== "live";
  if (!show) return null;
  return (
    <div className="banner" role="status">
      <b>{degraded ? "MQTT degraded" : conn === "stale" ? "Link stale" : "Link offline"}</b>
      <span>last data {scoreTs ? `${ago(scoreTs, now)} ago` : "never"} — values held, not live.</span>
    </div>
  );
}

export const DegradedBanner = memo(DegradedBannerImpl);
