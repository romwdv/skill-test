import { serviceRoleConfig } from "../_shared/admin.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";
import { fetchParticipantViewRow, requireParticipant } from "../_shared/participant.ts";

// Vue personnelle du participant (ticket #4). Le JWT porteur (role=participant,
// claim link) est vérifié ici ; la RPC participant_view ne lit que par ce lien.
// Un lien régénéré (ou un participant supprimé) ne retrouve plus la ligne →
// 401 : l'ancienne session cesse de fonctionner. Un participant ne voit ainsi
// que sa propre attribution — jamais celles des autres.

export async function handleView(req: Request): Promise<Response> {
  if (isPreflight(req)) return optionsResponse(req);
  if (!isAllowedOrigin(req)) {
    return json(req, { error: "origine refusée" }, 403);
  }
  if (req.method !== "GET") {
    return json(req, { error: "méthode non supportée" }, 405);
  }

  const identity = await requireParticipant(req);
  if (identity instanceof Response) return identity;

  const config = serviceRoleConfig();
  if (!config) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }
  const { url: supabaseUrl, headers } = config;

  try {
    const rows = await fetchParticipantViewRow(supabaseUrl, headers, identity.link);
    if (rows.length === 0 || typeof rows[0]?.id !== "string") {
      return json(req, { error: "lien invalide" }, 401);
    }
    return json(req, { participant: rows[0] }, 200);
  } catch {
    return json(req, { error: "base injoignable" }, 502);
  }
}

if (import.meta.main) {
  Deno.serve(handleView);
}