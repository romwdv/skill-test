// Session admin (ticket #2) : un JWT HS256 signé avec un secret (ADMIN_JWT_SECRET),
// porteur d'une expiration (exp). 100 % Web Crypto — exécutable dans Deno (Edge
// Functions) comme dans tout runtime pourvu de crypto.subtle. Aucune dépendance.

export interface TokenClaims {
  sub?: string;
  role?: string;
  iat?: number;
  exp?: number;
  [claim: string]: string | number | boolean | undefined;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const HMAC_ALG: HmacImportParams = {
  name: "HMAC",
  hash: "SHA-256",
};

export function base64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(b64 + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a[i % Math.max(a.length, 1)] ?? 0) ^ (b[i % Math.max(b.length, 1)] ?? 0);
  }
  return diff === 0 && a.length === b.length;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), HMAC_ALG, false, ["sign"]);
}

export async function signToken(
  secret: string,
  claims: Record<string, string | number | boolean>,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64urlEncode(enc.encode(
    JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }),
  ));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64urlEncode(new Uint8Array(signature))}`;
}

export async function verifyToken(secret: string, token: string): Promise<TokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new Error("token malformé");
  }
  const [header, payload, signature] = parts;

  const key = await importKey(secret);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`)),
  );
  if (!constantTimeEqual(expected, base64urlDecode(signature))) {
    throw new Error("signature invalide");
  }

  let claims: TokenClaims;
  try {
    const parsed = JSON.parse(dec.decode(base64urlDecode(payload)));
    if (typeof parsed !== "object" || parsed === null) throw new Error();
    claims = parsed as TokenClaims;
  } catch {
    throw new Error("payload invalide");
  }

  if (typeof claims.exp !== "number" || Number.isNaN(claims.exp)) {
    throw new Error("expiration manquante");
  }
  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("session expirée");
  }
  return claims;
}

// Comparaison à temps constant pour le mot de passe : les deux entrées sont
// passées par un HMAC de longueur fixe avant comparaison, donc ni le contenu ni
// la longueur ne s'échappent via le timing.
export async function constantTimeStringEqual(a: string, b: string): Promise<boolean> {
  return constantTimeEqual(await hmacSha256(a, "challenge"), await hmacSha256(b, "challenge"));
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}