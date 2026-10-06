"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { Resource } from "@axiom/shared/workspace";
import { IMPORT_LIMITS } from "@axiom/shared/collection-path";
import { api } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import { Button, Field, HelpText, NativeSelect, Notice } from "../ui/controls";
import { ErrorNotice } from "./ui";

/** Both Explorer and file menus use the same durable export contract. */
export default function CollectionExportDialog({
  items,
  onClose,
  onQueued,
}: {
  items: Resource[];
  onClose: () => void;
  onQueued: () => void;
}) {
  const [profile, setProfile] = useState<"portable" | "standard">("portable"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const identity = useRef(crypto.randomUUID()),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const queue = async () => {
    if (controller.current || !items.length) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      await api("exports", {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify({
          mutationId: identity.current,
          spaceId: items[0].space_id,
          resourceIds: items.map((item) => item.id),
          profile,
        }),
      });
      if (!abort.signal.aborted) onQueued();
    } catch (reason) {
      if (!abort.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not queue this collection. Retry with the same selection.",
        );
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  const oversized =
    profile === "portable" &&
    items.reduce(
      (sum, item) => sum + (item.kind === "file" ? Number(item.bytes ?? 0) : 0),
      0,
    ) > IMPORT_LIMITS.zipBytes;
  return (
    <Dialog
      title="Export collection"
      subtitle="A background export. Your files and collaborators’ edits are unchanged."
      onClose={onClose}
    >
      <Field label="Archive profile" id="collection-export-profile">
        <NativeSelect
          id="collection-export-profile"
          value={profile}
          disabled={busy}
          onChange={(event) => {
            identity.current = crypto.randomUUID();
            setError("");
            setProfile(event.target.value as typeof profile);
          }}
        >
          <option value="portable">Reimportable research collection</option>
          <option value="standard">
            Standard archive · larger collections
          </option>
        </NativeSelect>
      </Field>
      <HelpText>
        {items.length} selected {items.length === 1 ? "item" : "items"},
        including folder descendants. Accessible linked assets are included;
        links never grant access. The job records a consistent snapshot when it
        runs.
      </HelpText>
      <details>
        <summary>Selected items</summary>
        <ul>
          {items.map((item) => (
            <li key={item.id}>{item.name}</li>
          ))}
        </ul>
      </details>
      {profile === "portable" ? (
        <>
          <HelpText>
            Native Markdown, Canvas, math, text and image projects, safe names,
            tags and tool settings. SHA-256 checksums are verified before
            import. Use Import ZIP or Import folder to review and restore this
            collection.
          </HelpText>
          <HelpText>
            Up to 50 MB compressed, 100 MB expanded, 25 MB of source and 1,000
            ZIP entries. Larger selections fail safely—choose a smaller
            collection or a standard archive.
          </HelpText>
          <HelpText>
            Not a workspace backup: permissions, account data, planning,
            reference-library records, discussions, annotations and history are
            excluded. Original assets can contain EXIF or other embedded
            metadata.
          </HelpText>
        </>
      ) : (
        <HelpText>
          Preserves the existing larger archive workflow. ZIP64 archives cannot
          be reimported directly; extract them locally and use Import folder
          within the inventory limits.
        </HelpText>
      )}
      {oversized && (
        <Notice tone="warning">
          The selected files alone exceed the reimportable ZIP budget. Choose a
          standard archive or reduce the selection.
        </Notice>
      )}
      <ErrorNotice message={error} />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          disabled={busy || !items.length || oversized}
          onClick={() => void queue()}
        >
          <Download size={15} />
          {busy ? "Queueing…" : "Prepare archive"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
