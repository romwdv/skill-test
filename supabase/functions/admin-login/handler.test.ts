import { handleLogin, SESSION_TTL_SECONDS } from "./handler.ts";
import { verifyToken } from "../_shared/jwt.ts";

const PASSWORD = "secret-admin";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withEnv(fn: () => Promise<void>): Promise<void> {
  const hadPassword = Deno.env.get("ADMIN_PASSWORD");
  const hadSecret = Deno.env.get("ADMIN_JWT_SECRET");
  Deno.env.set("ADMIN_PASSWORD", PASSWORD);
  Deno.env.set("ADMIN_JWT_SECRET", "jwt-secret");
  try {
    return fn().finally(() => {
      if (hadPassword === undefined) Deno.env.delete("ADMIN_PASSWORD");
      else Deno.env.set("ADMIN_PASSWORD", hadPassword);
      if (hadSecret === undefined) Deno.env.delete("ADMIN_JWT_SECRET");
      else Deno.env.set("ADMIN_JWT_SECRET", hadSecret);
    });
  } catch (e) {
    throw e;
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/admin-login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("login: correct password yields an admin session token", async () => {
  await withEnv(async () => {
    const res = await handleLogin(post({ password: PASSWORD }));
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    const claims = await verifyToken("jwt-secret", data.token);
    assert(claims.sub === "admin", "sub is admin");
    assert(claims.role === "admin", "role is admin");
    assert(claims.exp! > Math.floor(Date.now() / 1000), "session not yet expired");
    assert(
      claims.exp! - claims.iat! >= SESSION_TTL_SECONDS - 5 &&
        claims.exp! - claims.iat! <= SESSION_TTL_SECONDS + 5,
      "session lifetime is 12 hours",
    );
  });
});

Deno.test("login: wrong password is rejected with 401", async () => {
  await withEnv(async () => {
    const res = await handleLogin(post({ password: "wrong" }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("login: no password in body is a 400", async () => {
  await withEnv(async () => {
    const res = await handleLogin(post({}));
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const empty = await handleLogin(post("not-json"));
    assert(empty.status === 400, `expected 400 for non-json, got ${empty.status}`);
  });
});

Deno.test("login: missing ADMIN_PASSWORD env is a 500", async () => {
  Deno.env.delete("ADMIN_PASSWORD");
  Deno.env.set("ADMIN_JWT_SECRET", "jwt-secret");
  try {
    const res = await handleLogin(post({ password: PASSWORD }));
    assert(res.status === 500, `expected 500, got ${res.status}`);
  } finally {
    Deno.env.set("ADMIN_PASSWORD", PASSWORD);
  }
});

Deno.test("login: preflight OPTIONS is allowed", async () => {
  await withEnv(async () => {
    const req = new Request("https://example.com/admin-login", { method: "OPTIONS" });
    const res = await handleLogin(req);
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("login: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const evil = await handleLogin(post({ password: PASSWORD }, {
        origin: "https://evil.example",
      }));
      assert(evil.status === 403, `expected 403 for foreign origin, got ${evil.status}`);
      const trusted = await handleLogin(post({ password: PASSWORD }, {
        origin: "https://bon-papa.example",
      }));
      assert(trusted.status === 200, `expected 200 for allowed origin, got ${trusted.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});