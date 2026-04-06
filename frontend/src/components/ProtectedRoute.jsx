import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Wraps any route that requires login.
 * - Still loading Firebase session → show splash
 * - Not logged in → redirect to /login?next=<current-path>
 * - Logged in → render children
 */
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0c10] flex items-center justify-center">
        <div className="text-[#69e7ba] text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!user) {
    // Preserve the attempted path so Login can redirect back after sign-in
    const next = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return children;
}
