import { requireAdmin, serviceRoleConfig } from "../_shared/admin.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";
import { rpcErrorMessage } from "../_shared/rpc.ts";

// Nouvelle partie (ticket #8) : l'admin vide toutes les attributions — la
// réserve se reconstitue (dernier participant non cible), tout le monde repasse
// « pas encore tiré », participants et couples sont conservés. La RPC
// security definer admin_reset_game fait le travail ; l'endpoint n'expose que
// la confirmation, jamais les données.

export async function handleResetGame(req: Request): Promise<Response> {
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

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/rpc/admin_reset_game`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      },
    );
    if (res.ok) {
      return json(req, { reset: true }, 200);
    }
    const text = await res.text().catch(() => "");
    return json(req, { error: rpcErrorMessage(text, "réinitialisation impossible") }, 422);
  } catch {
    return json(req, { error: "base injoignable" }, 502);
  }
}

if (import.meta.main) {
  Deno.serve(handleResetGame);
}