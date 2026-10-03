"use client";
import { Button, TextInput } from "../ui/controls";
import { useEffect, useState } from "react";
import type { Space } from "@axiom/shared/workspace";
import { api } from "../../lib/client";
import { ErrorNotice, useData } from "../workspace/ui";
export default function ReferencePrefix({ space }: { space: Space }) {
  const data = useData<{ reference_prefix: string | null }>(
    `spaces/${space.id}/reference-prefix`,
  );
  const [prefix, setPrefix] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  useEffect(() => {
    if (data.data) setPrefix(data.data.reference_prefix ?? "");
  }, [data.data]);
  return (
    <section className="settings-card">
      <h2>File reference codes</h2>
      <p>
        Give new notes and files a readable identity, such as LAB-42. Existing
        codes stay unchanged when files are renamed, moved, or the prefix
        changes.
      </p>
      <ErrorNotice message={error || data.error} />
      <form
        className="media-filter-row"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setStatus("");
          try {
            await api(`spaces/${space.id}/reference-prefix`, {
              method: "PUT",
              body: JSON.stringify({ prefix }),
            });
            data.reload();
            setStatus("Prefix saved. It applies to new files.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Prefix
          <TextInput
            aria-label="File code prefix"
            value={prefix}
            disabled={!space.can_manage}
            maxLength={12}
            pattern="[A-Z][A-Z0-9]{1,11}"
            onChange={(event) => setPrefix(event.target.value.toUpperCase())}
            placeholder="LAB"
          />
        </label>
        {space.can_manage && (
          <Button
            className="button secondary"
            disabled={busy || !/^[A-Z][A-Z0-9]{1,11}$/.test(prefix)}
          >
            Save prefix
          </Button>
        )}
      </form>
      <small role="status">
        {status ||
          "2–12 uppercase letters or digits; start with a letter. Prefixes are never reused by another workspace."}
      </small>
    </section>
  );
}
