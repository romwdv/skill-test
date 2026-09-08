import { signToken } from "../_shared/jwt.ts";
import { serviceRoleConfig } from "../_shared/admin.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";
import { isUuid, PARTICIPANT_ROLE } from "../_shared/participant.ts";

// Accès participant par lien (ticket #4). Le lien privé vaut identité : un UUID
// 128 bits distribué manuellement, aucun compte ni mot de passe. L'échange se
// fait sous service role (la vérification d'existence ne doit pas être
// filtrable par la RLS) ; le lien n'est jamais renvoyé. Un lien régénéré (ou
// un participant supprimé) ne correspond plus à aucune ligne → 401 : la clé de
// la révocation.

export const SESSION_TTL_SECONDS = 90 * 24 * 3600;

export async function handleAccess(req: Request): Promise<Response> {
  if (isPreflight(req)) return optionsResponse(req);
  if (!isAllowedOrigin(req)) {
    return json(req, { error: "origine refusée" }, 403);
  }
  if (req.method !== "POST") {
    return json(req, { error: "méthode non supportée" }, 405);
  }

  const config = serviceRoleConfig();
  const jwtSecret = Deno.env.get("ADMIN_JWT_SECRET");
  if (!config || !jwtSecret) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }

  const body: unknown = await req.json().catch(() => null);
  const link = (body as { link?: unknown })?.link;
  if (typeof link !== "string" || !isUuid(link)) {
    return json(req, { error: "lien invalide" }, 400);
  }

  const { url: supabaseUrl, headers } = config;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/participants?select=id&link=eq.${encodeURIComponent(link)}`,
      { headers },
    );
    if (!res.ok) return json(req, { error: "base injoignable" }, 502);
    const rows = await res.json() as { id?: string }[];
    if (rows.length === 0 || typeof rows[0]?.id !== "string") {
      return json(req, { error: "lien inconnu" }, 401);
    }
    const token = await signToken(
      jwtSecret,
      { sub: rows[0].id, role: PARTICIPANT_ROLE, link },
      SESSION_TTL_SECONDS,
    );
    return json(req, { token }, 200);
  } catch {
    return json(req, { error: "base injoignable" }, 502);
  }
}

if (import.meta.main) {
  Deno.serve(handleAccess);
}