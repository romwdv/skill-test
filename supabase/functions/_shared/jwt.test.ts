import { signToken, verifyToken, base64urlEncode } from "./jwt.ts";

const SECRET = "test-secret";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function expectRejects(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error(`FAIL: ${label}: expected rejection, but it resolved`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FAIL: ")) throw e;
  }
}

Deno.test("round-trip: sign then verify returns the claims", async () => {
  const t = await signToken(SECRET, { sub: "admin", role: "admin" }, 3600);
  const claims = await verifyToken(SECRET, t);
  assert(claims.sub === "admin", "sub claim");
  assert(claims.role === "admin", "role claim");
  assert(typeof claims.iat === "number", "iat");
  assert(typeof claims.exp === "number", "exp");
  assert(claims.exp! > claims.iat!, "exp after iat");
});

Deno.test("verify rejects a token signed with another secret", async () => {
  const t = await signToken("other-secret", { sub: "admin" }, 3600);
  await expectRejects("wrong secret", () => verifyToken(SECRET, t));
});

Deno.test("verify rejects an expired token", async () => {
  const t = await signToken(SECRET, { sub: "admin" }, -3600);
  await expectRejects("expired", () => verifyToken(SECRET, t));
});

Deno.test("verify rejects a zero-ttl token (exp = now)", async () => {
  const t = await signToken(SECRET, { sub: "admin" }, 0);
  await expectRejects("zero ttl", () => verifyToken(SECRET, t));
});

Deno.test("verify rejects a tampered payload", async () => {
  const t = await signToken(SECRET, { sub: "admin" }, 3600);
  const [h, , s] = t.split(".");
  const forged = base64urlEncode(new TextEncoder().encode(
    JSON.stringify({ sub: "mallory", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ));
  await expectRejects("tampered payload", () => verifyToken(SECRET, `${h}.${forged}.${s}`));
});

Deno.test("verify rejects malformed tokens", async () => {
  await expectRejects("not a token", () => verifyToken(SECRET, "not-a-token"));
  await expectRejects("two parts", () => verifyToken(SECRET, "a.b"));
  await expectRejects("empty", () => verifyToken(SECRET, ""));
});