import { useState, type FormEvent } from "react";
import { useAuth } from "../session/AuthProvider";

export function Login() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "connexion refusée");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Console admin</h1>
      <form onSubmit={submit}>
        <label>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" disabled={busy || !password}>
          Se connecter
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}