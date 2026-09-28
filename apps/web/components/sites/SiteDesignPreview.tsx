"use client";
import { useEffect, useState } from "react";
import type { SiteConfig } from "@axiom/shared/sites";
import { api, errorMessage } from "../../lib/client";
import { ErrorNotice } from "../workspace/ui";

export default function SiteDesignPreview({
  spaceId,
  config,
}: {
  spaceId: string;
  config: SiteConfig;
}) {
  const [view, setView] = useState<"home" | "article">("article"),
    [html, setHtml] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const payload = JSON.stringify({ config, view });
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      void api<{ html: string }>(`spaces/${spaceId}/site/design-preview`, {
        method: "POST",
        body: payload,
        signal: abort.signal,
      })
        .then((result) => {
          if (!abort.signal.aborted) {
            setHtml(result.html);
            setError("");
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(errorMessage(e));
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [payload, spaceId]);
  return (
    <aside
      className="website-design-preview website-live-specimen"
      aria-busy={busy}
    >
      <header>
        <span>Live specimen</span>
        <div className="website-preview-switch" aria-label="Preview page">
          {(["article", "home"] as const).map((item) => (
            <button
              key={item}
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {item === "article" ? "Article" : "Homepage"}
            </button>
          ))}
        </div>
      </header>
      <p className="ws-note">
        Same renderer and styles as the public site. Article text is a sample;
        no analytics run here.
      </p>
      <ErrorNotice message={error} />
      {html ? (
        <iframe
          key={html}
          title="Website design specimen"
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <p role="status">Preparing specimen…</p>
      )}
    </aside>
  );
}
