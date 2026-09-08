export const ADMIN_SESSION_KEY = "ss_admin_session";
export const PARTICIPANT_SESSION_KEY = "ss_participant_session";

export interface Session {
  token: string;
  expiresAt: number;
}

export interface TokenPayload {
  exp?: number;
  role?: string;
  [claim: string]: string | number | undefined;
}

export function decodeTokenPayload(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === "object" && parsed !== null ? (parsed as TokenPayload) : null;
  } catch {
    return null;
  }
}

export function sessionFromToken(token: string): Session | null {
  const payload = decodeTokenPayload(token);
  if (!payload || typeof payload.exp !== "number") return null;
  return { token, expiresAt: payload.exp * 1000 };
}

export function isSessionExpired(session: Session, now = Date.now()): boolean {
  return session.expiresAt <= now;
}

export function loadSession(key = ADMIN_SESSION_KEY): Session | null {
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    const session = parsed as Partial<Session>;
    if (
      typeof session?.token !== "string" ||
      typeof session?.expiresAt !== "number" ||
      isSessionExpired(session as Session)
    ) {
      localStorage.removeItem(key);
      return null;
    }
    return session as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session, key = ADMIN_SESSION_KEY): void {
  localStorage.setItem(key, JSON.stringify(session));
}

export function clearSession(key = ADMIN_SESSION_KEY): void {
  localStorage.removeItem(key);
}