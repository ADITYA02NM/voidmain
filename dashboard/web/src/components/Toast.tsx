import { memo } from "react";
import { store, useStore } from "../store/store";
import { useNow } from "../hooks/useNow";

const TTL_MS = 6000;

function ToastImpl() {
  const toast = useStore((s) => s.lastToast);
  const muteUntil = useStore((s) => s.muteUntil);
  const now = useNow(1000);

  if (!toast) return null;
  if (now < muteUntil) return null;
  if (now - toast.at >= TTL_MS) return null;

  return (
    <div className={`toast sev-${toast.sev}`} role="status">
      <span className="toast-bar" />
      <span className="toast-msg">{toast.msg}</span>
      <span className="toast-sev num">{toast.sev}</span>
      <button className="toast-close" aria-label="Dismiss" onClick={() => store.clearToast()}>
        ×
      </button>
    </div>
  );
}

export const Toast = memo(ToastImpl);
