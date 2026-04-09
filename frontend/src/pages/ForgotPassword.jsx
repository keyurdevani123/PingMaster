import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";
import { Link } from "react-router-dom";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus({ type: "", message: "" });
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setStatus({ 
        type: "success", 
        message: "Password reset link sent! Check your inbox." 
      });
      setEmail("");
    } catch (err) {
      setStatus({ 
        type: "error", 
        message: getFriendlyError(err.code) 
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-[#e7e5e5] px-6 py-10 flex flex-col items-center justify-center">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-[#e7e5e5]">
            Reset Password
          </h1>
          <p className="mt-3 text-sm text-[#acabaa]">
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        <div className="bg-[#131313] border border-[#484848]/40 rounded-xl p-7 space-y-5">
          {status.message && (
            <div className={`border rounded-lg p-3 text-sm ${
              status.type === "success" 
                ? "bg-green-500/10 border-green-500/30 text-green-400" 
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}>
              {status.message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-[11px] uppercase tracking-[0.08em] text-[#acabaa]">Email address</label>
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

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full h-11 mt-2 bg-[#c6c6c7] text-[#3f4041] font-semibold rounded-xl hover:opacity-90 transition disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>

          <div className="text-center text-sm text-[#767575] mt-4">
            Remembered your password?{" "}
            <Link to="/login" className="text-[#aeb7c5] hover:text-[#d9dde4] transition hover:underline">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function getFriendlyError(code) {
  const errors = {
    "auth/user-not-found": "No account found with this email.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
  };
  return errors[code] || "Something went wrong. Please try again.";
}
