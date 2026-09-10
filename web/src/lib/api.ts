import { sessionFromToken, type Session } from "./session";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function functionUrl(name: string): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  return `${base.replace(/\/+$/, "")}/functions/v1/${name}`;
}

async function authenticate(name: string, payload: unknown, fallback: string): Promise<Session> {
  const res = await fetch(functionUrl(name), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: { token?: string; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    // réponse non-JSON : laissée tomber dans l'erreur générique
  }
  if (!res.ok) {
    throw new ApiError(data.error || fallback, res.status);
  }
  const session = sessionFromToken(data.token ?? "");
  if (!session) {
    throw new ApiError("réponse invalide du serveur", 500);
  }
  return session;
}

export async function adminLogin(password: string): Promise<Session> {
  return authenticate("admin-login", { password }, "connexion refusée");
}

export interface ParticipantInfo {
  id: string;
  name: string;
  has_drawn: boolean;
  target_name: string | null;
}

export async function participantAccess(link: string): Promise<Session> {
  return authenticate("participant-access", { link }, "lien refusé");
}

export async function fetchParticipantView(session: Session): Promise<ParticipantInfo> {
  const res = await fetch(functionUrl("participant-view"), {
    headers: { authorization: `Bearer ${session.token}` },
  });
  let data: { participant?: ParticipantInfo; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new ApiError("impossible de charger ta vue", res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.error || "impossible de charger ta vue", res.status);
  }
  if (!data.participant) {
    throw new ApiError("réponse invalide du serveur", 500);
  }
  return data.participant;
}

export async function drawParticipant(session: Session): Promise<ParticipantInfo> {
  const res = await fetch(functionUrl("participant-draw"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  let data: { participant?: ParticipantInfo; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new ApiError("impossible de tirer", res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.error || "impossible de tirer", res.status);
  }
  if (!data.participant) {
    throw new ApiError("réponse invalide du serveur", 500);
  }
  return data.participant;
}

export interface GameState {
  state: { total: number; drawn: number; remaining: number };
  players: { id: string; name: string; has_drawn: boolean }[];
  attributions: { giver_id: string; target_id: string; giver: string; target: string; forced?: boolean }[];
}

export async function fetchGameState(session: Session): Promise<GameState> {
  const res = await fetch(functionUrl("admin-game-state"), {
    headers: { authorization: `Bearer ${session.token}` },
  });
  let data: GameState & { error?: string };
  try {
    data = await res.json();
  } catch {
    throw new ApiError("impossible de charger l'état", res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.error || "impossible de charger l'état", res.status);
  }
  return data;
}

export interface Participant {
  id: string;
  name: string;
  link: string;
  has_drawn: boolean;
}

export interface ParticipantList {
  participants: Participant[];
}

export interface Couple {
  participant_a_id: string;
  participant_b_id: string;
  a_name: string;
  b_name: string;
}

export interface ParticipantData {
  participants: Participant[];
  couples: Couple[];
}

async function participantsRequest(
  session: Session,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(functionUrl("admin-participants"), {
    ...init,
    headers: { authorization: `Bearer ${session.token}`, ...init.headers },
  });
  let data: Record<string, unknown> & { error?: string } = {};
  try {
    data = await res.json();
  } catch {
    throw new ApiError("réponse invalide du serveur", res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.error || "action impossible", res.status);
  }
  return data;
}

export async function fetchParticipants(session: Session): Promise<Participant[]> {
  const data = await participantsRequest(session, { method: "GET" });
  const list = data as unknown as ParticipantList;
  if (!Array.isArray(list.participants)) {
    throw new ApiError("réponse invalide du serveur", 500);
  }
  return list.participants;
}

export async function fetchCouples(session: Session): Promise<Couple[]> {
  const data = await participantsRequest(session, { method: "GET" });
  const list = data as unknown as ParticipantData;
  if (!Array.isArray(list.couples)) {
    throw new ApiError("réponse invalide du serveur", 500);
  }
  return list.couples;
}

export async function addCouple(session: Session, a: string, b: string): Promise<void> {
  await participantsRequest(session, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "couple.add", a, b }),
  });
}

export async function deleteCouple(session: Session, a: string, b: string): Promise<void> {
  await participantsRequest(session, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "couple.delete", a, b }),
  });
}

export async function addParticipant(session: Session, name: string): Promise<Participant> {
  const data = await participantsRequest(session, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "add", name }),
  });
  const participant = (data as { participant?: Participant })?.participant;
  if (!participant) throw new ApiError("réponse invalide du serveur", 500);
  return participant;
}

export async function deleteParticipant(session: Session, id: string): Promise<void> {
  await participantsRequest(session, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete", id }),
  });
}

export async function regenerateParticipantLink(
  session: Session,
  id: string,
): Promise<Participant> {
  const data = await participantsRequest(session, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "regenerate", id }),
  });
  const participant = (data as { participant?: Participant })?.participant;
  if (!participant) throw new ApiError("réponse invalide du serveur", 500);
  return participant;
}

export interface ForcedDraw {
  giver_id: string;
  target_id: string;
}

export async function forceDraw(
  session: Session,
  giverId: string,
  targetId: string,
): Promise<ForcedDraw> {
  const res = await fetch(functionUrl("admin-force-draw"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ giver_id: giverId, target_id: targetId }),
  });
  let data: { attribution?: ForcedDraw; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new ApiError("réponse invalide du serveur", res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.error || "forçage impossible", res.status);
  }
  if (!data.attribution) throw new ApiError("réponse invalide du serveur", 500);
  return data.attribution;
}

export async function cancelAttribution(session: Session, giverId: string): Promise<void> {
  const res = await fetch(functionUrl("admin-cancel-attribution"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ giver_id: giverId }),
  });
  let data: { error?: string };
  try {
    data = await res.json();
  } catch {
    throw new ApiError("réponse invalide du serveur", res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.error || "annulation impossible", res.status);
  }
}

export async function resetGame(session: Session): Promise<void> {
  const res = await fetch(functionUrl("admin-reset-game"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  let data: { error?: string };
  try {
    data = await res.json();
  } catch {
    throw new ApiError("réponse invalide du serveur", res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.error || "réinitialisation impossible", res.status);
  }
}