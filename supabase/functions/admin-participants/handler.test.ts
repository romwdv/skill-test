import { handleParticipants } from "./handler.ts";
import { signToken } from "../_shared/jwt.ts";
import { isPreflight, optionsResponse } from "../_shared/http.ts";

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

function authed(url = `${URL}/admin-participants`): Promise<Request> {
  return validToken().then((token) =>
    new Request(url, { headers: { authorization: `Bearer ${token}` } })
  );
}

// Stub fetch : répond par fonction RPC / vue et enregistre les appels.
function makeListener(
  routes: Record<string, { status: number; body: unknown }>,
  calls: Array<{ url: string; init: RequestInit }>,
): void {
  globalThis.fetch = (input: RequestInfo | URL, requestInit?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: requestInit ?? {} });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const hit = key ? routes[key] : { status: 404, body: { error: "not found" } };
    const init: ResponseInit = { status: hit.status };
    const body = hit.status === 204 || hit.body == null ? null : JSON.stringify(hit.body);
    if (body == null) {
      return Promise.resolve(new Response(null, init));
    }
    return Promise.resolve(
      new Response(body, { ...init, headers: { "content-type": "application/json" } }),
    );
  };
}

function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

Deno.test("participants: missing token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleParticipants(new Request(`${URL}/admin-participants`));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("participants: invalid token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleParticipants(
      new Request(`${URL}/admin-participants`, {
        headers: { authorization: "Bearer not-a-token" },
      }),
    );
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("participants: GET lists participants with links", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rows = [
      { id: "a", name: "Alice", link: "11111111-1111-4111-8111-111111111111", has_drawn: true },
      { id: "b", name: "Bob", link: "22222222-2222-4222-8222-222222222222", has_drawn: false },
    ];
    makeListener({
      admin_participants: { status: 200, body: rows },
      admin_couples: { status: 200, body: [] },
    }, calls);
    try {
      const res = await handleParticipants(await authed());
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.participants.length === 2, "participants are mapped");
      assert(
        data.participants[0].link === "11111111-1111-4111-8111-111111111111",
        "the admin sees the private links",
      );
      assert(calls.some((c) => c.url.includes("admin_participants")),
        "the admin_participants view is queried");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: GET upstream failure is a 502", async () => {
  await withEnv(async () => {
    makeListener({ admin_participants: { status: 500, body: { error: "boom" } } }, []);
    try {
      const res = await handleParticipants(await authed());
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: add calls the RPC with the name and returns 201", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const created = { id: "c", name: "Carol", link: "33333333-3333-4333-8333-333333333333" };
    makeListener({ admin_add_participant: { status: 200, body: created } }, calls);
    try {
      const token = await validToken();
      const res = await handleParticipants(
        new Request(`${URL}/admin-participants`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "add", name: "  Carol  " }),
        }),
      );
      assert(res.status === 201, `expected 201, got ${res.status}`);
      const data = await res.json();
      assert(data.participant.name === "Carol", "the created participant is returned");
      assert(calls.length === 1 && calls[0].url.includes("rpc/admin_add_participant"),
        "admin_add_participant RPC is called");
      const sent = JSON.parse(String(calls[0].init.body)) as { p_name?: string };
      assert(sent.p_name === "Carol", "the name is trimmed before being sent");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: add with a blank name is a 400", async () => {
  await withEnv(async () => {
    const res = await handleParticipants(
      new Request(`${URL}/admin-participants`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await validToken()}` },
        body: JSON.stringify({ action: "add", name: "   " }),
      }),
    );
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });
});

Deno.test("participants: delete calls the RPC with the id", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    makeListener({ admin_delete_participant: { status: 204, body: null } }, calls);
    try {
      const res = await handleParticipants(
        new Request(`${URL}/admin-participants`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${await validToken()}` },
          body: JSON.stringify({ action: "delete", id: "some-id" }),
        }),
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(calls.length === 1 && calls[0].url.includes("rpc/admin_delete_participant")
        && JSON.parse(String(calls[0].init.body)).p_id === "some-id",
        "admin_delete_participant RPC is called with the id");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: regenerate returns the new link", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const renewed = { id: "a", name: "Alice", link: "99999999-9999-4999-8999-999999999999" };
    makeListener({ admin_regenerate_participant_link: { status: 200, body: renewed } }, calls);
    try {
      const res = await handleParticipants(
        new Request(`${URL}/admin-participants`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${await validToken()}` },
          body: JSON.stringify({ action: "regenerate", id: "some-id" }),
        }),
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.participant.link === "99999999-9999-4999-8999-999999999999",
        "the renewed participant is returned");
      assert(calls.length === 1 && calls[0].url.includes("rpc/admin_regenerate_participant_link"),
        "admin_regenerate_participant_link RPC is called");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: regenerate on unknown id is a 404", async () => {
  await withEnv(async () => {
    makeListener({ admin_regenerate_participant_link: { status: 200, body: null } }, []);
    try {
      const res = await handleParticipants(
        new Request(`${URL}/admin-participants`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${await validToken()}` },
          body: JSON.stringify({ action: "regenerate", id: "missing" }),
        }),
      );
      assert(res.status === 404, `expected 404, got ${res.status}`);
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: unknown action is a 400", async () => {
  await withEnv(async () => {
    const res = await handleParticipants(
      new Request(`${URL}/admin-participants`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await validToken()}` },
        body: JSON.stringify({ action: "nope" }),
      }),
    );
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });
});

Deno.test("participants: GET includes the couples", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rows = [
      { id: "a", name: "Alice", link: "11111111-1111-4111-8111-111111111111", has_drawn: false },
    ];
    const couples = [
      { participant_a_id: "a", participant_b_id: "b", a_name: "Alice", b_name: "Bob" },
    ];
    makeListener({
      admin_participants: { status: 200, body: rows },
      admin_couples: { status: 200, body: couples },
    }, calls);
    try {
      const res = await handleParticipants(await authed());
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.participants.length === 1, "participants are mapped");
      assert(data.couples.length === 1 && data.couples[0].a_name === "Alice",
        "the couples are mapped");
      assert(calls.some((c) => c.url.includes("admin_couples")),
        "the admin_couples view is queried");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: couple.add calls the RPC and returns 201", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    makeListener({ admin_add_couple: { status: 204, body: null } }, calls);
    try {
      const token = await validToken();
      const res = await handleParticipants(
        new Request(`${URL}/admin-participants`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "couple.add", a: "a", b: "b" }),
        }),
      );
      assert(res.status === 201, `expected 201, got ${res.status}`);
      assert(calls.length === 1 && calls[0].url.includes("rpc/admin_add_couple")
        && JSON.parse(String(calls[0].init.body)).p_a === "a"
        && JSON.parse(String(calls[0].init.body)).p_b === "b",
        "admin_add_couple RPC is called with both ids");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: couple.add with a missing id is a 400", async () => {
  await withEnv(async () => {
    const res = await handleParticipants(
      new Request(`${URL}/admin-participants`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await validToken()}` },
        body: JSON.stringify({ action: "couple.add", a: "a" }),
      }),
    );
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });
});

Deno.test("participants: couple.delete calls the RPC and returns 200", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    makeListener({ admin_delete_couple: { status: 204, body: null } }, calls);
    try {
      const token = await validToken();
      const res = await handleParticipants(
        new Request(`${URL}/admin-participants`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "couple.delete", a: "a", b: "b" }),
        }),
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(calls.length === 1 && calls[0].url.includes("rpc/admin_delete_couple"),
        "admin_delete_couple RPC is called");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("participants: non-POST/GET method is a 405", async () => {
  await withEnv(async () => {
    const res = await handleParticipants(
      new Request(`${URL}/admin-participants`, {
        method: "PUT",
        headers: { authorization: `Bearer ${await validToken()}` },
      }),
    );
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });
});

Deno.test("participants: preflight OPTIONS is allowed", async () => {
  await withEnv(async () => {
    const res = await handleParticipants(new Request(`${URL}/admin-participants`, {
      method: "OPTIONS",
    }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("participants: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const res = await handleParticipants(
        new Request(`${URL}/admin-participants`, {
          headers: { authorization: `Bearer ${await validToken()}`, origin: "https://evil.example" },
        }),
      );
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});