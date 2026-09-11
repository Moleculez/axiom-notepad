"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  LockKeyhole,
  Atom,
  Sigma,
  Check,
  LoaderCircle,
} from "lucide-react";
import { api, post, finishPendingSignOut, authRequest } from "../lib/client";
export default function Auth({
  onSignedIn,
  onPasswordReset,
}: {
  onSignedIn: () => void;
  onPasswordReset?: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"login" | "invite" | "forgot" | "reset">(
      "login",
    ),
    [token, setToken] = useState(""),
    [groupName, setGroupName] = useState(""),
    [message, setMessage] = useState("");
  const [twoFactor, setTwoFactor] = useState(false),
    [recovery, setRecovery] = useState(false),
    [code, setCode] = useState(""),
    [institution, setInstitution] = useState<{
      enabled: boolean;
      name: string;
    } | null>(null);
  useEffect(() => {
    void api("identity")
      .then(setInstitution)
      .catch(() => {});
    const params = new URLSearchParams(location.search);
    if (params.has("invite")) {
      const value = params.get("invite")!;
      setToken(value);
      setMode("invite");
      api(`invitation?token=${encodeURIComponent(value)}`)
        .then((data) => {
          setEmail(data.email);
          setGroupName(data.groupName);
        })
        .catch((e) => setError(e.message));
    }
    if (
      params.has("reset") ||
      (params.has("reset-flow") && params.has("token"))
    ) {
      setToken(params.get("reset") ?? params.get("token")!);
      setMode("reset");
    }
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!(await finishPendingSignOut()))
        throw new Error(
          "Reconnect to finish signing out before signing in again.",
        );
      if (twoFactor) {
        await authRequest(
          recovery ? "two-factor/verify-backup-code" : "two-factor/verify-totp",
          { code: code.trim(), trustDevice: false },
        );
        setCode("");
        setPassword("");
        onSignedIn();
        return;
      }
      if (mode === "invite") {
        await post("register", { token, name, password });
        history.replaceState(null, "", "/");
        onSignedIn();
        return;
      }
      const endpoint =
        mode === "forgot"
          ? "request-password-reset"
          : mode === "reset"
            ? "reset-password"
            : "sign-in/email";
      const body =
        mode === "forgot"
          ? { email, redirectTo: location.origin + "/?reset-flow=1" }
          : mode === "reset"
            ? { token, newPassword: password }
            : { email, password };
      const response = await fetch("/api/auth/" + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Sign in failed.");
      if (mode === "forgot")
        setMessage(
          "If email delivery is configured, a recovery link will arrive shortly. Otherwise, contact your group administrator.",
        );
      else if (mode === "reset") {
        setMode("login");
        setPassword("");
        setToken("");
        setMessage("Password updated. You can sign in now.");
        // The server revoked the old session. Keep this Auth instance mounted
        // while removing the secret URL, rather than routing through / and
        // losing the success notice (or briefly showing the old workspace).
        onPasswordReset?.();
        history.replaceState(null, "", location.pathname);
      } else if (data.twoFactorRedirect) {
        setTwoFactor(true);
        setPassword("");
        setCode("");
      } else onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">a</span>
          <span>
            Axiom<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="auth-story-content">
          <div className="eyebrow">A SHARED SPACE FOR RESEARCH</div>
          <h1>
            Good ideas
            <br />
            rarely happen
            <br />
            <em>in isolation.</em>
          </h1>
          <p>
            Write, connect, and think together.
            <br />A quieter home for your group’s work.
          </p>
          <div className="auth-equation">
            <span className="equation-annotation">a common language</span>
            <div>δS = 0</div>
            <svg viewBox="0 0 320 100" aria-hidden="true">
              <path
                d="M10 85 C90 85 80 20 160 40 S250 10 310 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle cx="160" cy="40" r="4" fill="currentColor" />
              <path
                d="M160 10V90M10 85H310"
                fill="none"
                stroke="currentColor"
                strokeWidth=".5"
                opacity=".3"
              />
            </svg>
            <span className="equation-footnote">
              From first principles to the next question.
            </span>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>
            <Sigma size={16} /> Mathematics
          </span>
          <span>
            <Atom size={16} /> Physics
          </span>
          <span>
            <ArrowUpRight size={16} /> Machine learning
          </span>
        </div>
      </section>
      <section className="auth-form-area">
        <div className="auth-form-card">
          <div className="eyebrow">YOUR RESEARCH, CONNECTED</div>
          <h2>
            {twoFactor
              ? "One more step."
              : mode === "invite"
                ? "Join the conversation."
                : mode === "forgot"
                  ? "Find your way back."
                  : mode === "reset"
                    ? "A fresh start."
                    : "Welcome back."}
          </h2>
          <p className="muted">
            {twoFactor
              ? recovery
                ? "Enter one of your unused recovery codes."
                : "Enter the six-digit code from your authenticator app."
              : mode === "invite"
                ? `You’ve been invited to ${groupName || "a research group"}.`
                : mode === "forgot"
                  ? "Enter the email associated with your account."
                  : mode === "reset"
                    ? "Choose a new password for your account."
                    : "Sign in to your research workspace."}
          </p>
          <form onSubmit={submit}>
            {mode === "invite" && (
              <label>
                Your name
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Ada Lovelace"
                />
              </label>
            )}
            {!twoFactor && mode !== "reset" && (
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={mode === "invite"}
                  required
                  placeholder="you@research.org"
                />
              </label>
            )}
            {!twoFactor && mode !== "forgot" && (
              <label htmlFor="account-password">
                <span className="label-row">
                  Password
                  {mode === "login" && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setMode("forgot");
                        setError("");
                      }}
                    >
                      Forgot password?
                    </button>
                  )}
                </span>
                <input
                  id="account-password"
                  aria-label="Password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={mode === "login" ? 1 : 12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder={
                    mode === "login"
                      ? "Enter your password"
                      : "At least 12 characters"
                  }
                />
              </label>
            )}
            {twoFactor && (
              <label>
                {recovery ? "Recovery code" : "Authenticator code"}
                <input
                  autoFocus
                  required
                  aria-label={recovery ? "Recovery code" : "Authenticator code"}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode={recovery ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  maxLength={recovery ? 100 : 6}
                  pattern={recovery ? undefined : "[0-9]{6}"}
                />
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setRecovery(!recovery);
                    setCode("");
                    setError("");
                  }}
                >
                  {recovery
                    ? "Use an authenticator code"
                    : "Use a recovery code instead"}
                </button>
              </label>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {message && (
              <div className="form-success" role="status">
                <Check size={16} />
                {message}
              </div>
            )}
            <button
              className="button primary auth-submit"
              disabled={busy || (mode === "invite" && !groupName)}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <>
                  {twoFactor
                    ? "Verify and sign in"
                    : mode === "invite"
                      ? "Create account & join"
                      : mode === "forgot"
                        ? "Send recovery link"
                        : mode === "reset"
                          ? "Update password"
                          : "Enter workspace"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          {mode === "login" && !twoFactor && institution?.enabled && (
            <button
              className="button secondary auth-submit"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void authRequest("sign-in/social", {
                  provider: "institution",
                  callbackURL: location.origin + "/workbench/home",
                })
                  .then((result) => {
                    if (!result.url)
                      throw new Error("Institutional sign-in is unavailable.");
                    location.assign(result.url);
                  })
                  .catch((error) => {
                    setError(error.message);
                    setBusy(false);
                  });
              }}
            >
              Sign in with {institution.name}
            </button>
          )}
          {twoFactor && (
            <button
              className="text-button back-login"
              onClick={() => {
                setTwoFactor(false);
                setCode("");
                setError("");
              }}
            >
              Return to password sign-in
            </button>
          )}
          {mode !== "login" && (
            <button
              className="text-button back-login"
              onClick={() => {
                setMode("login");
                setError("");
                setMessage("");
              }}
            >
              Already have an account? Sign in
            </button>
          )}
          <div className="invite-notice">
            <LockKeyhole size={16} />
            <span>
              Axiom is an invitation-only workspace.
              <br />
              Ask your group administrator for access.
            </span>
          </div>
        </div>
        <div className="auth-footer">
          A little less noise. A little more understanding.
        </div>
      </section>
    </main>
  );
}
