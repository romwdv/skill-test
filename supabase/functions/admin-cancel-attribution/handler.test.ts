import { handleCancelAttribution } from "./handler.ts";
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
  return new Request("https://project.supabase.co/admin-cancel-attribution", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("cancel-attribution: requires a session", async () => {
  await withEnv(async () => {
    const res = await handleCancelAttribution(post({ giver_id: "g" }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("cancel-attribution: invalid token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleCancelAttribution(post({ giver_id: "g" }, {
      authorization: "Bearer bad",
    }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("cancel-attribution: calls the RPC and returns cancelled", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    try {
      const token = await validToken();
      const res = await handleCancelAttribution(post(
        { giver_id: "g-a" },
        { authorization: `Bearer ${token}` },
      ));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.cancelled === true, "returns cancelled");
      assert(calls.length === 1 && calls[0].url.includes("rpc/admin_cancel_attribution"),
        "the cancel RPC is called");
      const sent = JSON.parse(String(calls[0].init.body)) as { p_giver_id?: string };
      assert(sent.p_giver_id === "g-a", "the giver is sent as RPC arg");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("cancel-attribution: missing giver is a 400", async () => {
  await withEnv(async () => {
    const token = await validToken();
    const res = await handleCancelAttribution(post({}, {
      authorization: `Bearer ${token}`,
    }));
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });
});

Deno.test("cancel-attribution: an RPC refusal surfaces the french message", async () => {
  await withEnv(async () => {
    const body = JSON.stringify({
      code: "PSOLZ",
      message: "l'annulation rendrait la partie insolvable",
      details: null,
    });
    globalThis.fetch = () => Promise.resolve(new Response(body, { status: 400 }));
    try {
      const token = await validToken();
      const res = await handleCancelAttribution(post(
        { giver_id: "g" },
        { authorization: `Bearer ${token}` },
      ));
      assert(res.status === 422, `expected 422, got ${res.status}`);
      const data = await res.json();
      assert(
        data.error === "l'annulation rendrait la partie insolvable",
        "the RPC message is surfaced, not the raw JSON",
      );
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("cancel-attribution: upstream network failure is a 502", async () => {
  await withEnv(async () => {
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    try {
      const token = await validToken();
      const res = await handleCancelAttribution(post(
        { giver_id: "g" },
        { authorization: `Bearer ${token}` },
      ));
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("cancel-attribution: non-POST is a 405", async () => {
  await withEnv(async () => {
    const res = await handleCancelAttribution(new Request(`${URL}/admin-cancel-attribution`));
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });
});

Deno.test("cancel-attribution: preflight is allowed", async () => {
  await withEnv(async () => {
    const res = await handleCancelAttribution(new Request(`${URL}/admin-cancel-attribution`, {
      method: "OPTIONS",
    }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("cancel-attribution: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const token = await validToken();
      const res = await handleCancelAttribution(post(
        { giver_id: "g" },
        { authorization: `Bearer ${token}`, origin: "https://evil.example" },
      ));
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});