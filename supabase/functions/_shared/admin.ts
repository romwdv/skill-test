// Helpers partagés des Edge Functions admin (tickets #2, #3, #6). Chaque handler
// répétait la même session admin (JWT role=admin) et la même config service role ;
// c'est ici la source unique. Vérifications à temps constant héritées de jwt.ts.

import { verifyToken } from "./jwt.ts";
import { json } from "./http.ts";

// Vérifie la session admin du porteur du JWT. Renvoie le json d'erreur à servir,
// ou null si la session est valide.
export async function requireAdmin(req: Request): Promise<Response | null> {
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
  return null;
}

// Configuration service role (URL Supabase + en-têtes). Renvoie null si un
// secret manque — le handler répond alors 500.
export function serviceRoleConfig(): { url: string; headers: HeadersInit } | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return {
    url,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
  };
}
