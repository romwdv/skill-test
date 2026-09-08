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

export async function adminLogin(password: string): Promise<Session> {
  const res = await fetch(functionUrl("admin-login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  let data: { token?: string; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    // réponse non-JSON : laissée tomber dans l'erreur générique
  }
  if (!res.ok) {
    throw new ApiError(data.error || "connexion refusée", res.status);
  }
  const session = sessionFromToken(data.token ?? "");
  if (!session) {
    throw new ApiError("réponse invalide du serveur", 500);
  }
  return session;
}

export interface GameState {
  state: { total: number; drawn: number; remaining: number };
  players: { id: string; name: string; has_drawn: boolean }[];
  attributions: { giver: string; target: string }[];
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