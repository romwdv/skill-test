import {
  clearSession,
  decodeTokenPayload,
  isSessionExpired,
  loadSession,
  saveSession,
  sessionFromToken,
} from "./session";
import { fakeToken } from "../test/helpers";

describe("decodeTokenPayload", () => {
  it("decodes role and exp from a well-formed token", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = decodeTokenPayload(fakeToken(exp));
    expect(payload).not.toBeNull();
    expect(payload?.role).toBe("admin");
    expect(payload?.exp).toBe(exp);
  });

  it("returns null for malformed tokens", () => {
    expect(decodeTokenPayload("not-a-jwt")).toBeNull();
    expect(decodeTokenPayload("a.b")).toBeNull();
    expect(decodeTokenPayload("")).toBeNull();
  });
});

describe("sessionFromToken", () => {
  it("derives expiresAt (ms) from the exp claim", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const session = sessionFromToken(fakeToken(exp));
    expect(session?.expiresAt).toBe(exp * 1000);
    expect(session?.token).toBe(fakeToken(exp));
  });

  it("returns null when exp is missing", () => {
    const enc = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${enc({ alg: "HS256" })}.${enc({ role: "admin" })}.sig`;
    expect(sessionFromToken(token)).toBeNull();
  });
});

describe("isSessionExpired", () => {
  it("expires when expiresAt has passed", () => {
    expect(isSessionExpired({ token: "t", expiresAt: 999 }, 1000)).toBe(true);
    expect(isSessionExpired({ token: "t", expiresAt: 1000 }, 1000)).toBe(true);
    expect(isSessionExpired({ token: "t", expiresAt: 1001 }, 1000)).toBe(false);
  });
});

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a saved session", () => {
    const session = { token: "abc", expiresAt: Date.now() + 100_000 };
    saveSession(session);
    expect(loadSession()).toEqual(session);
  });

  it("drops and clears an expired stored session", () => {
    localStorage.setItem(
      "ss_admin_session",
      JSON.stringify({ token: "abc", expiresAt: Date.now() - 1000 }),
    );
    expect(loadSession()).toBeNull();
    expect(localStorage.getItem("ss_admin_session")).toBeNull();
  });

  it("ignores corrupted storage", () => {
    localStorage.setItem("ss_admin_session", "not json");
    expect(loadSession()).toBeNull();
  });

  it("clearSession removes the stored session", () => {
    saveSession({ token: "t", expiresAt: Date.now() + 1000 });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});