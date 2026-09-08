import { useParticipant } from "../session/ParticipantProvider";

export function ParticipantView() {
  const { status, participant, error, revoked, logout } = useParticipant();

  if (status === "opening") {
    return (
      <main>
        <h1>Secret Santa</h1>
        <p>Ouverture…</p>
      </main>
    );
  }

  if (status === "invalid" || !participant) {
    return (
      <main>
        <h1>Secret Santa</h1>
        <p role="alert">{error ?? "Lien invalide."}</p>
        {revoked && <p>Demande un nouveau lien s'il a été régénéré.</p>}
      </main>
    );
  }

  return (
    <main>
      <h1>Secret Santa</h1>
      <p>
        Salut <strong>{participant.name}</strong>.
      </p>
      {participant.has_drawn ? (
        <p>
          Tu offres à <strong>{participant.target_name}</strong>.
        </p>
      ) : (
        <p>Tu n'as pas encore tiré.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <button onClick={logout}>Fermer ma session</button>
    </main>
  );
}