import { useParticipant } from "../session/ParticipantProvider";

export function ParticipantView() {
  const { status, participant, error, revoked, drawing, draw, logout } = useParticipant();

  if (status === "opening") {
    return (
      <main className="participant">
        <h1>Secret Santa</h1>
        <p>Ouverture…</p>
      </main>
    );
  }

  if (status === "invalid" || !participant) {
    return (
      <main className="participant">
        <h1>Secret Santa</h1>
        <p role="alert">{error ?? "Lien invalide."}</p>
        {revoked && <p>Demande un nouveau lien s'il a été régénéré.</p>}
      </main>
    );
  }

  return (
    <main className="participant">
      <h1>Secret Santa</h1>
      <p>
        Salut <strong>{participant.name}</strong>.
      </p>
      {participant.has_drawn ? (
        <p className="reveal">
          Tu offres à <strong>{participant.target_name}</strong>.
        </p>
      ) : (
        <>
          <p>Tu n'as pas encore tiré. Prêt·e ?</p>
          <button type="button" className="draw" onClick={draw} disabled={drawing}>
            {drawing ? "Tirage en cours…" : "Tirer"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="logout" onClick={logout}>
        Fermer ma session
      </button>
    </main>
  );
}