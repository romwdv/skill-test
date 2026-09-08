import {
  adminLogin,
  fetchGameState,
  ApiError,
  functionUrl,
  fetchParticipants,
  addParticipant,
  deleteParticipant,
  regenerateParticipantLink,
} from "./api";
import { fakeToken } from "../test/helpers";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ORIGINAL_FETCH = globalThis.fetch;
const SUPABASE_URL = "https://project.supabase.co";

beforeAll(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  vi.stubEnv("VITE_SUPABASE_URL", SUPABASE_URL);
});

afterAll(() => {
  delete process.env.VITE_SUPABASE_URL;
  vi.unstubAllEnvs();
});

function stubFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

describe("functionUrl", () => {
  it("appends the function path onto the Supabase URL", () => {
    expect(functionUrl("admin-login")).toBe(`${SUPABASE_URL}/functions/v1/admin-login`);
  });
});

describe("adminLogin", () => {
  it("posts the password and returns a session derived from the token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = fakeToken(exp);
    const fetchMock = vi.fn(async () => jsonResponse({ token }));
    stubFetch(fetchMock as unknown as typeof fetch);
    try {
      const session = await adminLogin("p4ss");
      expect(session.token).toBe(token);
      expect(session.expiresAt).toBe(exp * 1000);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain("/functions/v1/admin-login");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ password: "p4ss" });
    } finally {
      restoreFetch();
    }
  });

  it("throws a 401 ApiError with the server message on bad password", async () => {
    stubFetch(async () => jsonResponse({ error: "mot de passe invalide" }, 401));
    try {
      await expect(adminLogin("nope")).rejects.toSatisfy(
        (err: unknown) => err instanceof ApiError && err.status === 401,
      );
    } finally {
      restoreFetch();
    }
  });
});

describe("fetchGameState", () => {
  it("sends the session as a bearer token and returns the state", async () => {
    const expected = {
      state: { total: 4, drawn: 1, remaining: 3 },
      players: [
        { name: "Alice", has_drawn: true },
        { name: "Bob", has_drawn: false },
      ],
    };
    const fetchMock = vi.fn(async () => jsonResponse(expected));
    stubFetch(fetchMock as unknown as typeof fetch);
    try {
      const state = await fetchGameState({ token: "tok", expiresAt: 1e12 });
      expect(state).toEqual(expected);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain("/functions/v1/admin-game-state");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    } finally {
      restoreFetch();
    }
  });

  it("throws a 401 ApiError when the server rejects the session", async () => {
    stubFetch(async () => jsonResponse({ error: "session invalide" }, 401));
    try {
      await expect(fetchGameState({ token: "bad", expiresAt: 1e12 })).rejects.toSatisfy(
        (err: unknown) => err instanceof ApiError && err.status === 401,
      );
    } finally {
      restoreFetch();
    }
  });

  it("propagates network failures", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });
    try {
      await expect(fetchGameState({ token: "t", expiresAt: 1e12 })).rejects.toThrow(
        "network down",
      );
    } finally {
      restoreFetch();
    }
  });
});

const SESSION = { token: "tok", expiresAt: 1e12 };
const ALICE = {
  id: "p1",
  name: "Alice",
  link: "11111111-1111-4111-8111-111111111111",
  has_drawn: false,
};

describe("fetchParticipants", () => {
  it("GETs the participants and returns them with their links", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ participants: [ALICE] }));
    stubFetch(fetchMock as unknown as typeof fetch);
    try {
      const participants = await fetchParticipants(SESSION);
      expect(participants).toHaveLength(1);
      expect(participants[0].link).toBe(ALICE.link);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain("/functions/v1/admin-participants");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    } finally {
      restoreFetch();
    }
  });

  it("throws a 401 ApiError when the session is rejected", async () => {
    stubFetch(async () => jsonResponse({ error: "session invalide" }, 401));
    try {
      await expect(fetchParticipants(SESSION)).rejects.toSatisfy(
        (err: unknown) => err instanceof ApiError && err.status === 401,
      );
    } finally {
      restoreFetch();
    }
  });
});

describe("addParticipant", () => {
  it("POSTs an add action and returns the created participant", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ participant: ALICE }, 201));
    stubFetch(fetchMock as unknown as typeof fetch);
    try {
      const created = await addParticipant(SESSION, "Alice");
      expect(created.name).toBe("Alice");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain("/functions/v1/admin-participants");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ action: "add", name: "Alice" });
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    } finally {
      restoreFetch();
    }
  });

  it("propagates a 400 ApiError when the name is missing", async () => {
    stubFetch(async () => jsonResponse({ error: "nom requis" }, 400));
    try {
      await expect(addParticipant(SESSION, "")).rejects.toSatisfy(
        (err: unknown) => err instanceof ApiError && err.status === 400,
      );
    } finally {
      restoreFetch();
    }
  });
});

describe("deleteParticipant", () => {
  it("POSTs a delete action with the id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ deleted: true }));
    stubFetch(fetchMock as unknown as typeof fetch);
    try {
      await expect(deleteParticipant(SESSION, "p1")).resolves.toBeUndefined();
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ action: "delete", id: "p1" });
    } finally {
      restoreFetch();
    }
  });
});

describe("regenerateParticipantLink", () => {
  it("POSTs a regenerate action and returns the renewed participant", async () => {
    const renewed = { ...ALICE, link: "99999999-9999-4999-8999-999999999999" };
    const fetchMock = vi.fn(async () => jsonResponse({ participant: renewed }));
    stubFetch(fetchMock as unknown as typeof fetch);
    try {
      const result = await regenerateParticipantLink(SESSION, "p1");
      expect(result.link).toBe(renewed.link);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ action: "regenerate", id: "p1" });
    } finally {
      restoreFetch();
    }
  });
});