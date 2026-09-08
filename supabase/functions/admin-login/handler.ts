import { constantTimeStringEqual, signToken } from "../_shared/jwt.ts";
import { isAllowedOrigin, isPreflight, json, optionsResponse } from "../_shared/http.ts";

// Console admin (ticket #2) : un mot de passe unique, configuré par la variable
// d'environnement ADMIN_PASSWORD au déploiement (secret Supabase). S'il est juste,
// on émet une session admin : JWT HS256 (ADMIN_JWT_SECRET) à durée de vie courte,
// porteur de role=admin. Vérif à temps constant (pas d'oracle de timing). L'origine
// est restreinte à ALLOWED_ORIGIN (mot de passe unique → pas de bruteforce
// cross-origin depuis un site tiers).

export const SESSION_TTL_SECONDS = 12 * 3600;

export async function handleLogin(req: Request): Promise<Response> {
  if (isPreflight(req)) return optionsResponse(req);
  if (!isAllowedOrigin(req)) {
    return json(req, { error: "origine refusée" }, 403);
  }

  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  const jwtSecret = Deno.env.get("ADMIN_JWT_SECRET");
  if (!adminPassword || !jwtSecret) {
    return json(req, { error: "configuration serveur incomplète" }, 500);
  }

  const body: unknown = await req.json().catch(() => null);
  const password = typeof (body as { password?: unknown })?.password === "string"
    ? (body as { password: string }).password
    : "";
  if (!password) {
    return json(req, { error: "mot de passe requis" }, 400);
  }

  const ok = await constantTimeStringEqual(password, adminPassword);
  if (!ok) {
    return json(req, { error: "mot de passe invalide" }, 401);
  }

  const token = await signToken(jwtSecret, { sub: "admin", role: "admin" }, SESSION_TTL_SECONDS);
  return json(req, { token }, 200);
}

if (import.meta.main) {
  Deno.serve(handleLogin);
}