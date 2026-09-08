import { serviceRoleConfig } from "../_shared/admin.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";
import { fetchParticipantViewRow, requireParticipant } from "../_shared/participant.ts";
import { rpcCode, rpcErrorMessage } from "../_shared/rpc.ts";

// Tirage du participant (ticket #9) : le bouton de tirage de sa vue. La RPC
// draw() choisit une cible dans la réserve sous service role, puis on relit sa
// vue (participant_view) — le participant découvre « tu offres à Y » sans
// jamais voir les attributions des autres. Le lien passe par le claim de la
// session vérifiée, jamais par une saisie client.

export async function handleDraw(req: Request): Promise<Response> {
  if (isPreflight(req)) return optionsResponse(req);
  if (!isAllowedOrigin(req)) {
    return json(req, { error: "origine refusée" }, 403);
  }
  if (req.method !== "POST") {
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
    const drawRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/draw`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ p_link: identity.link }),
      },
    );
    if (!drawRes.ok) {
      const text = await drawRes.text().catch(() => "");
      // Lien obsolète (régénéré, participant supprimé) : la révocation du lien
      // vaut 401, comme participant-view — le front ferme la session.
      if (rpcCode(text) === "PLINK") {
        return json(req, { error: "lien invalide" }, 401);
      }
      // Déjà tiré (double tap, autre appareil) : le participant a une
      // attribution, on renvoie sa vue plutôt qu'une erreur.
      if (rpcCode(text) === "PDRAW") {
        return ownView(req, supabaseUrl, headers, identity.link);
      }
      return json(req, { error: rpcErrorMessage(text, "tirage impossible") }, 422);
    }
    return ownView(req, supabaseUrl, headers, identity.link);
  } catch {
    return json(req, { error: "base injoignable" }, 502);
  }
}

async function ownView(
  req: Request,
  supabaseUrl: string,
  headers: HeadersInit,
  link: string,
): Promise<Response> {
  const rows = await fetchParticipantViewRow(supabaseUrl, headers, link);
  if (rows.length === 0 || typeof rows[0]?.id !== "string") {
    return json(req, { error: "lien invalide" }, 401);
  }
  return json(req, { participant: rows[0] }, 200);
}

if (import.meta.main) {
  Deno.serve(handleDraw);
}