import { AuthProvider, useAuth } from "./session/AuthProvider";
import { ParticipantProvider, useParticipant } from "./session/ParticipantProvider";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";
import { ParticipantView } from "./components/ParticipantView";

function Gate() {
  const { session: adminSession } = useAuth();
  const { status: participantStatus } = useParticipant();

  if (participantStatus !== "idle") return <ParticipantView />;
  if (adminSession) return <Overview />;
  return <Login />;
}

export function App() {
  return (
    <AuthProvider>
      <ParticipantProvider>
        <Gate />
      </ParticipantProvider>
    </AuthProvider>
  );
}