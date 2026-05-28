import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { HostRouter } from "./router/HostRouter";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <HostRouter />
      </AuthProvider>
    </BrowserRouter>
  );
}
