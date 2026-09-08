import { verifyToken } from "../_shared/jwt.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";

// Aperçu de l'état de la partie (ticket #2) : l'admin authentifié lit les vues
// via la service role — le secret n'est donc jamais exposé au client. Seules
// les sessions admin (role=admin, JWT non expiré) passent. ALLOWED_ORIGIN
// restreint le CORS comme pour le login.

interface Row {
  [column: string]: string | number | boolean;
}

export async function handleGameState(req: Request): Promise<Response> {
  if (isPreflight(req)) return optionsResponse(req);
  if (!isAllowedOrigin(req)) {
    return json(req, { error: "origine refusée" }, 403);
  }

  const jwtSecret = Deno.env.get("ADMIN_JWT_SECRET");
  if (!jwtSecret) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) {
    return json(req, { error: "session requise" }, 401);
  }
  try {
    const claims = await verifyToken(jwtSecret, token);
    if (claims.role !== "admin") throw new Error("not an admin session");
  } catch {
    return json(req, { error: "session invalide" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }

  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
  const queries = {
    state: `${supabaseUrl}/rest/v1/admin_game_state?select=*`,
    players: `${supabaseUrl}/rest/v1/admin_player_status?select=name,has_drawn&order=name.asc`,
    attributions: `${supabaseUrl}/rest/v1/admin_attributions?select=giver,target&order=giver.asc`,
  };
  try {
    const [stateRes, playersRes, attributionsRes] = await Promise.all(
      Object.values(queries).map((url) => fetch(url, { headers })),
    );
    if (!stateRes.ok || !playersRes.ok || !attributionsRes.ok) {
      return json(req, { error: "base injoignable" }, 502);
    }
    const state = await stateRes.json() as Row;
    const players = await playersRes.json() as Row[];
    const attributions = await attributionsRes.json() as Row[];
    return json(req, { state, players, attributions }, 200);
  } catch {
    return json(req, { error: "base injoignable" }, 502);
  }
}

if (import.meta.main) {
  Deno.serve(handleGameState);
}