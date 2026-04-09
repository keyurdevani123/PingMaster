import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { useNavigate, useSearchParams, Link } from "react-router-dom";

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Handle email/password sign-up.
  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(getFriendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  // Handle Google sign-up/in.
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
    <div className="min-h-screen bg-[#0e0e0e] text-[#e7e5e5] px-6 py-10 flex flex-col items-center justify-center">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-[#e7e5e5]">
            PingMaster
          </h1>
          <p className="mt-3 text-sm text-[#acabaa]">Create your account</p>
        </div>

        <div className="bg-[#131313] border border-[#484848]/40 rounded-xl p-7 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-[11px] uppercase tracking-[0.08em] text-[#acabaa]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full h-11 bg-[#000000] border border-[#484848]/40 text-[#e7e5e5] rounded-lg px-4 focus:outline-none focus:border-[#c6c6c7]/70 transition"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] uppercase tracking-[0.08em] text-[#acabaa]">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full h-11 bg-[#000000] border border-[#484848]/40 text-[#e7e5e5] rounded-lg px-4 focus:outline-none focus:border-[#c6c6c7]/70 transition"
                placeholder="Min 6 characters"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-[#c6c6c7] text-[#3f4041] font-semibold rounded-xl hover:opacity-90 transition disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Sign Up"}
            </button>
          </form>

          <div className="text-center text-sm text-[#767575] mt-4">
            Already have an account?{" "}
            <Link to="/login" className="text-[#aeb7c5] hover:text-[#d9dde4] transition hover:underline">
              Sign in
            </Link>
          </div>

          <div className="relative flex items-center py-1">
            <div className="flex-1 border-t border-[#484848]/30" />
            <span className="px-3 text-[11px] uppercase tracking-[0.08em] text-[#767575]">or</span>
            <div className="flex-1 border-t border-[#484848]/30" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full h-11 flex items-center justify-center gap-2 border border-[#484848]/40 text-[#e7e5e5] rounded-xl hover:bg-[#191a1a] transition disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}

// Convert Firebase error codes to human-readable messages
function getFriendlyError(code) {
  const errors = {
    "auth/email-already-in-use": "This email is already registered. Please sign in.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/popup-closed-by-user": "Google sign-up was cancelled.",
    "auth/too-many-requests": "Too many attempts. Please try again shortly.",
  };
  return errors[code] || "Something went wrong. Please try again.";
}
