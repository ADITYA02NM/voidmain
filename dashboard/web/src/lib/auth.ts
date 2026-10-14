import { store } from "../store/store";

export interface AuthStatus {
  has_owner: boolean;
  authenticated: boolean;
}

export interface QrChallenge {
  code: string;
  url: string;
  expires_in: number;
}

export interface QrPollResult {
  status: "pending" | "ok";
  authenticated?: boolean;
  email?: string;
}

export async function checkAuth(): Promise<AuthStatus> {
  const r = await fetch("/auth/status");
  return r.json();
}

/** Request a phone-pairing code + approve URL from the server. */
export async function requestQr(): Promise<QrChallenge> {
  const r = await fetch("/auth/qr", { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Poll a pairing code. Resolves pending → ok when the phone approves. */
export async function pollQr(code: string): Promise<QrPollResult> {
  const r = await fetch("/auth/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (r.status === 410) throw new Error("expired");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
  store.setAuth(false, true);
}
