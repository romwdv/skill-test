import { handleGameState } from "./handler.ts";
import { signToken } from "../_shared/jwt.ts";

const SECRET = "jwt-secret";
const STATE_URL = "https://project.supabase.co";
const ORIGINAL_FETCH = globalThis.fetch;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withEnv(fn: () => Promise<void>): Promise<void> {
  const keys = ["ADMIN_JWT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previously = keys.map((k) => [k, Deno.env.get(k)] as const);
  Deno.env.set("ADMIN_JWT_SECRET", SECRET);
  Deno.env.set("SUPABASE_URL", STATE_URL);
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

// Enregistre la réponse attendue par URL et capture les en-têtes envoyés.
function fakePostgrest(calls: Array<[string, Record<string, string>]>): void {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push([url, (init?.headers ?? {}) as Record<string, string>]);
    const body = url.includes("admin_game_state")
      ? { total: 4, drawn: 1, remaining: 3 }
      : url.includes("admin_attributions")
      ? [{ giver: "Alice", target: "Bob" }]
      : [
          { name: "Alice", has_drawn: true },
          { name: "Bob", has_drawn: false },
          { name: "Carol", has_drawn: false },
          { name: "Dave", has_drawn: false },
        ];
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

async function authed(url = `${STATE_URL}/admin-game-state`): Promise<Request> {
  return new Request(url, {
    headers: { authorization: `Bearer ${await validToken()}` },
  });
}

Deno.test("game-state: missing token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleGameState(new Request(`${STATE_URL}/admin-game-state`));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("game-state: invalid token is a 401", async () => {
  await withEnv(async () => {
    const res = await handleGameState(
      new Request(`${STATE_URL}/admin-game-state`, {
        headers: { authorization: "Bearer not-a-token" },
      }),
    );
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("game-state: expired token is a 401", async () => {
  await withEnv(async () => {
    const old = await signToken(SECRET, { sub: "admin", role: "admin" }, -3600);
    const res = await handleGameState(
      new Request(`${STATE_URL}/admin-game-state`, {
        headers: { authorization: `Bearer ${old}` },
      }),
    );
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("game-state: valid token returns state, players and attributions", async () => {
  await withEnv(async () => {
    const calls: Array<[string, Record<string, string>]> = [];
    fakePostgrest(calls);
    try {
      const res = await handleGameState(await authed());
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.state.total === 4 && data.state.drawn === 1 && data.state.remaining === 3,
        "state counters are mapped");
      assert(data.players.length === 4, "players are mapped");
      assert(data.players[0]?.name === "Alice", "players carry name + has_drawn");
      assert(data.attributions.length === 1 && data.attributions[0]?.target === "Bob",
        "attributions are mapped");

      assert(calls.length === 3, "three PostgREST requests are made");
      for (const [, headers] of calls) {
        assert(headers.apikey === "svc-key", "service role key is sent as apikey");
        assert(headers.authorization === "Bearer svc-key", "service role key is the bearer");
      }
      assert(calls.some(([u]) => u.includes("admin_game_state")), "state view queried");
      assert(calls.some(([u]) => u.includes("admin_player_status")), "players view queried");
      assert(calls.some(([u]) => u.includes("admin_attributions")), "attributions view queried");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("game-state: upstream failure is a 502", async () => {
  await withEnv(async () => {
    globalThis.fetch = () => Promise.resolve(new Response("boom", { status: 500 }));
    try {
      const res = await handleGameState(await authed());
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("game-state: preflight OPTIONS is allowed", async () => {
  await withEnv(async () => {
    const res = await handleGameState(new Request(`${STATE_URL}/admin-game-state`, {
      method: "OPTIONS",
    }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("game-state: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const res = await handleGameState(
        new Request(`${STATE_URL}/admin-game-state`, {
          headers: { authorization: `Bearer ${await validToken()}`, origin: "https://evil.example" },
        }),
      );
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});