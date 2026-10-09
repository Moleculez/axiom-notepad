"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText, TextInput } from "./ui/controls";
import BrandMark from "./BrandMark";
import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { post } from "../lib/client";

export default function DevelopmentSetup({
  completed,
}: {
  completed: () => void;
}) {
  useInterfaceLocale();
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
        <BrandMark />
        <span className="eyebrow">
          <I18nText id="LOCAL DEVELOPMENT · FIRST RUN" />
        </span>
        <h1>
          <I18nText id="A fresh space for your research" />
        </h1>
        <p>
          <I18nText id="Create your own owner account and an empty group. No demo files or shared default passwords are added." />
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
            <I18nText id="One-time setup token" />
            <TextInput
              autoFocus
              aria-label={uiText("One-time setup token")}
              type="password"
              required
              minLength={32}
              maxLength={200}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <small>
              <I18nText id="Read the protected local file printed by the development reset command." />
            </small>
          </label>
          <div className="canvas-property-pair">
            <label>
              <I18nText id="Your name" />
              <TextInput
                aria-label={uiText("Your name")}
                autoComplete="name"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              <I18nText id="Email" />
              <TextInput
                aria-label={uiText("Owner email")}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <label>
            <I18nText id="Password" />
            <TextInput
              aria-label={uiText("Owner password")}
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small>
              <I18nText id="At least 12 characters. Use a unique password." />
            </small>
          </label>
          <label>
            <I18nText id="Group name" />
            <TextInput
              aria-label={uiText("Initial group name")}
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
          <Button className="button primary" disabled={busy} pending={!!busy}>
            {uiText("Create owner and group")}
            <ArrowRight size={16} />
          </Button>
          <HelpText>
            <LockKeyhole size={13} />{" "}
            <I18nText id="Local-only setup closes permanently after completion. Sign in normally afterward." />
          </HelpText>
        </form>
      </section>
    </main>
  );
}
