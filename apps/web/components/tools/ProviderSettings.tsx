"use client";
import { useState } from "react";
import {
  Plus,
  Server,
  Cloud,
  ShieldCheck,
  Save,
  FlaskConical,
} from "lucide-react";
import { api, post } from "../../lib/client";
import { ErrorNotice, Loading, useData, useWorkspace } from "../workspace/ui";
import Dialog from "../Dialog";
type Provider = {
  id: string;
  name: string;
  kind: "private" | "openrouter";
  endpoint: string;
  model: string;
  capabilities: string[];
  enabled: boolean;
  daily_limit: number;
  version: number;
  used_today: number;
};
export default function ProviderSettings({ groupId }: { groupId: string }) {
  const data = useData<{ configured: boolean; providers: Provider[] }>(
      `group-admin/${groupId}/providers`,
    ),
    { notify } = useWorkspace();
  const [edit, setEdit] = useState<Provider | null | "new">(null),
    [name, setName] = useState(""),
    [kind, setKind] = useState<Provider["kind"]>("private"),
    [endpoint, setEndpoint] = useState(""),
    [model, setModel] = useState(""),
    [credential, setCredential] = useState(""),
    [ocr, setOcr] = useState(false),
    [paper, setPaper] = useState(false),
    [assistant, setAssistant] = useState(false),
    [enabled, setEnabled] = useState(false),
    [limit, setLimit] = useState(25),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const open = (p: Provider | null) => {
    setEdit(p ?? "new");
    setName(p?.name ?? "");
    setKind(p?.kind ?? "private");
    setEndpoint(p?.endpoint ?? "");
    setModel(p?.model ?? "");
    setCredential("");
    setOcr(p?.capabilities.includes("ocr") ?? false);
    setPaper(p?.capabilities.includes("paper") ?? false);
    setAssistant(p?.capabilities.includes("assistant") ?? false);
    setEnabled(p?.enabled ?? false);
    setLimit(p?.daily_limit ?? 25);
    setError("");
  };
  return (
    <section className="provider-settings">
      <div className="tools-section-heading">
        <div>
          <h2>
            <ShieldCheck size={19} />
            Research processing providers
          </h2>
          <p className="ws-note">
            Explicit submission only. API keys stay encrypted on the server;
            research prompts are never included in administrative activity logs.
          </p>
        </div>
        <button
          className="button primary"
          disabled={!data.data?.configured}
          onClick={() => open(null)}
        >
          <Plus size={16} />
          Add provider
        </button>
      </div>
      <ErrorNotice message={error || data.error} />
      {data.loading ? (
        <Loading />
      ) : !data.data?.configured ? (
        <p className="ws-note">
          Server setup required: configure the dedicated TOOL_PROVIDER_KEY
          encryption key. Private endpoint origins must also be allowlisted. No
          external processing is enabled by default.
        </p>
      ) : data.data?.providers.length ? (
        <div className="tool-project-list">
          {data.data.providers.map((p) => (
            <div className="tool-project-row" key={p.id}>
              {p.kind === "private" ? (
                <Server size={20} />
              ) : (
                <Cloud size={20} />
              )}
              <strong>
                {p.name}
                <small className="provider-subtitle">
                  {p.model} · {p.capabilities.join(", ")}
                </small>
              </strong>
              <span>
                {p.enabled ? "Enabled" : "Disabled"} · {p.used_today}/
                {p.daily_limit} today (UTC)
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void post(`group-admin/${groupId}/providers/${p.id}/test`, {})
                    .then(() =>
                      notify(
                        "Provider connection test succeeded. No research content was sent.",
                      ),
                    )
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                <FlaskConical size={14} />
                Test
              </button>
              <button className="button secondary" onClick={() => open(p)}>
                Configure
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="ws-note">
          No providers configured. Add a private compatible endpoint or an
          OpenRouter account for opt-in OCR and mathematical assistance.
        </p>
      )}
      {edit && (
        <Dialog
          title={
            edit === "new"
              ? "Add processing provider"
              : "Configure processing provider"
          }
          onClose={() => {
            setEdit(null);
            setCredential("");
          }}
        >
          <form
            className="tool-settings-fields provider-form"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              void api(
                `group-admin/${groupId}/providers${edit !== "new" ? `/${edit.id}` : ""}`,
                {
                  method: edit === "new" ? "POST" : "PATCH",
                  body: JSON.stringify({
                    name,
                    kind,
                    endpoint,
                    model,
                    credential: credential || undefined,
                    capabilities: [
                      "math",
                      ...(ocr ? ["ocr"] : []),
                      ...(paper ? ["paper"] : []),
                      ...(assistant ? ["assistant"] : []),
                    ],
                    enabled,
                    dailyLimit: limit,
                    version: edit !== "new" ? edit.version : undefined,
                  }),
                },
              )
                .then(() => {
                  setCredential("");
                  setEdit(null);
                  data.reload();
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Name
              <input
                required
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Connection
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Provider["kind"])}
              >
                <option value="private">Private compatible endpoint</option>
                <option value="openrouter">
                  OpenRouter · external service
                </option>
              </select>
            </label>
            {kind === "private" && (
              <label>
                API endpoint
                <input
                  required
                  type="url"
                  placeholder="http://private-inference:8000/v1/"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </label>
            )}
            <label>
              Model identifier
              <input
                required
                value={model}
                maxLength={160}
                autoComplete="off"
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label>
              API credential
              <input
                type="password"
                required={edit === "new"}
                autoComplete="new-password"
                value={credential}
                placeholder={
                  edit !== "new"
                    ? "Leave empty to retain stored credential"
                    : ""
                }
                onChange={(e) => setCredential(e.target.value)}
              />
            </label>
            <label>
              Daily request limit
              <input
                type="number"
                min={1}
                max={10000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={ocr}
                onChange={(e) => setOcr(e.target.checked)}
              />
              Model accepts images for OCR
            </label>
            <label>
              <input
                type="checkbox"
                checked={paper}
                onChange={(e) => setPaper(e.target.checked)}
              />
              Enable paper reading assistance (explicit excerpts only)
            </label>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enable for this group
            </label>
            <label>
              <input
                type="checkbox"
                checked={assistant}
                onChange={(e) => setAssistant(e.target.checked)}
              />
              Enable workspace assistant (reviewed context and proposals)
            </label>
            <p className="ws-note">
              Enabling does not send any material. Each researcher chooses this
              provider and confirms the exact text/image before submitting.
              Provider billing and retention policies still apply.
            </p>
            <ErrorNotice message={error} />
            <button className="button primary" disabled={busy}>
              <Save size={15} />
              {busy ? "Saving…" : "Save provider"}
            </button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
