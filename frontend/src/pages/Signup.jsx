import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithPopup, updateProfile } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { useNavigate, useSearchParams, Link } from "react-router-dom";

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  function validate() {
    const e = {};
    if (!email.trim()) e.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email.";
    if (!password) e.password = "Password is required.";
    else if (password.length < 6) e.password = "Minimum 6 characters.";
    if (confirmPassword && password !== confirmPassword) e.confirmPassword = "Passwords don't match.";
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setServerError("");
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      navigate(nextPath, { replace: true });
    } catch (err) {
      setServerError(getFriendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setServerError("");
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setServerError(getFriendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  function field(key, value, setter) {
    return {
      value,
      onChange: (e) => {
        setter(e.target.value);
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
      },
    };
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">PingMaster</h1>
          <p className="text-sm text-[#6b6b6b] mt-1">Create your account</p>
        </div>

        {/* Card */}
        <div className="bg-[#111111] border border-[#222222] rounded-2xl p-7 space-y-4">
          {serverError && (
            <div className="bg-[#1a0f0f] border border-[#3d1a1a] text-[#f87171] rounded-lg px-4 py-3 text-sm">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Name (optional) */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-[0.08em] text-white">
                Full Name <span className="normal-case text-white">(optional)</span>
              </label>
              <input
                type="text"
                {...field("name", name, setName)}
                autoComplete="name"
                placeholder="Enter your name"
                className="w-full h-11 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm px-4 placeholder:text-[#444444] focus:outline-none focus:border-[#555555] transition"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-[0.08em] text-white">Email *</label>
              <input
                type="email"
                {...field("email", email, setEmail)}
                autoComplete="email"
                placeholder="you@example.com"
                className={`w-full h-11 rounded-xl bg-[#1a1a1a] border text-white text-sm px-4 placeholder:text-[#444444] focus:outline-none transition ${errors.email ? "border-[#7f2020]" : "border-[#2a2a2a] focus:border-[#555555]"}`}
              />
              {errors.email && <p className="text-[11px] text-[#f87171]">{errors.email}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-[0.08em] text-white">Password *</label>
              <input
                type="password"
                {...field("password", password, setPassword)}
                autoComplete="new-password"
                placeholder="Min 6 characters"
                className={`w-full h-11 rounded-xl bg-[#1a1a1a] border text-white text-sm px-4 placeholder:text-[#444444] focus:outline-none transition ${errors.password ? "border-[#7f2020]" : "border-[#2a2a2a] focus:border-[#555555]"}`}
              />
              {errors.password && <p className="text-[11px] text-[#f87171]">{errors.password}</p>}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-[0.08em] text-white">Confirm Password</label>
              <input
                type="password"
                {...field("confirmPassword", confirmPassword, setConfirmPassword)}
                autoComplete="new-password"
                placeholder="Re-enter password"
                className={`w-full h-11 rounded-xl bg-[#1a1a1a] border text-white text-sm px-4 placeholder:text-[#444444] focus:outline-none transition ${errors.confirmPassword ? "border-[#7f2020]" : "border-[#2a2a2a] focus:border-[#555555]"}`}
              />
              {errors.confirmPassword && <p className="text-[11px] text-[#f87171]">{errors.confirmPassword}</p>}
              {confirmPassword && !errors.confirmPassword && password === confirmPassword && (
                <p className="text-[11px] text-[#6ee7b7]">✓ Passwords match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-white text-black text-sm font-semibold hover:bg-[#e5e5e5] transition disabled:opacity-50"
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <p className="text-sm text-center text-[#555555]">
            Already have an account?{" "}
            <Link to="/login" className="text-white hover:text-[#cccccc] transition font-medium">
              Sign in
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
    "auth/email-already-in-use": "This email is already registered. Sign in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/popup-closed-by-user": "Google sign-up was cancelled.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
