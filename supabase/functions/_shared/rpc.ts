// Extraction du message français et du code métier d'une erreur PostgREST.
// PostgREST renvoie les refus de RPC sous forme JSON { message, code, ... } :
// chaque handler extrait ces deux valeurs au lieu d'exposer le blob brut.

export interface RpcErrorPayload {
  code: string;
  message: string;
}

export function rpcError(text: string): RpcErrorPayload {
  try {
    const parsed: unknown = JSON.parse(text);
    const { code, message } = parsed as { code?: unknown; message?: unknown };
    return {
      code: typeof code === "string" ? code : "",
      message: typeof message === "string" ? message : "",
    };
  } catch {
    // pas du JSON : message brut, code vide
    return { code: "", message: text };
  }
}

// Message d'erreur à servir au client : le message français de la RPC si
// présent, sinon le corps brut, sinon le repli du handler.
export function rpcErrorMessage(text: string, fallback: string): string {
  return rpcError(text).message || text || fallback;
}

// Code métier de l'erreur RPC (PLINK, PDRAW, PSOLZ, PNONE, …), vide si absent.
export function rpcCode(text: string): string {
  return rpcError(text).code;
}