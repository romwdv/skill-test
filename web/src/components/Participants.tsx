import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addParticipant,
  ApiError,
  deleteParticipant,
  fetchParticipants,
  regenerateParticipantLink,
  type Participant,
} from "../lib/api";
import { useAuth } from "../session/AuthProvider";

export function Participants() {
  const { session, logout } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimeout = useRef<number | undefined>(undefined);

  function handleError(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      logout();
    } else {
      setError(err instanceof Error ? err.message : "action impossible");
    }
  }

  async function refresh(): Promise<void> {
    if (!session) return;
    setError(null);
    try {
      setParticipants(await fetchParticipants(session));
    } catch (err) {
      handleError(err);
    }
  }

  useEffect(() => {
    refresh();
    return () => window.clearTimeout(copiedTimeout.current);
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await addParticipant(session, trimmed);
      setName("");
      await refresh();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!session) return;
    if (!window.confirm("Supprimer ce participant ? Ses attributions et couples seront annulés.")) {
      return;
    }
    setError(null);
    try {
      await deleteParticipant(session, id);
      await refresh();
    } catch (err) {
      handleError(err);
    }
  }

  async function regenerate(id: string): Promise<void> {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await regenerateParticipantLink(session, id);
      await refresh();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function copy(participant: Participant): Promise<void> {
    const link = `${window.location.origin}/?link=${encodeURIComponent(participant.link)}`;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopiedId(participant.id);
    window.clearTimeout(copiedTimeout.current);
    copiedTimeout.current = window.setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <section>
      <h2>Participants</h2>
      <form onSubmit={submit}>
        <label>
          Nom
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ajouter un participant"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim()}>
          Ajouter
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {participants.map((participant) => (
          <li key={participant.id}>
            {participant.name} — {participant.has_drawn ? "a tiré" : "reste"}
            <button onClick={() => copy(participant)}>
              {copiedId === participant.id ? "Copié !" : "Copier le lien"}
            </button>
            <button onClick={() => regenerate(participant.id)} disabled={busy}>
              Régénérer le lien
            </button>
            <button onClick={() => remove(participant.id)} disabled={busy}>
              Supprimer
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}