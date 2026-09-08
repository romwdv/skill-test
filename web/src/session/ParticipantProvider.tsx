import {
  ApiError,
  fetchParticipantView,
  participantAccess,
  type ParticipantInfo,
} from "../lib/api";
import {
  clearSession,
  isSessionExpired,
  loadSession,
  saveSession,
  PARTICIPANT_SESSION_KEY,
  type Session,
} from "../lib/session";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Status = "idle" | "opening" | "ready" | "invalid";

interface ParticipantContextValue {
  status: Status;
  session: Session | null;
  participant: ParticipantInfo | null;
  error: string | null;
  revoked: boolean;
  identify: (link: string) => Promise<void>;
  logout: () => void;
}

const ParticipantContext = createContext<ParticipantContextValue | null>(null);

// Une ouverture de la vue s'impose dès le premier rendu dès qu'une session
// existe en stockage ou qu'un lien arrive dans l'URL : éviter de laisser
// fuser la console admin un instant.
function hasStoredSessionOrUrlLink(): boolean {
  return (
    loadSession(PARTICIPANT_SESSION_KEY) !== null ||
    new URLSearchParams(window.location.search).get("link") !== null
  );
}

export function ParticipantProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<Session | null>(() =>
    loadSession(PARTICIPANT_SESSION_KEY),
  );
  const [participant, setParticipant] = useState<ParticipantInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [status, setStatus] = useState<Status>(hasStoredSessionOrUrlLink() ? "opening" : "idle");

  // Charge la vue du participant depuis une session valide. Une session dont le
  // lien ne résout plus (lien régénéré, participant supprimé) est 401 : on la
  // jette et on prévient.
  const load = useCallback(async (s: Session) => {
    setStatus("opening");
    setError(null);
    setRevoked(false);
    try {
      setParticipant(await fetchParticipantView(s));
      setStatus("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession(PARTICIPANT_SESSION_KEY);
        setSession(null);
        setRevoked(true);
        setError("Ce lien n'est plus valide : il a peut-être été régénéré.");
      } else {
        setError(err instanceof Error ? err.message : "chargement impossible");
      }
      setStatus("invalid");
    }
  }, []);

  // Identifie le participant par son lien privé (le lien vaut identité, aucun
  // compte) et ouvre sa vue personnelle.
  const identify = useCallback(
    async (link: string) => {
      setStatus("opening");
      setError(null);
      setRevoked(false);
      setParticipant(null);
      try {
        const next = await participantAccess(link);
        saveSession(next, PARTICIPANT_SESSION_KEY);
        setSession(next);
        await load(next);
      } catch (err) {
        setRevoked(err instanceof ApiError && err.status === 401);
        setError(err instanceof Error ? err.message : "lien invalide");
        setStatus("invalid");
      }
    },
    [load],
  );

  const logout = useCallback(() => {
    clearSession(PARTICIPANT_SESSION_KEY);
    setSession(null);
    setParticipant(null);
    setError(null);
    setRevoked(false);
    setStatus("idle");
  }, []);

  // Au montage : un lien dans l'URL (distribué via WhatsApp/SMS) ouvre la
  // session ; sinon, une session déjà stockée est rechargée (y compris après
  // rechargement de la page).
  useEffect(() => {
    const urlLink = new URLSearchParams(window.location.search).get("link");
    if (urlLink) {
      identify(urlLink).finally(() => {
        window.history.replaceState(null, "", window.location.pathname);
      });
      return;
    }
    if (!session) return;
    if (isSessionExpired(session)) {
      clearSession(PARTICIPANT_SESSION_KEY);
      setSession(null);
      return;
    }
    load(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ status, session, participant, error, revoked, identify, logout }),
    [status, session, participant, error, revoked, identify, logout],
  );

  return <ParticipantContext.Provider value={value}>{children}</ParticipantContext.Provider>;
}

export function useParticipant(): ParticipantContextValue {
  const ctx = useContext(ParticipantContext);
  if (!ctx) {
    throw new Error("useParticipant doit être utilisé dans un ParticipantProvider");
  }
  return ctx;
}