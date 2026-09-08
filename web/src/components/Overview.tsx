import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, cancelAttribution, fetchGameState, type GameState } from "../lib/api";
import { isSessionExpired } from "../lib/session";
import { useAuth } from "../session/AuthProvider";
import { Participants } from "./Participants";
import { ForceDraw } from "./ForceDraw";

export function Overview() {
  const { session, logout } = useAuth();
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGameState(session);
      if (!cancelledRef.current) setGame(data);
    } catch (err) {
      if (cancelledRef.current) return;
      if (err instanceof ApiError && err.status === 401) {
        logout();
      } else {
        setError(err instanceof Error ? err.message : "erreur de chargement");
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [session, logout]);

  useEffect(() => {
    if (!session) return;
    if (isSessionExpired(session)) {
      logout();
      return;
    }
    cancelledRef.current = false;
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [session, logout, refresh]);

  const cancel = useCallback(
    async (giverId: string) => {
      if (!session) return;
      if (
        !window.confirm(
          "Annuler cette attribution ? La cible retournera dans la réserve et le tireur pourra retirer.",
        )
      ) {
        return;
      }
      setError(null);
      try {
        await cancelAttribution(session, giverId);
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
        } else {
          setError(err instanceof Error ? err.message : "annulation impossible");
        }
      }
    },
    [session, refresh, logout],
  );

  if (!session) return null;
  if (loading) return <p>Chargement…</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!game) return null;

  const { state, players, attributions } = game;
  return (
    <main>
      <h1>Console admin</h1>
      <p>
        <strong>{state.drawn}</strong> ont tiré, <strong>{state.remaining}</strong> restent (
        {state.total} participants au total)
      </p>
      <ul>
        {players.map((player) => (
          <li key={player.id}>
            {player.name} — {player.has_drawn ? "a tiré" : "reste"}
          </li>
        ))}
      </ul>
      <section>
        <h2>Attributions</h2>
        {attributions.length === 0 ? (
          <p>Aucune attribution pour le moment.</p>
        ) : (
          <ul>
            {attributions.map(({ giver, target, forced, giver_id }) => (
              <li key={`${giver}-${target}`}>
                {giver} offre à {target}
                {forced && <strong> — tirage forcé (son couple)</strong>}
                <button onClick={() => cancel(giver_id)}>Annuler</button>
              </li>
            ))}
          </ul>
        )}
        {attributions.some((a) => a.forced) && (
          <p role="status">
            Tirage forcé :{" "}
            {attributions
              .filter((a) => a.forced)
              .map((a) => `${a.giver} a tiré ${a.target} (son couple)`)
              .join(" ; ")}
          </p>
        )}
      </section>
      <ForceDraw participants={players} onForced={refresh} />
      <Participants />
      <button onClick={logout}>Déconnexion</button>
    </main>
  );
}