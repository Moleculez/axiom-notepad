"use client";
import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { post } from "../lib/client";

export default function DevelopmentSetup({
  completed,
}: {
  completed: () => void;
}) {
  const [token, setToken] = useState(""),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [group, setGroup] = useState("Research group"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="development-setup">
      <section className="development-setup-card">
        <span className="brand-mark">a</span>
        <span className="eyebrow">LOCAL DEVELOPMENT · FIRST RUN</span>
        <h1>A fresh space for your research</h1>
        <p>
          Create your own owner account and an empty group. No demo files or
          shared default passwords are added.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            void post("development-setup", {
              token,
              name,
              email,
              password,
              groupName: group,
            })
              .then(completed)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            One-time setup token
            <input
              autoFocus
              aria-label="One-time setup token"
              type="password"
              required
              minLength={32}
              maxLength={200}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <small>
              Read the protected local file printed by the development reset
              command.
            </small>
          </label>
          <div className="canvas-property-pair">
            <label>
              Your name
              <input
                aria-label="Your name"
                autoComplete="name"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Email
              <input
                aria-label="Owner email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <label>
            Password
            <input
              aria-label="Owner password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small>At least 12 characters. Use a unique password.</small>
          </label>
          <label>
            Group name
            <input
              aria-label="Initial group name"
              required
              maxLength={160}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="development-setup-error">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Creating your workspace…" : "Create owner and group"}
            <ArrowRight size={16} />
          </button>
          <p className="ws-note">
            <LockKeyhole size={13} /> Local-only setup closes permanently after
            completion. Sign in normally afterward.
          </p>
        </form>
      </section>
    </main>
  );
}
