import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "./hooks/useAuth";
import { HostRouter } from "./router/HostRouter";

export function App() {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <AuthProvider>
          <HostRouter />
        </AuthProvider>
      </BrowserRouter>
    </HelmetProvider>
  );
}
