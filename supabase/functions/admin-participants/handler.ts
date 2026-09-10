import { requireAdmin, serviceRoleConfig } from "../_shared/admin.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";

// Gestion des participants côté admin (ticket #3) : lister (avec les liens),
// ajouter, supprimer, régénérer un lien. Auth par session admin (JWT role=admin)
// comme game-state ; les mutations passent par des RPC security definer — le
// service rôle n'est jamais exposé au client.

interface Row {
  [column: string]: string | number | boolean;
}

async function callRpc(
  url: string,
  headers: HeadersInit,
  functionName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(
      `${url}/rest/v1/rpc/${functionName}`,
      { method: "POST", headers, body: JSON.stringify(args) },
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

  const authError = await requireAdmin(req);
  if (authError) return authError;

  const config = serviceRoleConfig();
  if (!config) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }
  const { url: supabaseUrl, headers } = config;

  // GET : lister les participants avec leur lien et leur état, et les couples.
  if (req.method === "GET") {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/admin_participants?select=id,name,link,has_drawn&order=name.asc`,
        { headers },
      );
      if (!res.ok) return json(req, { error: "base injoignable" }, 502);
      const rows = await res.json() as Row[];
      const couplesRes = await fetch(
        `${supabaseUrl}/rest/v1/admin_couples?select=participant_a_id,participant_b_id,a_name,b_name&order=a_name.asc`,
        { headers },
      );
      if (!couplesRes.ok) return json(req, { error: "base injoignable" }, 502);
      const couples = await couplesRes.json() as Row[];
      return json(req, { participants: rows, couples }, 200);
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
    const rpc = await callRpc(supabaseUrl, headers, "admin_add_participant", { p_name: name.trim() });
    if (!rpc.ok) return json(req, { error: rpc.error ?? "ajout impossible" }, 502);
    return json(req, { participant: rpc.data }, 201);
  }

  if (action === "delete") {
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== "string" || !id) {
      return json(req, { error: "identifiant requis" }, 400);
    }
    const rpc = await callRpc(supabaseUrl, headers, "admin_delete_participant", { p_id: id });
    if (!rpc.ok) return json(req, { error: rpc.error ?? "suppression impossible" }, 502);
    return json(req, { deleted: true }, 200);
  }

  if (action === "regenerate") {
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== "string" || !id) {
      return json(req, { error: "identifiant requis" }, 400);
    }
    const rpc = await callRpc(supabaseUrl, headers, "admin_regenerate_participant_link", { p_id: id });
    if (!rpc.ok) return json(req, { error: rpc.error ?? "régénération impossible" }, 502);
    if (!rpc.data) return json(req, { error: "participant inconnu" }, 404);
    return json(req, { participant: rpc.data }, 200);
  }

  if (action === "couple.add") {
    const a = (body as { a?: unknown })?.a;
    const b = (body as { b?: unknown })?.b;
    if (typeof a !== "string" || typeof b !== "string" || !a || !b) {
      return json(req, { error: "participants requis" }, 400);
    }
    const rpc = await callRpc(supabaseUrl, headers, "admin_add_couple", { p_a: a, p_b: b });
    if (!rpc.ok) return json(req, { error: rpc.error ?? "ajout impossible" }, 502);
    return json(req, { added: true }, 201);
  }

  if (action === "couple.delete") {
    const a = (body as { a?: unknown })?.a;
    const b = (body as { b?: unknown })?.b;
    if (typeof a !== "string" || typeof b !== "string" || !a || !b) {
      return json(req, { error: "participants requis" }, 400);
    }
    const rpc = await callRpc(supabaseUrl, headers, "admin_delete_couple", { p_a: a, p_b: b });
    if (!rpc.ok) return json(req, { error: rpc.error ?? "suppression impossible" }, 502);
    return json(req, { deleted: true }, 200);
  }

  return json(req, { error: "action inconnue" }, 400);
}

if (import.meta.main) {
  Deno.serve(handleParticipants);
}