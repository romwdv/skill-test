import { handleResetGame } from "./handler.ts";
import { signToken } from "../_shared/jwt.ts";

const SECRET = "jwt-secret";
const URL = "https://project.supabase.co";
const ORIGINAL_FETCH = globalThis.fetch;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withEnv(fn: () => Promise<void>): Promise<void> {
  const keys = ["ADMIN_JWT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previously = keys.map((k) => [k, Deno.env.get(k)] as const);
  Deno.env.set("ADMIN_JWT_SECRET", SECRET);
  Deno.env.set("SUPABASE_URL", URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  try {
    return fn().finally(() => {
      for (const [k, v] of previously) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
    });
  } catch (e) {
    throw e;
  }
}

async function validToken(): Promise<string> {
  return signToken(SECRET, { sub: "admin", role: "admin" }, 3600);
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${URL}/admin-reset-game`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("reset: requires a session", async () => {
  await withEnv(async () => {
    const res = await handleResetGame(post({}));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("reset: invalid token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleResetGame(post({}, { authorization: "Bearer bad" }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("reset: calls the RPC and returns reset", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    try {
      const token = await validToken();
      const res = await handleResetGame(post({}, { authorization: `Bearer ${token}` }));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.reset === true, "returns reset");
      assert(
        calls.length === 1 && calls[0].url.includes("rpc/admin_reset_game"),
        "the reset RPC is called",
      );
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("reset: an RPC refusal surfaces the french message", async () => {
  await withEnv(async () => {
    const body = JSON.stringify({
      code: "PRST",
      message: "réinitialisation refusée",
      details: null,
    });
    globalThis.fetch = () => Promise.resolve(new Response(body, { status: 400 }));
    try {
      const token = await validToken();
      const res = await handleResetGame(post({}, { authorization: `Bearer ${token}` }));
      assert(res.status === 422, `expected 422, got ${res.status}`);
      const data = await res.json();
      assert(
        data.error === "réinitialisation refusée",
        "the RPC message is surfaced, not the raw JSON",
      );
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("reset: upstream network failure is a 502", async () => {
  await withEnv(async () => {
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    try {
      const token = await validToken();
      const res = await handleResetGame(post({}, { authorization: `Bearer ${token}` }));
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("reset: non-POST is a 405", async () => {
  await withEnv(async () => {
    const res = await handleResetGame(new Request(`${URL}/admin-reset-game`));
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });
});

Deno.test("reset: preflight is allowed", async () => {
  await withEnv(async () => {
    const res = await handleResetGame(new Request(`${URL}/admin-reset-game`, {
      method: "OPTIONS",
    }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("reset: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const token = await validToken();
      const res = await handleResetGame(post(
        {},
        { authorization: `Bearer ${token}`, origin: "https://evil.example" },
      ));
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});