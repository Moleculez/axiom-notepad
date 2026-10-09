"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, Checkbox, NativeSelect, TextInput } from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import type { Annotation } from "@axiom/shared/research";
import type { PdfPageChoice } from "@axiom/shared/pdf-reader";
import { mapPdfAnnotation } from "@axiom/shared/pdf-annotations";
import { UPLOAD_CHUNK_BYTES } from "@axiom/shared/workspace";
import { api, ApiError, download } from "../../lib/client";
import type { PaperMeta } from "../../lib/research-store";
import Dialog from "../Dialog";

type Target = {
  id: string;
  name: string;
  current_version_id: string;
  version: number;
  space_id: string;
  parent_id: string | null;
};
type SaveStatus =
  | { kind: "uploading"; progress: number }
  | { kind: "verifying" | "saved" }
  | null;
export default function PdfSaveCopy({
  bytes,
  meta,
  pages,
  annotations,
  operation = "organize",
  onClose,
}: {
  bytes: Uint8Array;
  meta: PaperMeta;
  pages?: PdfPageChoice[];
  annotations: Annotation[];
  operation?: "organize" | "annotated-copy" | "ocr";
  onClose: () => void;
}) {
  const { t } = useInterfaceLocale();
  const [mode, setMode] = useState("copy"),
    [name, setName] = useState(meta.name.replace(/\.pdf$/i, "") + "-copy.pdf");
  const [target, setTarget] = useState<Target | null>(null),
    [spaces, setSpaces] = useState<
      { id: string; name: string; role: string }[]
    >([]);
  const [space, setSpace] = useState(meta.space_id ?? ""),
    [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]),
    [filter, setFilter] = useState("");
  const [include, setInclude] = useState(false),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [status, setStatus] = useState<SaveStatus>(null),
    [saved, setSaved] = useState("");
  const upload = useRef<string | null>(null),
    uploadInput = useRef<Record<string, unknown> | null>(null),
    recovering = useRef(false),
    abort = useRef<AbortController | null>(null);
  const [locked, setLocked] = useState(false),
    [recoverable, setRecoverable] = useState(false);
  const parent = trail.at(-1)?.id ?? null;
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api<Target>(`resources/${meta.resource_id}`, {
        signal: controller.signal,
      }),
      api<typeof spaces>("spaces", { signal: controller.signal }),
    ])
      .then(([r, s]) => {
        setTarget(r);
        setSpaces(s.filter((s) => s.role === "editor"));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, [meta.resource_id]);
  useEffect(() => {
    if (!space) return;
    const controller = new AbortController();
    setFolders([]);
    const query = new URLSearchParams({
      spaceId: space,
      kind: "folder",
      limit: "100",
      ...(parent ? { parentId: parent } : {}),
      ...(filter ? { q: filter } : {}),
    });
    void api<{ items: { id: string; name: string }[] }>(`resources?${query}`, {
      signal: controller.signal,
    })
      .then((v) => setFolders(v.items))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [space, parent, filter]);
  const omitted = pages
    ? annotations.reduce(
        (n, a) => n + mapPdfAnnotation(a.data, pages, meta.sha256).omitted,
        0,
      )
    : 0;
  const save = async (recover = false) => {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const signal = controller.signal;
      if ((recover || recovering.current) && upload.current) {
        recovering.current = true;
        const state = await api(`uploads/${upload.current}`, { signal });
        if (state.status === "failed") {
          await api(`uploads/${upload.current}/save-copy`, {
            method: "POST",
            signal,
            body: JSON.stringify({ name, parentId: target.parent_id }),
          });
        } else if (!["complete", "verifying"].includes(state.status)) {
          throw new Error(
            t(
              "This upload cannot be recovered. Download your prepared PDF below.",
            ),
          );
        }
      } else {
        upload.current ??= crypto.randomUUID();
        const sha256 = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
          ),
          (x) => x.toString(16).padStart(2, "0"),
        ).join("");
        uploadInput.current ??= {
          id: upload.current,
          spaceId: mode === "version" ? target.space_id : space,
          parentId: mode === "version" ? target.parent_id : parent,
          resourceId: mode === "version" ? target.id : undefined,
          expectedVersionId: mode === "version" ? meta.id : undefined,
          expectedResourceVersion:
            mode === "version" ? target.version : undefined,
          name,
          bytes: bytes.length,
          sha256,
          provenance: {
            sourceVersionId: meta.id,
            sourceSha256: meta.sha256,
            operation,
            pages: pages?.map(({ source, page, rotation }) => ({
              source,
              page,
              rotation,
            })),
            annotations: include
              ? annotations.map((a) => ({ id: a.id, version: a.version }))
              : [],
            acknowledgeOmissions: ack,
          },
        };
        setLocked(true);
        let state: { status: string };
        try {
          state = await api("uploads", {
            method: "POST",
            signal,
            body: JSON.stringify(uploadInput.current),
          });
        } catch (e) {
          // An explicit validation rejection did not create an upload. Network
          // errors retain the exact operation, so Retry cannot create duplicates.
          if (
            e instanceof ApiError &&
            [400, 403, 404, 409, 413, 422].includes(e.status)
          ) {
            upload.current = null;
            uploadInput.current = null;
            setLocked(false);
          }
          throw e;
        }
        if (state.status === "uploading") {
          const received = await api<{ chunks: { part: number }[] }>(
            `uploads/${upload.current}`,
            { signal },
          );
          const parts = new Set(received.chunks.map((c) => c.part));
          for (
            let offset = 0;
            offset < bytes.length;
            offset += UPLOAD_CHUNK_BYTES
          ) {
            if (parts.has(offset / UPLOAD_CHUNK_BYTES + 1)) continue;
            setStatus({
              kind: "uploading",
              progress: Math.round((offset / bytes.length) * 100) / 100,
            });
            await api(
              `uploads/${upload.current}/chunks/${offset / UPLOAD_CHUNK_BYTES + 1}`,
              {
                method: "PUT",
                signal,
                headers: { "content-type": "application/octet-stream" },
                body: new Uint8Array(
                  bytes.slice(offset, offset + UPLOAD_CHUNK_BYTES),
                ),
              },
            );
          }
          await api(`uploads/${upload.current}/complete`, {
            method: "POST",
            signal,
            body: "{}",
          });
        }
      }
      setStatus({ kind: "verifying" });
      for (let attempt = 0; attempt < 120; attempt++) {
        signal.throwIfAborted();
        const result = await api(`uploads/${upload.current}`, { signal });
        if (result.status === "complete") {
          setSaved(result.resourceId);
          setStatus({ kind: "saved" });
          return;
        }
        if (result.status === "failed" || result.status === "cancelled") {
          setRecoverable(result.status === "failed" && mode === "version");
          throw new Error(
            result.error ||
              t("Saving stopped. Your prepared PDF remains available here."),
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(
        t(
          "Verification is still running. Check File transfers before starting another save.",
        ),
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setError((e as Error).message);
        setStatus(null);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={uiText("Save PDF")}
      subtitle={uiText("An immutable copy with explicit annotation transfer")}
      className="pdf-save-dialog"
      onClose={onClose}
    >
      <label>
        <I18nText id="Save as" />
        <NativeSelect
          disabled={busy || locked || !!saved}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="copy">
            <I18nText id="New file" />
          </option>
          <option
            value="version"
            disabled={
              target?.current_version_id !== meta.id ||
              meta.content_role !== "editor"
            }
          >
            <I18nText id="New version of this file" />
          </option>
        </NativeSelect>
      </label>
      <label>
        <I18nText id="File name" />
        <TextInput
          value={name}
          disabled={busy || locked || !!saved}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {mode === "copy" && (
        <fieldset disabled={busy || locked || !!saved}>
          <legend>
            <I18nText id="Destination" />
          </legend>
          <label>
            <I18nText id="Space" />
            <NativeSelect
              value={space}
              onChange={(e) => {
                setSpace(e.target.value);
                setTrail([]);
              }}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="pdf-save-folders">
            <button onClick={() => setTrail([])}>
              <I18nText id="Root" />
            </button>
            {trail.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setTrail(trail.slice(0, i + 1))}
              >
                / {p.name}
              </button>
            ))}
          </div>
          <TextInput
            aria-label={uiText("Filter destination folders")}
            placeholder={uiText("Find a folder…")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="pdf-save-folders">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setTrail([...trail, f]);
                  setFilter("");
                }}
              >
                {f.name} →
              </button>
            ))}
          </div>
          <small>
            <I18nText id="First 100 matching folders. Filter to narrow results." />
          </small>
        </fieldset>
      )}
      {!!annotations.length && (
        <label className="pdf-save-option">
          <Checkbox
            checked={include}
            disabled={busy || locked || annotations.length > 500 || !!saved}
            onChange={(e) => setInclude(e.target.checked)}
          />
          <I18nText
            id="Copy {count, plural, one {# visible annotation as a private note} other {# visible annotations as private notes}}"
            values={{ count: annotations.length }}
          />
        </label>
      )}
      {include && (
        <p className="muted">
          <I18nText id="Authorship labels are retained. Existing discussions stay with the source; sharing these copies is a separate action." />
        </p>
      )}
      {include && omitted > 0 && (
        <label className="pdf-save-option">
          <Checkbox
            checked={ack}
            disabled={busy || locked}
            onChange={(e) => setAck(e.target.checked)}
          />
          <I18nText
            id="I understand {count, plural, one {# annotation page segment will be omitted.} other {# annotation page segments will be omitted.}}"
            values={{ count: omitted }}
          />
        </label>
      )}
      {error && (
        <div>
          <p role="alert" className="form-error">
            {error}
          </p>
          <button
            onClick={() =>
              download(name, new Uint8Array(bytes), "application/pdf")
            }
          >
            <I18nText id="Download prepared PDF" />
          </button>
        </div>
      )}
      <p role="status">
        {status &&
          (status.kind === "uploading"
            ? t("Uploading {progress, number, percent}", {
                progress: status.progress,
              })
            : status.kind === "verifying"
              ? t("Verifying and saving…")
              : t("Saved. The original version is unchanged."))}
      </p>
      <div className="dialog-footer">
        <Button className="button secondary" onClick={onClose}>
          {busy ? uiText("Close (upload may continue)") : uiText("Close")}
        </Button>
        {saved ? (
          <a className="button primary" href={`/workbench/notes/${saved}`}>
            <I18nText id="Open saved PDF" />
          </a>
        ) : (
          <>
            <Button
              className="button primary"
              disabled={
                busy ||
                !target ||
                !name.trim() ||
                !space ||
                (include && omitted > 0 && !ack)
              }
              onClick={() => void save()}
            >
              {busy
                ? uiText("Saving…")
                : locked
                  ? uiText("Retry / check save")
                  : uiText("Save PDF")}
            </Button>
            {recoverable && upload.current && mode === "version" && (
              <Button
                className="button secondary"
                onClick={() => void save(true)}
                disabled={busy}
              >
                <I18nText id="Recover as separate copy" />
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
