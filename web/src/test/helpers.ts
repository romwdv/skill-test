export function fakeToken(exp: number): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ role: "admin", exp })}.signature`;
}

export const GAME_STATE = {
  state: { total: 4, drawn: 1, remaining: 3 },
  players: [
    { id: "ids-alice", name: "Alice", has_drawn: true },
    { id: "ids-bob", name: "Bob", has_drawn: false },
    { id: "ids-carol", name: "Carol", has_drawn: false },
    { id: "ids-dave", name: "Dave", has_drawn: false },
  ],
  attributions: [{ giver: "Alice", target: "Bob" }],
};