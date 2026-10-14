import { useEffect, useRef, useState } from "react";
import { useStore, store } from "../store/store";
import { checkAuth, requestQr, pollQr } from "../lib/auth";

type PhonePhase = "idle" | "loading" | "showing" | "expired" | "error";

function QrModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<PhonePhase>("loading");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("Generating code…");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  // Fetch QR on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ch = await requestQr();
        if (cancelled) return;
        setCode(ch.code);
        setUrl(ch.url);
        setPhase("showing");
        setStatus("");
      } catch (e: any) {
        if (cancelled) return;
        setPhase("error");
        setStatus(e.message || "Could not reach the server");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll every 2 s when showing
  useEffect(() => {
    if (phase !== "showing" || !code) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await pollQr(code);
        if (r.status === "ok") {
          stopPolling();
          store.setAuth(true, true);
        }
      } catch (e: any) {
        stopPolling();
        if (e.message === "expired") {
          setPhase("expired");
          setStatus("Code expired — try again.");
        } else {
          setPhase("error");
          setStatus(e.message || "Polling failed");
        }
      }
    }, 2000);
    return stopPolling;
  }, [phase, code]);

  useEffect(() => () => stopPolling(), []);

  // Dev/demo shortcut: approve directly from this browser (no Google Client ID needed)
  async function handleApproveHere() {
    if (!code) return;
    try {
      const r = await fetch("/auth/approve/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code }),
      });
      if (!r.ok) setStatus("Approve failed: " + (await r.text()));
      // poll picks up the approved session automatically
    } catch (e: any) {
      setStatus(e.message || "Approve failed");
    }
  }

  // Enter key → approve here in dev mode
  useEffect(() => {
    if (phase !== "showing") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter") handleApproveHere(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, code]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape → close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="qr-backdrop" role="dialog" aria-modal="true" aria-label="Authentication">
      <div className="qr-card">
        <button className="qr-close" onClick={onClose} aria-label="Close">✕</button>

        {phase === "loading" && (
          <>
            <div className="qr-spinner" aria-hidden="true" />
            <p className="qr-hint">Generating secure code…</p>
          </>
        )}

        {phase === "showing" && (
          <>
            <h2 className="qr-title">Scan to authenticate</h2>
            <p className="qr-hint">Open your phone camera · approve with fingerprint</p>
            <img
              className="qr-img"
              src={`/auth/qr.svg?u=${encodeURIComponent(url)}`}
              alt="Scan this QR code on your phone"
            />
            <div className="qr-code" aria-label="Pairing code">{code}</div>
            <p className="qr-status" role="status">{status || "Waiting for phone…"}</p>
            {/* Dev / demo mode shortcut — visible when no Google Client ID set */}
            <button
              className="qr-dev-btn"
              onClick={handleApproveHere}
              title="Approve on this machine (demo mode)"
            >
              ↵ Approve here (Enter)
            </button>
          </>
        )}

        {(phase === "expired" || phase === "error") && (
          <>
            <p className="qr-status qr-status--err" role="alert">{status}</p>
            <button
              className="qr-action-btn"
              onClick={() => { setPhase("loading"); setStatus("Generating code…"); setCode(""); setUrl(""); }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LandingScreen() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <>
      <main className="land-screen">
        {/* Left column */}
        <section className="land-hero">
          <div className="land-brand">
            <span className="land-badge">SYSTEM · ALPHA</span>
            <h1 className="land-logo">Void<b>Main</b></h1>
            <p className="land-tagline">Adaptive IoT intelligence — detect, govern, alert.</p>
          </div>

          <button
            className="land-start-btn"
            onClick={() => setModalOpen(true)}
            autoFocus
          >
            <span className="land-start-icon">⬡</span>
            Start
          </button>

          <ul className="land-facts">
            <li><span>🔒</span> Zero cloud — runs on-device</li>
            <li><span>📱</span> Phone fingerprint authentication</li>
            <li><span>⚡</span> Event → screen in under 100 ms</li>
            <li><span>🌐</span> Multi-sensor coordinated response</li>
          </ul>
        </section>

        {/* Right column — decorative */}
        <aside className="land-visual" aria-hidden="true">
          <div className="land-nodes">
            {["Pi4 · Core", "Pi3a · Sensor", "Pi3b · Relay", "ESP32-C3", "ESP32-WROOM"].map((n) => (
              <div key={n} className="land-node">{n}</div>
            ))}
          </div>
          <div className="land-pulse" />
        </aside>
      </main>

      {modalOpen && <QrModal onClose={() => setModalOpen(false)} />}
    </>
  );
}

function CheckingScreen() {
  return (
    <div className="land-checking">
      <div className="qr-spinner" aria-hidden="true" />
      <span>Checking session…</span>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const phase = useStore((s) => s.authPhase);

  useEffect(() => {
    checkAuth()
      .then((s) => store.setAuth(s.authenticated, s.has_owner))
      .catch(() => store.setAuth(false, false));
  }, []);

  if (phase === "checking") return <CheckingScreen />;
  if (phase === "setup" || phase === "login") return <LandingScreen />;
  return <>{children}</>;
}
