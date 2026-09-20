"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";

export default function LoginPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    setInfo(null);
    setBusy(true);
    const err = await signInWithGoogle();
    if (err) setError(err);
    setBusy(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);

    if (mode === "login") {
      const err = await signIn(email.trim(), password);
      if (err) setError(err);
    } else {
      // Requirement #3: after signup, land back on the login form with
      // credentials prefilled so the user must sign in explicitly.
      const err = await signUp(email.trim(), password, fullName.trim());
      if (err) {
        setError(err);
      } else {
        setMode("login");
        setInfo("Account created. Please sign in to continue.");
      }
    }
    setBusy(false);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 grid place-items-center shadow-glow">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"
                stroke="#052e1a"
                strokeWidth="1.6"
                strokeLinejoin="round"
                fill="rgba(255,255,255,0.15)"
              />
              <path
                d="M9 12l2 2 4-4"
                stroke="#052e1a"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="text-xl font-semibold" style={{ color: "var(--text-strong)" }}>
              FinGuard <span className="text-emerald-400">Intelligence</span>
            </div>
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--muted-2)" }}>
              Transaction analysis console
            </div>
          </div>
        </div>

        <div
          className="rounded-2xl p-6 border"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-strong)" }}>
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: "var(--muted-2)" }}>
              {mode === "login"
                ? "Sign in with your email and password"
                : "Sign up to start analyzing transactions"}
            </p>
          </div>

          {info && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
              {info}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 rounded-xl border py-2.5 px-4 text-[14px] font-medium transition hover:brightness-110 disabled:opacity-50"
            style={{
              background: "var(--chip)",
              borderColor: "var(--border)",
              color: "var(--text-strong)",
            }}
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="relative my-5 flex items-center justify-center">
            <div className="w-full border-t" style={{ borderColor: "var(--border)" }} />
            <span
              className="absolute px-2 text-[11px] uppercase tracking-wider"
              style={{ background: "var(--panel)", color: "var(--muted-2)" }}
            >
              Or
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Your name" />
            )}
            <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" />
            <Field
              label="Password"
              value={password}
              onChange={setPassword}
              type="password"
              placeholder="At least 6 characters"
            />

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 py-2.5 text-[14px] font-medium shadow-glow transition disabled:opacity-50"
            >
              {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="my-5 h-px" style={{ background: "var(--border)" }} />

          <p className="text-center text-[13px]" style={{ color: "var(--muted-2)" }}>
            {mode === "login" ? "New to FinGuard?" : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
                setInfo(null);
              }}
              className="text-emerald-300 hover:underline"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        className="block text-[12px] uppercase tracking-widest mb-1.5"
        style={{ color: "var(--muted-2)" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        minLength={type === "password" ? 6 : undefined}
        className="w-full rounded-lg border px-3 py-2.5 text-[14px] outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 transition"
        style={{
          background: "var(--chip)",
          borderColor: "var(--border)",
          color: "var(--text)",
        }}
      />
    </div>
  );
}
