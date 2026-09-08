// Réponses JSON + CORS pour les Edge Functions accessibles depuis le front.
// L'origine autorisée est l'app déployée (ALLOWED_ORIGIN, secret/deploy env) :
// le login admin est un mot de passe unique — on ne doit pas permettre à un
// site tiers de le bruteforcer cross-origin. Sans ALLOWED_ORIGIN (dev local),
// CORS reste ouvert.

const CORS_BASE = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function isPreflight(req: Request): boolean {
  return req.method === "OPTIONS";
}

export function isAllowedOrigin(
  req: Request,
  allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "",
): boolean {
  if (!allowed) return true;
  try {
    return new URL(req.headers.get("origin") ?? "").origin === new URL(allowed).origin;
  } catch {
    return false;
  }
}

export function corsHeaders(req?: Request): Record<string, string> {
  if (!req) return { ...CORS_BASE, "Access-Control-Allow-Origin": "*" };
  const origin = req.headers.get("origin");
  const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "";
  if (origin && allowed && new URL(origin).origin === new URL(allowed).origin) {
    return { ...CORS_BASE, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { ...CORS_BASE, "Access-Control-Allow-Origin": "*" };
}

export function optionsResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}