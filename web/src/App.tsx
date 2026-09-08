import { AuthProvider, useAuth } from "./session/AuthProvider";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";

function Gate() {
  const { session } = useAuth();
  return session ? <Overview /> : <Login />;
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}