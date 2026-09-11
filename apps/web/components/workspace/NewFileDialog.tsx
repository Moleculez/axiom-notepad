"use client";
import { useState } from "react";
import { fileTypes, type FileType } from "@axiom/shared/file-types";
import { post } from "../../lib/client";
import Dialog from "../Dialog";
import { ErrorNotice, useWorkspace } from "./ui";
export default function NewFileDialog({ type, target, onClose }: { type: FileType; target: { spaceId: string; parentId: string | null }; onClose: () => void }) {
  const { open, navigate, refresh } = useWorkspace(), [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [mutationId] = useState(() => crypto.randomUUID()), info = fileTypes.find(t => t.id === type)!;
  return <Dialog title={`New ${info.label.toLowerCase()}`} subtitle={info.description} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(""); try { const result = await post("files/new", { type, name: name.trim() || `Untitled.${info.extension}`, ...target, mutationId }); refresh(); onClose(); if (type === "markdown" || ["docx","xlsx","pptx"].includes(type)) open({ id: result.id, kind: type === "markdown" ? "note" : "file" }); else navigate(`/tools/${["csv","json","yaml"].includes(type) ? "text" : type}/${result.id}`); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }}><label>Name<input autoFocus value={name} maxLength={150} placeholder={`Untitled.${info.extension}`} onChange={e => setName(e.target.value)} /></label><ErrorNotice message={error} /><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create"}</button></div></form></Dialog>;
}
