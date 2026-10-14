import { memo, useCallback, useEffect, useState } from "react";
import { useStore } from "../store/store";
import { store } from "../store/store";

interface CredentialInfo {
  id: string;
  created_at: number | null;
  last_used_at: number | null;
  revoked: boolean;
  sign_count: number;
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s + pad);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fmtDate(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function DevicesPanelImpl() {
  const show = useStore((s) => s.showDevices);
  const [creds, setCreds] = useState<CredentialInfo[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/auth/credentials");
      if (!r.ok) throw new Error("Failed to load");
      setCreds(await r.json());
      setStatus("");
    } catch (e: any) {
      setStatus(e.message);
    }
  }, []);

  useEffect(() => {
    if (show) refresh();
  }, [show, refresh]);

  if (!show) return null;

  async function handleAdd() {
    setBusy(true);
    setStatus("Starting registration...");
    try {
      const r = await fetch("/auth/register/begin", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error(await r.text());
      const options = await r.json();
      options.challenge = b64ToBuf(options.challenge);
      options.user.id = b64ToBuf(options.user.id);
      if (options.excludeCredentials) {
        for (const c of options.excludeCredentials) c.id = b64ToBuf(c.id);
      }
      setStatus("Touch your authenticator...");
      const cred = await navigator.credentials.create({ publicKey: options });
      if (!cred) { setStatus("Registration cancelled"); setBusy(false); return; }
      const pub = cred as PublicKeyCredential;
      const resp = pub.response as AuthenticatorAttestationResponse;
      const body = {
        id: pub.id,
        rawId: bufToB64(pub.rawId),
        type: pub.type,
        response: {
          attestationObject: bufToB64(resp.attestationObject),
          clientDataJSON: bufToB64(resp.clientDataJSON),
        },
        authenticatorAttachment: (pub as any).authenticatorAttachment ?? "platform",
        clientExtensionResults: pub.getClientExtensionResults(),
      };
      const cr = await fetch("/auth/register/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!cr.ok) throw new Error(await cr.text());
      setStatus("Device added");
      await refresh();
    } catch (e: any) {
      setStatus(e.message || "Registration failed");
    }
    setBusy(false);
  }

  async function handleRevoke(id: string) {
    setBusy(true);
    setStatus("");
    try {
      const r = await fetch(`/auth/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text);
      }
      setStatus("Credential revoked");
      await refresh();
    } catch (e: any) {
      setStatus(e.message || "Revoke failed");
    }
    setBusy(false);
  }

  return (
    <div className="devices-overlay" onClick={() => store.setShowDevices(false)}>
      <div className="devices-panel" onClick={(e) => e.stopPropagation()}>
        <div className="devices-hd">
          <span className="label">REGISTERED DEVICES</span>
          <button className="devices-close" onClick={() => store.setShowDevices(false)} aria-label="Close">&times;</button>
        </div>
        <div className="devices-list">
          {creds.map((c) => (
            <div key={c.id} className={`devices-row${c.revoked ? " revoked" : ""}`}>
              <div className="devices-id">{c.id.slice(0, 24)}...</div>
              <div className="devices-meta">
                <span>Created: {fmtDate(c.created_at)}</span>
                <span>Last used: {fmtDate(c.last_used_at)}</span>
                <span>Count: {c.sign_count}</span>
              </div>
              <div className="devices-actions">
                {c.revoked
                  ? <span className="devices-revoked-tag">REVOKED</span>
                  : <button className="devices-revoke-btn" disabled={busy}
                      onClick={() => handleRevoke(c.id)}>Revoke</button>}
              </div>
            </div>
          ))}
          {creds.length === 0 && <div className="devices-empty">No credentials registered</div>}
        </div>
        <div className="devices-footer">
          <button className="auth-btn" onClick={handleAdd} disabled={busy}>
            Add Device
          </button>
          {status && <div className="auth-status">{status}</div>}
        </div>
      </div>
    </div>
  );
}

export const DevicesPanel = memo(DevicesPanelImpl);
