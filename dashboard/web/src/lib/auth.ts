import { store } from "../store/store";

export interface AuthStatus {
  has_owner: boolean;
  authenticated: boolean;
}

export async function checkAuth(): Promise<AuthStatus> {
  const r = await fetch("/auth/status");
  return r.json();
}

export async function setupBegin(token: string): Promise<PublicKeyCredentialCreationOptions> {
  const r = await fetch("/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function setupComplete(credential: Credential): Promise<void> {
  const pub = credential as PublicKeyCredential;
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
  const r = await fetch("/auth/setup/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function loginBegin(): Promise<PublicKeyCredentialRequestOptions> {
  const r = await fetch("/auth/login/begin", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) throw new Error(await r.text());
  const opts = await r.json();
  opts.challenge = b64ToBuf(opts.challenge);
  if (opts.allowCredentials) {
    for (const c of opts.allowCredentials) c.id = b64ToBuf(c.id);
  }
  return opts;
}

export async function loginComplete(credential: Credential): Promise<void> {
  const pub = credential as PublicKeyCredential;
  const resp = pub.response as AuthenticatorAssertionResponse;
  const body = {
    id: pub.id,
    rawId: bufToB64(pub.rawId),
    type: pub.type,
    response: {
      authenticatorData: bufToB64(resp.authenticatorData),
      clientDataJSON: bufToB64(resp.clientDataJSON),
      signature: bufToB64(resp.signature),
      userHandle: resp.userHandle ? bufToB64(resp.userHandle) : null,
    },
    authenticatorAttachment: (pub as any).authenticatorAttachment ?? "platform",
    clientExtensionResults: pub.getClientExtensionResults(),
  };
  const r = await fetch("/auth/login/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
  store.setAuth(false, true);
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s + pad);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
