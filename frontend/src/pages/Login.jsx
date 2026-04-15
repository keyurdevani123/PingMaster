import { useState } from "react";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { Navigate, useNavigate, useSearchParams, Link } from "react-router-dom";
import PageLoader from "../components/PageLoader";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";
  const { user, loading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (authLoading) {
    return <PageLoader rows={3} />;
  }

  if (user) {
    return <Navigate to={nextPath} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(getFriendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(getFriendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">PingMaster</h1>
          <p className="text-sm text-[#6b6b6b] mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-[#1a1a1a] border border-[#222222] rounded-2xl p-7 space-y-4">
          {error && (
            <div className="bg-[#1a0f0f] border border-[#3d1a1a] text-white rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-[0.08em] text-white">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full h-11 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm px-4 placeholder:text-[#444444] focus:outline-none focus:border-[#555555] transition"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-[0.08em] text-white">Password</label>
                <Link to="/forgot-password" className="text-[11px] text-white hover:text-[#cccccc] transition">
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="current-password"
                placeholder="Your password"
                className="w-full h-11 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm px-4 placeholder:text-[#6b6b6b] focus:outline-none focus:border-[#555555] transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-white text-black text-sm font-semibold hover:bg-[#e5e5e5] transition disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="text-sm text-center text-[#555555]">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="text-white hover:text-[#cccccc] transition font-medium">
              Sign up
            </Link>
          </p>
        </div>

        {/* Google — below card */}
        <div className="mt-4">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="w-full h-11 rounded-xl bg-[#111111] border border-[#2a2a2a] text-[#cccccc] text-sm flex items-center justify-center gap-3 hover:bg-[#1a1a1a] transition disabled:opacity-50"
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function getFriendlyError(code) {
  const map = {
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-email": "Please enter a valid email.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
