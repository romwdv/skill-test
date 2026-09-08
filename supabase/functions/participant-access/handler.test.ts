import { handleAccess, SESSION_TTL_SECONDS } from "./handler.ts";
import { verifyToken } from "../_shared/jwt.ts";
import { PARTICIPANT_ROLE } from "../_shared/participant.ts";

const URL = "https://project.supabase.co";
const ORIGINAL_FETCH = globalThis.fetch;

const LINK = "11111111-1111-4111-8111-111111111111";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withEnv(fn: () => Promise<void>): Promise<void> {
  const keys = ["ADMIN_JWT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previously = keys.map((k) => [k, Deno.env.get(k)] as const);
  Deno.env.set("ADMIN_JWT_SECRET", "jwt-secret");
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

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${URL}/participant-access`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function stubSelect(rows: unknown[], calls: Array<{ url: string; init: RequestInit }>): void {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

Deno.test("access: a known link yields a participant session token", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    stubSelect([{ id: "pp-1" }], calls);
    try {
      const res = await handleAccess(post({ link: LINK }));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      const claims = await verifyToken("jwt-secret", data.token);
      assert(claims.sub === "pp-1", "sub is the participant id");
      assert(claims.role === PARTICIPANT_ROLE, "role is participant");
      assert(claims.link === LINK, "the link claim carries the private link");
      assert(
        claims.exp! - claims.iat! >= SESSION_TTL_SECONDS - 5 &&
          claims.exp! - claims.iat! <= SESSION_TTL_SECONDS + 5,
        "session lifetime is 90 days",
      );
      assert(calls.length === 1 && calls[0].url.includes(`link=eq.${LINK}`),
        "the participants table is queried by link under the service role");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("access: an unknown link is a 401 (regenerated links are revoked)", async () => {
  await withEnv(async () => {
    stubSelect([], []);
    try {
      const res = await handleAccess(post({ link: LINK }));
      assert(res.status === 401, `expected 401, got ${res.status}`);
      const data = await res.json();
      assert(data.error === "lien inconnu", "the error names the unknown link");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("access: a malformed link is a 400", async () => {
  await withEnv(async () => {
    const res = await handleAccess(post({ link: "123" }));
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });
});

Deno.test("access: a missing link is a 400", async () => {
  await withEnv(async () => {
    const res = await handleAccess(post({}));
    assert(res.status === 400, `expected 400 for no body, got ${res.status}`);
    const empty = await handleAccess(post("not-json"));
    assert(empty.status === 400, `expected 400 for non-json, got ${empty.status}`);
  });
});

Deno.test("access: missing config is a 500", async () => {
  Deno.env.delete("ADMIN_JWT_SECRET");
  Deno.env.set("SUPABASE_URL", URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  try {
    const res = await handleAccess(post({ link: LINK }));
    assert(res.status === 500, `expected 500, got ${res.status}`);
  } finally {
    Deno.env.set("ADMIN_JWT_SECRET", "jwt-secret");
  }
});

Deno.test("access: an upstream failure is a 502", async () => {
  await withEnv(async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
    try {
      const res = await handleAccess(post({ link: LINK }));
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("access: preflight OPTIONS is allowed", async () => {
  await withEnv(async () => {
    const res = await handleAccess(new Request(`${URL}/participant-access`, {
      method: "OPTIONS",
    }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("access: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const res = await handleAccess(post({ link: LINK }, { origin: "https://evil.example" }));
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});