import { handleForceDraw } from "./handler.ts";
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
  return new Request("https://project.supabase.co/admin-force-draw", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("force-draw: requires a session", async () => {
  await withEnv(async () => {
    const res = await handleForceDraw(post({ giver_id: "g", target_id: "t" }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("force-draw: invalid token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleForceDraw(post({ giver_id: "g", target_id: "t" }, {
      authorization: "Bearer bad",
    }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("force-draw: calls the RPC and returns the attribution", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const attribution = { giver_id: "g-a", target_id: "t-b" };
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify(attribution), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    try {
      const token = await validToken();
      const res = await handleForceDraw(post(
        { giver_id: "g-a", target_id: "t-b" },
        { authorization: `Bearer ${token}` },
      ));
      assert(res.status === 201, `expected 201, got ${res.status}`);
      const data = await res.json();
      assert(data.attribution.giver_id === "g-a", "the attribution is returned");
      assert(calls.length === 1 && calls[0].url.includes("rpc/admin_force_attribution"),
        "the force RPC is called");
      const sent = JSON.parse(String(calls[0].init.body)) as { p_giver_id?: string; p_target_id?: string };
      assert(sent.p_giver_id === "g-a" && sent.p_target_id === "t-b",
        "giver and target are sent as RPC args");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("force-draw: missing giver or target is a 400", async () => {
  await withEnv(async () => {
    const token = await validToken();
    const res = await handleForceDraw(post({ giver_id: "g" }, {
      authorization: `Bearer ${token}`,
    }));
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });
});

Deno.test("force-draw: upstream failure is a 502", async () => {
  await withEnv(async () => {
    globalThis.fetch = () => Promise.resolve(new Response("boom", { status: 500 }));
    try {
      const token = await validToken();
      const res = await handleForceDraw(post(
        { giver_id: "g", target_id: "t" },
        { authorization: `Bearer ${token}` },
      ));
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("force-draw: non-POST is a 405", async () => {
  await withEnv(async () => {
    const res = await handleForceDraw(new Request(`${URL}/admin-force-draw`));
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });
});

Deno.test("force-draw: preflight is allowed", async () => {
  await withEnv(async () => {
    const res = await handleForceDraw(new Request(`${URL}/admin-force-draw`, {
      method: "OPTIONS",
    }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("force-draw: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const token = await validToken();
      const res = await handleForceDraw(post(
        { giver_id: "g", target_id: "t" },
        { authorization: `Bearer ${token}`, origin: "https://evil.example" },
      ));
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});
