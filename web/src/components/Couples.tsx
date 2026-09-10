import { useEffect, useState, type FormEvent } from "react";
import { ApiError, addCouple, deleteCouple, fetchCouples, type Couple } from "../lib/api";
import { useAuth } from "../session/AuthProvider";

interface CouplesProps {
  participants: { id: string; name: string; has_drawn: boolean }[];
}

export function Couples({ participants }: CouplesProps) {
  const { session, logout } = useAuth();
  const [couples, setCouples] = useState<Couple[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setCouples(await fetchCouples(session));
    } catch (err) {
      handleError(err);
    }
  }

  useEffect(() => {
    refresh();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await addCouple(session, a, b);
      setA("");
      setB("");
      await refresh();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(couple: Couple): Promise<void> {
    if (!session) return;
    setError(null);
    try {
      await deleteCouple(session, couple.participant_a_id, couple.participant_b_id);
      await refresh();
    } catch (err) {
      handleError(err);
    }
  }

  const available = participants.filter((p) => !p.has_drawn);

  return (
    <section>
      <h2>Couples</h2>
      <p>Deux participants qui préfèrent ne pas se tirer mutuellement.</p>
      <form onSubmit={submit}>
        <label>
          Participant A
          <select value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">— choisir —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Participant B
          <select value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">— choisir —</option>
            {available.filter((p) => p.id !== a).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !a || !b}>
          Ajouter le couple
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {couples.map((couple) => (
          <li key={couple.participant_a_id + couple.participant_b_id}>
            {couple.a_name} ne peut pas tirer {couple.b_name}
            <button onClick={() => remove(couple)} disabled={busy}>
              Retirer
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}