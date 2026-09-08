import { handleView } from "./handler.ts";
import { signToken } from "../_shared/jwt.ts";
import { PARTICIPANT_ROLE } from "../_shared/participant.ts";

const URL = "https://project.supabase.co";
const SECRET = "jwt-secret";
const ORIGINAL_FETCH = globalThis.fetch;

const LINK = "11111111-1111-4111-8111-111111111111";

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

async function participantToken(claims: Record<string, string | number> = {}): Promise<string> {
  return signToken(SECRET, { sub: "pp-1", role: PARTICIPANT_ROLE, link: LINK, ...claims }, 3600);
}

function authed(url = `${URL}/participant-view`): Promise<Request> {
  return participantToken().then((token) =>
    new Request(url, { headers: { authorization: `Bearer ${token}` } })
  );
}

function stubRpc(rows: unknown, calls: Array<{ url: string; init: RequestInit }>): void {
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

Deno.test("view: a valid session returns only the participant's own view", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const row = { id: "pp-1", name: "Alice", has_drawn: true, target_name: "Bob" };
    stubRpc([row], calls);
    try {
      const res = await handleView(await authed());
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.participant.name === "Alice", "the participant views their own name");
      assert(data.participant.target_name === "Bob", "the participant sees their own target");
      assert(calls.length === 1 && calls[0].url.includes("rpc/participant_view"),
        "participant_view RPC is called");
      const sent = JSON.parse(String(calls[0].init.body)) as { p_link?: string };
      assert(sent.p_link === LINK, "the RPC is queried by the claim link");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("view: a session whose link no longer resolves is a 401 (revocation)", async () => {
  await withEnv(async () => {
    stubRpc([], []);
    try {
      const res = await handleView(await authed());
      assert(res.status === 401, `expected 401, got ${res.status}`);
      const data = await res.json();
      assert(data.error === "lien invalide", "the error names the invalid link");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("view: an expired participant session is a 401", async () => {
  await withEnv(async () => {
    const expired = await signToken(SECRET, { sub: "pp-1", role: PARTICIPANT_ROLE, link: LINK }, -10);
    const res = await handleView(
      new Request(`${URL}/participant-view`, {
        headers: { authorization: `Bearer ${expired}` },
      }),
    );
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("view: a missing token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleView(new Request(`${URL}/participant-view`));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("view: an admin token is not a participant session", async () => {
  await withEnv(async () => {
    const admin = await signToken(SECRET, { sub: "admin", role: "admin" }, 3600);
    const res = await handleView(
      new Request(`${URL}/participant-view`, {
        headers: { authorization: `Bearer ${admin}` },
      }),
    );
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("view: a session without a link claim is a 401", async () => {
  await withEnv(async () => {
    const token = await signToken(SECRET, { sub: "pp-1", role: PARTICIPANT_ROLE }, 3600);
    const res = await handleView(
      new Request(`${URL}/participant-view`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("view: an upstream failure is a 502", async () => {
  await withEnv(async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
    try {
      const res = await handleView(await authed());
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("view: missing config is a 500", async () => {
  await withEnv(async () => {
    Deno.env.set("SUPABASE_URL", "");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "");
    try {
      const res = await handleView(await authed());
      assert(res.status === 500, `expected 500, got ${res.status}`);
    } finally {
      Deno.env.set("SUPABASE_URL", URL);
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
    }
  });
});

Deno.test("view: non-GET is a 405", async () => {
  await withEnv(async () => {
    const token = await participantToken();
    const res = await handleView(
      new Request(`${URL}/participant-view`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });
});

Deno.test("view: preflight OPTIONS is allowed", async () => {
  await withEnv(async () => {
    const res = await handleView(new Request(`${URL}/participant-view`, { method: "OPTIONS" }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("view: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const res = await handleView(
        new Request(`${URL}/participant-view`, {
          headers: { authorization: `Bearer ${await participantToken()}`, origin: "https://evil.example" },
        }),
      );
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});