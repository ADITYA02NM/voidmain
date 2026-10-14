import { memo, useRef, useEffect } from "react";
import { useStore } from "../store/store";
import { QUICK_CMDS, execCommand } from "../lib/commands";
import { utcTime } from "../lib/format";

function QuickControlsImpl() {
  const history = useStore((s) => s.commandHistory);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [history.length]);

  return (
    <div className="qc">
      <div className="qc-buttons">
        {QUICK_CMDS.map((q) => (
          <button key={q.cmd} className="qc-btn"
            onClick={() => execCommand(q.cmd)}>
            <span className="qc-label">{q.label}</span>
          </button>
        ))}
      </div>
      <div className="qc-log-hd label">Output</div>
      <div className="qc-log" ref={logRef}>
        {history.length === 0 && <div className="qc-empty">No commands issued this session</div>}
        {history.map((h) => (
          <div key={h.id} className={`qc-entry${h.ok ? "" : " err"}`}>
            <div className="qc-cmd">
              <span className="qc-prompt">$</span>
              <span className="qc-text">{h.command}</span>
              <span className="qc-ts num">{utcTime(h.ts / 1000)}</span>
              <span className={`qc-status${h.ok ? " ok" : ""}`}>{h.ok ? "OK" : "ERR"}</span>
            </div>
            <div className="qc-result">{h.result}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const QuickControls = memo(QuickControlsImpl);
