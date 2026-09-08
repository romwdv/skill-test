import { verifyToken } from "../_shared/jwt.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";

// Gestion des participants côté admin (ticket #3) : lister (avec les liens),
// ajouter, supprimer, régénérer un lien. Auth par session admin (JWT role=admin)
// comme game-state ; les mutations passent par des RPC security definer — le
// service rôle n'est jamais exposé au client.

interface Row {
  [column: string]: string | number | boolean;
}

async function authAdmin(req: Request): Promise<{ ok: boolean; code: number; error: string }> {
  const jwtSecret = Deno.env.get("ADMIN_JWT_SECRET");
  if (!jwtSecret) {
    return { ok: false, code: 500, error: "configuration serveur incomplète" };
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) {
    return { ok: false, code: 401, error: "session requise" };
  }
  try {
    const claims = await verifyToken(jwtSecret, token);
    if (claims.role !== "admin") throw new Error("not an admin session");
  } catch {
    return { ok: false, code: 401, error: "session invalide" };
  }
  return { ok: true, code: 200, error: "" };
}

function serviceHeaders(): HeadersInit {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

async function callRpc(
  url: string,
  functionName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(
      `${url}/rest/v1/rpc/${functionName}`,
      { method: "POST", headers: serviceHeaders(), body: JSON.stringify(args) },
    );
    if (res.status === 204) return { ok: true };
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: text || `rpc ${functionName} a échoué` };
    }
    const data = text ? JSON.parse(text) : null;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "base injoignable" };
  }
}

export async function handleParticipants(req: Request): Promise<Response> {
  if (isPreflight(req)) return optionsResponse(req);
  if (!isAllowedOrigin(req)) {
    return json(req, { error: "origine refusée" }, 403);
  }

  const verdict = await authAdmin(req);
  if (!verdict.ok) {
    return json(req, { error: verdict.error }, verdict.code);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }

  // GET : lister les participants avec leur lien et leur état.
  if (req.method === "GET") {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/admin_participants?select=id,name,link,has_drawn&order=name.asc`,
        { headers: serviceHeaders() },
      );
      if (!res.ok) return json(req, { error: "base injoignable" }, 502);
      const rows = await res.json() as Row[];
      return json(req, { participants: rows }, 200);
    } catch {
      return json(req, { error: "base injoignable" }, 502);
    }
  }

  if (req.method !== "POST") {
    return json(req, { error: "méthode non supportée" }, 405);
  }

  const body: unknown = await req.json().catch(() => null);
  const action = (body as { action?: unknown })?.action;
  if (action === "add") {
    const name = (body as { name?: unknown })?.name;
    if (typeof name !== "string" || name.trim() === "") {
      return json(req, { error: "nom requis" }, 400);
    }
    const rpc = await callRpc(
      supabaseUrl,
      "admin_add_participant",
      { p_name: name.trim() },
    );
    if (!rpc.ok) return json(req, { error: rpc.error ?? "ajout impossible" }, 502);
    return json(req, { participant: rpc.data }, 201);
  }

  if (action === "delete") {
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== "string" || !id) {
      return json(req, { error: "identifiant requis" }, 400);
    }
    const rpc = await callRpc(supabaseUrl, "admin_delete_participant", { p_id: id });
    if (!rpc.ok) return json(req, { error: rpc.error ?? "suppression impossible" }, 502);
    return json(req, { deleted: true }, 200);
  }

  if (action === "regenerate") {
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== "string" || !id) {
      return json(req, { error: "identifiant requis" }, 400);
    }
    const rpc = await callRpc(supabaseUrl, "admin_regenerate_participant_link", { p_id: id });
    if (!rpc.ok) return json(req, { error: rpc.error ?? "régénération impossible" }, 502);
    if (!rpc.data) return json(req, { error: "participant inconnu" }, 404);
    return json(req, { participant: rpc.data }, 200);
  }

  return json(req, { error: "action inconnue" }, 400);
}

if (import.meta.main) {
  Deno.serve(handleParticipants);
}