import { requireAdmin, serviceRoleConfig } from "../_shared/admin.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";

// Annulation d'attribution (ticket #7) : l'admin défait un tirage. La cible
// retourne dans la réserve, le tireur peut retirer. La RPC security definer
// admin_cancel_attribution vérifie que la partie reste solvable (PSOLZ) et
// refusera sinon — l'erreur est remontée au client.

// PostgREST renvoie l'erreur RPC sous forme JSON { message, code, ... } :
// on en extrait le message français au lieu d'exposer le blob brut.
function rpcErrorMessage(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    const message = (parsed as { message?: unknown })?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // pas du JSON : message brut
  }
  return text || "annulation impossible";
}

export async function handleCancelAttribution(req: Request): Promise<Response> {
  if (isPreflight(req)) return optionsResponse(req);
  if (!isAllowedOrigin(req)) {
    return json(req, { error: "origine refusée" }, 403);
  }

  if (req.method !== "POST") {
    return json(req, { error: "méthode non supportée" }, 405);
  }

  const authError = await requireAdmin(req);
  if (authError) return authError;

  const config = serviceRoleConfig();
  if (!config) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }
  const { url: supabaseUrl, headers } = config;

  const body: unknown = await req.json().catch(() => null);
  const giverId = (body as { giver_id?: unknown })?.giver_id;
  if (typeof giverId !== "string" || !giverId) {
    return json(req, { error: "tireur requis" }, 400);
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/rpc/admin_cancel_attribution`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ p_giver_id: giverId }),
      },
    );
    if (res.status === 204) {
      return json(req, { cancelled: true }, 200);
    }
    const text = await res.text().catch(() => "");
    return json(req, { error: rpcErrorMessage(text) || "annulation impossible" }, 422);
  } catch {
    return json(req, { error: "base injoignable" }, 502);
  }
}

if (import.meta.main) {
  Deno.serve(handleCancelAttribution);
}
