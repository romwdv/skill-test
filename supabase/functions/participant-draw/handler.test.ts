import { handleDraw } from "./handler.ts";
import { signToken } from "../_shared/jwt.ts";

const SECRET = "jwt-secret";
const URL = "https://project.supabase.co";
const LINK = "11111111-1111-4111-8111-111111111111";
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

async function participantToken(): Promise<string> {
  return signToken(SECRET, { sub: "p1", role: "participant", link: LINK }, 3600);
}

const DRAWN_VIEW = [{ id: "p1", name: "Alice", has_drawn: true, target_name: "Bob" }];
const UNDRAWN_VIEW = [{ id: "p1", name: "Alice", has_drawn: false, target_name: null }];

// Route chaque requête amont selon son endpoint : rpc/draw, rpc/participant_view.
function routingFetch(
  routes: {
    draw?: (input: RequestInfo | URL, init?: RequestInit) => Response;
    view?: (input: RequestInfo | URL, init?: RequestInit) => Response;
  },
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const url = String(input);
    if (url.includes("rpc/draw")) {
      if (!routes.draw) throw new Error("no route for draw");
      return Promise.resolve(routes.draw(input, init));
    }
    if (url.includes("rpc/participant_view")) {
      if (!routes.view) throw new Error("no route for view");
      return Promise.resolve(routes.view(input, init));
    }
    throw new Error(`unexpected upstream url: ${url}`);
  };
}

function post(headers: Record<string, string> = {}): Request {
  return new Request(`${URL}/participant-draw`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

Deno.test("draw: requires a session", async () => {
  await withEnv(async () => {
    const res = await handleDraw(post());
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("draw: an admin token is not a participant session", async () => {
  await withEnv(async () => {
    const token = await signToken(SECRET, { sub: "admin", role: "admin" }, 3600);
    const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("draw: a session without a link claim is a 401", async () => {
  await withEnv(async () => {
    const token = await signToken(SECRET, { sub: "p1", role: "participant" }, 3600);
    const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });
});

Deno.test("draw: calls draw with the session link and returns the refreshed view", async () => {
  await withEnv(async () => {
    const calls: string[] = [];
    globalThis.fetch = routingFetch({
      draw: () => {
        calls.push("draw");
        return new Response(JSON.stringify([{ giver_id: "p1", target_id: "p2" }]), {
          status: 200,
        });
      },
      view: () => {
        calls.push("view");
        return new Response(JSON.stringify(DRAWN_VIEW), { status: 200 });
      },
    });
    try {
      const token = await participantToken();
      const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(
        data.participant?.has_drawn === true && data.participant?.target_name === "Bob",
        "the refreshed view shows who the participant gifts to",
      );
      assert(calls.length === 2 && calls[0] === "draw" && calls[1] === "view",
        "draw is called then the view is refreshed");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("draw: the link sent to the RPC is the session claim, never client input", async () => {
  await withEnv(async () => {
    let sent: undefined | { p_link?: string };
    globalThis.fetch = routingFetch({
      draw: (_input: RequestInfo | URL, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body)) as { p_link?: string };
        return new Response("[]", { status: 200 });
      },
      view: () => new Response(JSON.stringify(DRAWN_VIEW), { status: 200 }),
    });
    try {
      const token = await participantToken();
      const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(sent?.p_link === LINK, "the RPC receives the session link");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("draw: an already-drawn participant is answered with their current view", async () => {
  await withEnv(async () => {
    globalThis.fetch = routingFetch({
      draw: () => {
        const body = JSON.stringify({ code: "PDRAW", message: "déjà tiré", details: null });
        return new Response(body, { status: 400 });
      },
      view: () => new Response(JSON.stringify(DRAWN_VIEW), { status: 200 }),
    });
    try {
      const token = await participantToken();
      const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.participant?.target_name === "Bob", "the current view is returned");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("draw: an impasse (PNONE) surfaces the french message", async () => {
  await withEnv(async () => {
    const body = JSON.stringify({
      code: "PNONE",
      message: "aucune cible valide",
      details: null,
    });
    globalThis.fetch = routingFetch({
      draw: () => new Response(body, { status: 400 }),
      view: () => new Response(JSON.stringify(UNDRAWN_VIEW), { status: 200 }),
    });
    try {
      const token = await participantToken();
      const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
      assert(res.status === 422, `expected 422, got ${res.status}`);
      const data = await res.json();
      assert(
        data.error === "aucune cible valide",
        "the RPC message is surfaced, not the raw JSON",
      );
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("draw: an obsolete link is a 401 revocation, like participant-view", async () => {
  await withEnv(async () => {
    let views = 0;
    const body = JSON.stringify({ code: "PLINK", message: "lien inconnu" });
    globalThis.fetch = routingFetch({
      draw: () => new Response(body, { status: 400 }),
      view: () => {
        views++;
        return new Response(JSON.stringify(DRAWN_VIEW), { status: 200 });
      },
    });
    try {
      const token = await participantToken();
      const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
      assert(res.status === 401, `expected 401, got ${res.status}`);
      const data = await res.json();
      assert(data.error === "lien invalide", "the revocation error is surfaced");
      assert(views === 0, "the view is not fetched after a revocation");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("draw: upstream network failure is a 502", async () => {
  await withEnv(async () => {
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    try {
      const token = await participantToken();
      const res = await handleDraw(post({ authorization: `Bearer ${token}` }));
      assert(res.status === 502, `expected 502, got ${res.status}`);
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

Deno.test("draw: non-POST is a 405", async () => {
  await withEnv(async () => {
    const res = await handleDraw(new Request(`${URL}/participant-draw`));
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });
});

Deno.test("draw: preflight is allowed", async () => {
  await withEnv(async () => {
    const res = await handleDraw(new Request(`${URL}/participant-draw`, {
      method: "OPTIONS",
    }));
    assert(res.status === 204, `expected 204, got ${res.status}`);
  });
});

Deno.test("draw: a foreign origin is rejected when ALLOWED_ORIGIN is set", async () => {
  await withEnv(async () => {
    Deno.env.set("ALLOWED_ORIGIN", "https://bon-papa.example");
    try {
      const token = await participantToken();
      const res = await handleDraw(post({
        authorization: `Bearer ${token}`,
        origin: "https://evil.example",
      }));
      assert(res.status === 403, `expected 403 for foreign origin, got ${res.status}`);
    } finally {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  });
});