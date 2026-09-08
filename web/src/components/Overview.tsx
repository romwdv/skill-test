import { useEffect, useState } from "react";
import { ApiError, fetchGameState, type GameState } from "../lib/api";
import { isSessionExpired } from "../lib/session";
import { useAuth } from "../session/AuthProvider";
import { Participants } from "./Participants";

export function Overview() {
  const { session, logout } = useAuth();
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    if (isSessionExpired(session)) {
      logout();
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGameState(session)
      .then((data) => {
        if (!cancelled) setGame(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          logout();
        } else {
          setError(err instanceof Error ? err.message : "erreur de chargement");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, logout]);

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
            {attributions.map(({ giver, target }) => (
              <li key={`${giver}-${target}`}>
                {giver} offre à {target}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Participants />
      <button onClick={logout}>Déconnexion</button>
    </main>
  );
}