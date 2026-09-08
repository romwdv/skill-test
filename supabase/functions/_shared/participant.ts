// Session participant (ticket #4) : le lien privé vaut identité, sans compte.
// L'Edge Function participant-access échange un lien (UUID 128 bits) contre un
// JWT HS256 (ADMIN_JWT_SECRET, même mécanisme que l'admin) porteur du lien en
// claim. Ici, la vérification : signature, expiration, rôle participant, et
// présence du claim link. Un lien régénéré laisse un JWT obsolète : participant-view
// retrouve alors zéro ligne et répond 401 — l'ancien lien ne donne plus accès.

import { sessionClaims } from "./admin.ts";
import { json } from "./http.ts";

export const PARTICIPANT_ROLE = "participant";

const LINK_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParticipantIdentity {
  id: string;
  link: string;
}

export function isUuid(value: string): boolean {
  return LINK_RE.test(value);
}

// Vérifie la session participant du porteur du JWT. Renvoie le json d'erreur à
// servir, ou l'identité (id + link) si la session est valide.
export async function requireParticipant(
  req: Request,
): Promise<ParticipantIdentity | Response> {
  const claims = await sessionClaims(req);
  if (claims instanceof Response) return claims;
  if (claims.role !== PARTICIPANT_ROLE) {
    return json(req, { error: "session invalide" }, 401);
  }
  if (typeof claims.sub !== "string" || typeof claims.link !== "string" || !isUuid(claims.link)) {
    return json(req, { error: "session invalide" }, 401);
  }
  return { id: claims.sub, link: claims.link };
}