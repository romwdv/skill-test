import { requireAdmin, serviceRoleConfig } from "../_shared/admin.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";

// Forçage de couple (ticket #6) : dernier recours quand le tirage est bloqué.
// L'admin force une attribution qui viole un couple via la RPC security definer
// admin_force_attribution. La trace du forçage (table forced_attributions) est
// jointe par la vue admin_attributions et n'atteint jamais les participants.

export async function handleForceDraw(req: Request): Promise<Response> {
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
  const targetId = (body as { target_id?: unknown })?.target_id;
  if (typeof giverId !== "string" || !giverId || typeof targetId !== "string" || !targetId) {
    return json(req, { error: "tireur et cible requis" }, 400);
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/rpc/admin_force_attribution`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ p_giver_id: giverId, p_target_id: targetId }),
      },
    );
    if (res.status === 200) {
      const attribution = await res.json();
      return json(req, { attribution }, 201);
    }
    const text = await res.text().catch(() => "");
    return json(req, { error: text || "forçage impossible" }, 502);
  } catch {
    return json(req, { error: "base injoignable" }, 502);
  }
}

if (import.meta.main) {
  Deno.serve(handleForceDraw);
}
