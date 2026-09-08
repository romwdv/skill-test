import { useState, type FormEvent } from "react";
import { ApiError, forceDraw } from "../lib/api";
import { useAuth } from "../session/AuthProvider";

interface ForceDrawProps {
  participants: { id: string; name: string; has_drawn: boolean }[];
  onForced: () => void;
}

export function ForceDraw({ participants, onForced }: ForceDrawProps) {
  const { session, logout } = useAuth();
  const [giverId, setGiverId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undrawn = participants.filter((p) => !p.has_drawn);
  const targets = participants.filter((p) => p.id !== giverId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await forceDraw(session, giverId, targetId);
      setGiverId("");
      setTargetId("");
      onForced();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
      } else {
        setError(err instanceof Error ? err.message : "forçage impossible");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Forcer un tirage</h2>
      <p>Dernier recours quand le tirage est bloqué : forcer une attribution malgré un couple.</p>
      <form onSubmit={submit}>
        <label>
          Tireur
          <select value={giverId} onChange={(e) => setGiverId(e.target.value)}>
            <option value="">— choisir —</option>
            {undrawn.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cible
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">— choisir —</option>
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !giverId || !targetId}>
          Forcer le tirage
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
