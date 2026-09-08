export function fakeToken(exp: number, claims: Record<string, unknown> = {}): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ role: "admin", exp, ...claims })}.signature`;
}

export const PARTICIPANT_LINK = "11111111-1111-4111-8111-111111111111";

export const GAME_STATE = {
  state: { total: 4, drawn: 1, remaining: 3 },
  players: [
    { id: "ids-alice", name: "Alice", has_drawn: true },
    { id: "ids-bob", name: "Bob", has_drawn: false },
    { id: "ids-carol", name: "Carol", has_drawn: false },
    { id: "ids-dave", name: "Dave", has_drawn: false },
  ],
  attributions: [
    { giver_id: "ids-alice", target_id: "ids-bob", giver: "Alice", target: "Bob" },
  ],
};

export const PARTICIPANTS = [
  {
    id: "p1",
    name: "Alice",
    link: "11111111-1111-4111-8111-111111111111",
    has_drawn: true,
  },
  {
    id: "p2",
    name: "Bob",
    link: "22222222-2222-4222-8222-222222222222",
    has_drawn: false,
  },
];