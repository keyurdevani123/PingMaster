import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PageLoader from "./PageLoader";

/**
 * Wraps any route that requires login.
 * - Still loading Firebase session → show full-page skeleton
 * - Not logged in → redirect to /login?next=<current-path>
 * - Logged in → render children
 */
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Firebase is still restoring the session — show skeleton instead of blank screen
  if (loading) return <PageLoader rows={5} />;

  if (!user) {
    const next = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return children;
}
