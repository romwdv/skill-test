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