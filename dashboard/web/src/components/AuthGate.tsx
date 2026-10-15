import { useEffect, useState } from "react";
import { useStore } from "../store/store";
import { store } from "../store/store";
import { HardwareTwin } from "./HardwareTwin";
import {
  checkAuth, setupBegin, setupComplete,
  loginBegin, loginComplete, demoLogin, skipRegistration,
} from "../lib/auth";

// Static facts only: nothing on the lock screen may reflect live data before auth.
const TRUST = ["Zero cloud", "Owner-only passkey", "~$290 · ~38 W", "Event → screen < 100 ms", "Phase 1: notify-only"];

function AuthLayout({ children }: { children: React.ReactNode }) {
  const [skipBusy, setSkipBusy] = useState(false);

  async function handleSkip() {
    if (skipBusy) return;
    setSkipBusy(true);
    try {
      await skipRegistration();
    } catch (e) {
      console.warn("Skip registration backend call failed, falling back to demo state:", e);
    } finally {
      store.setAuth(true, true);
      setSkipBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <button
        className="auth-skip-corner"
        onClick={handleSkip}
        disabled={skipBusy}
        type="button"
        aria-label="Skip registration"
        title="Skip registration"
      >
        {skipBusy ? "…" : "skip"}
      </button>
      <section className="auth-hero">
        <h1 className="auth-logo">Void<b>Main</b></h1>
        <p className="auth-subtitle">Detect → govern → alert for the smart-home IoT layer. Zero cloud.</p>
        <div className="auth-action">{children}</div>
        <ul className="auth-trust">
          {TRUST.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </section>
      <aside className="auth-visual" aria-hidden="true">
        <HardwareTwin idle />
        <span className="auth-visual-cap">Pi4 · Pi3a · Pi3b · ESP32-C3 · ESP32-WROOM — one shelf, one switch</span>
      </aside>
    </main>
  );
}

function SetupScreen() {
  const urlToken = new URLSearchParams(location.search).get("t") ?? "";
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSetup() {
    setBusy(true);
    setStatus("Requesting registration...");
    try {
      const options = await setupBegin(urlToken);
      options.challenge = b64ToBuf(options.challenge as unknown as string);
      (options as any).user.id = b64ToBuf((options as any).user.id);
      if ((options as any).excludeCredentials) {
        for (const c of (options as any).excludeCredentials) c.id = b64ToBuf(c.id);
      }
      setStatus("Touch your authenticator...");
      const cred = await navigator.credentials.create({ publicKey: options });
      if (!cred) { setStatus("Registration cancelled"); setBusy(false); return; }
      setStatus("Verifying...");
      await setupComplete(cred);
      store.setAuth(true, true);
    } catch (e: any) {
      setStatus(e.message || "Registration failed");
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="auth-title">Register passkey</h2>
      <p className="auth-hint">Register a passkey to become the dashboard owner.</p>
      <button className="auth-btn" onClick={handleSetup} disabled={busy} autoFocus>
        Register passkey
      </button>
      {status && <div className="auth-status" role="status">{status}</div>}
    </AuthLayout>
  );
}

function LoginScreen() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);

  async function handleLogin() {
    setBusy(true);
    setStatus("Starting authentication...");
    try {
      const options = await loginBegin();
      setStatus("Touch your authenticator...");
      const cred = await navigator.credentials.get({ publicKey: options });
      if (!cred) { setStatus("Authentication cancelled"); setBusy(false); return; }
      setStatus("Verifying...");
      await loginComplete(cred);
      store.setAuth(true, true);
    } catch (e: any) {
      setStatus(e.message || "Authentication failed");
      setBusy(false);
    }
  }

  async function handleDemo() {
    if (!code.trim()) { setStatus("Enter the LAN access code"); return; }
    setCodeBusy(true);
    setStatus("Checking access code…");
    try {
      await demoLogin(code.trim());
      store.setAuth(true, true);
      setStatus("");
    } catch (e: any) {
      setStatus(e.message || "Access code rejected");
    } finally {
      setCodeBusy(false);
    }
  }

  return (
    <AuthLayout>
      <button className="auth-btn" onClick={handleLogin} disabled={busy} autoFocus>
        Unlock with passkey
      </button>
      {status && <div className="auth-status" role="status">{status}</div>}
      <div className="auth-demo">
        <span className="auth-hint">Demo rig on the LAN?</span>
        <input
          className="auth-code"
          type="password"
          value={code}
          placeholder="access code"
          autoComplete="off"
          aria-label="LAN demo access code"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleDemo(); }}
        />
        <button className="auth-btn auth-btn-ghost" onClick={handleDemo} disabled={codeBusy}>
          Unlock
        </button>
      </div>
    </AuthLayout>
  );
}

function CheckingScreen() {
  return (
    <AuthLayout>
      <div className="auth-status" role="status">Checking session…</div>
    </AuthLayout>
  );
}

export function AuthGate({ children }: { children?: React.ReactNode }) {
  const phase = useStore((s) => s.authPhase);

  useEffect(() => {
    checkAuth().then((s) => store.setAuth(s.authenticated, s.has_owner))
      .catch(() => store.setAuth(false, false));
  }, []);

  if (phase === "checking") return <CheckingScreen />;
  if (phase === "setup") return <SetupScreen />;
  if (phase === "login") return <LoginScreen />;
  return <>{children}</>;
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s + pad);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
