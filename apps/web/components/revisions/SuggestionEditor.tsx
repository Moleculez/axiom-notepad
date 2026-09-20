"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Braces,
  Download,
  Eye,
  Send,
  Bold,
  Italic,
  Undo2,
  Redo2,
  Paperclip,
  Link2,
  Table2,
} from "lucide-react";
import type { Note } from "@axiom/shared/access";
import type { Space } from "@axiom/shared/workspace";
import InsertResource from "../workspace/InsertResource";
import Dialog from "../Dialog";
import TablePicker from "../TablePicker";
import { openExternalEditorLink } from "../../lib/editor-links";
import type { NativeBinding } from "@axiom/editor/binding";
import type { Suggestion } from "@axiom/shared/revisions";
import type { RenderContext } from "@axiom/markdown";
import { EditorView } from "../../lib/editor-view";
import { SuggestionProjection } from "../../lib/suggestion-projection";
import {
  SuggestionOutbox,
  type ProposalDraft,
  proposalDrafts,
  claimProposal,
} from "../../lib/suggestion-outbox";
import { download } from "../../lib/client";
import { ErrorNotice, useWorkspace } from "../workspace/ui";
import StudioSource from "../tools/StudioSource";
const MathVisual = dynamic(() => import("../tools/MathVisual"), { ssr: false });

type Props = {
  seed?: ProposalDraft;
  noteId: string;
  generation: number;
  title: string;
  accepted: NativeBinding;
  format?: "markdown" | "latex";
  proposal?: Suggestion;
  context?: RenderContext;
  insertScope?: { note: Pick<Note, "id" | "visibility">; space?: Space };
  onClose: () => void;
};
export default function SuggestionEditor(props: Props) {
  const { session, appearance, editorSettings, notify } = useWorkspace();
  const [mode, setMode] = useState<"write" | "source">("write"),
    [projection, setProjection] = useState<SuggestionProjection | null>(null),
    [status, setStatus] = useState("Opening proposal recovery…"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [source, setSource] = useState(""),
    [picker, setPicker] = useState<"file" | "note" | "table" | null>(null),
    [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    outbox = useRef<SuggestionOutbox | null>(null),
    insertion = useRef<{
      bookmark: ReturnType<NativeBinding["relative"]>;
      text: string;
    } | null>(null),
    live = useRef({ mode, message, props, appearance, editorSettings });
  live.current = { mode, message, props, appearance, editorSettings };
  useEffect(() => {
    const node = root.current,
      previous = document.activeElement as HTMLElement | null;
    const siblings = node?.parentElement
      ? ([...node.parentElement.children].filter(
          (n) => n !== node && n instanceof HTMLElement,
        ) as HTMLElement[])
      : [];
    const inert = siblings.map((n) => n.inert);
    siblings.forEach((n) => (n.inert = true));
    return () => {
      siblings.forEach((n, i) => (n.inert = inert[i]));
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let alive = true,
      projected: SuggestionProjection | null = null,
      queue: SuggestionOutbox | null = null;
    let release: (() => void) | undefined;
    void (async () => {
      const p = live.current.props;
      const drafts = await proposalDrafts(session.user.id, p.noteId);
      const local = p.seed
        ? drafts.find((d) => d.id === p.seed!.id)
        : p.proposal
          ? drafts.find(
              (d) =>
                d.id === p.proposal!.id &&
                (d.revision > d.confirmed ||
                  d.pending ||
                  d.version >= p.proposal!.version),
            )
          : drafts.find(
              (d) =>
                d.generation === p.generation &&
                (d.revision > d.confirmed || d.version === 0),
            );
      if (!alive) return;
      const initial =
        local ??
        p.seed ??
        (p.proposal
          ? { hunks: p.proposal.hunks, source: p.accepted.source }
          : undefined);
      const changed = () => {
        if (!projected || !queue) return;
        setSource(projected.source);
        view.current?.configure();
        if (projected.conflict)
          setError(
            projected.conflict +
              " The complete local proposal is retained. Export it before starting another review.",
          );
        else
          queue.update({
            source: projected.source,
            hunks: projected.hunks,
            message: live.current.message,
          });
      };
      projected = new SuggestionProjection(p.accepted, changed, initial);
      const draft: ProposalDraft = local ??
        p.seed ?? {
          id: p.proposal?.id ?? crypto.randomUUID(),
          noteId: p.noteId,
          generation: p.proposal?.generation ?? p.generation,
          source: projected.source,
          hunks: projected.hunks,
          message: p.proposal?.message ?? "",
          version: p.proposal?.version ?? 0,
          revision: 0,
          confirmed: 0,
          updatedAt: new Date().toISOString(),
        };
      if (draft.generation !== p.generation)
        projected.conflict =
          "This proposal belongs to an earlier restored document.";
      release = await claimProposal(session.user.id, draft.id);
      if (!alive) {
        release();
        projected.destroy();
        return;
      }
      setMessage(draft.message);
      live.current.message = draft.message;
      queue = new SuggestionOutbox(session.user.id, draft, (value) => {
        if (alive) setStatus(value);
      });
      outbox.current = queue;
      setProjection(projected);
      setSource(projected.source);
      setStatus(
        draft.version
          ? "Published proposal · author revision"
          : "Suggesting · accepted document remains unchanged",
      );
      if (projected.conflict) setError(projected.conflict);
    })().catch((e) => {
      if (alive)
        setError("Cannot open durable proposal recovery: " + e.message);
    });
    return () => {
      alive = false;
      queue?.destroy();
      // Release only after the last queued local write has completed.
      if (queue)
        void queue
          .localFlush()
          .catch(() => {})
          .finally(() => release?.());
      else release?.();
      projected?.destroy();
      outbox.current = null;
    };
  }, [
    props.accepted,
    props.noteId,
    props.generation,
    props.proposal?.id,
    props.seed?.id,
    session.user.id,
  ]);
  useEffect(() => {
    if (!projection || !host.current || props.format === "latex") return;
    const editor = new EditorView(host.current, projection, {
      mode: () => live.current.mode,
      preferences: () => live.current.editorSettings.preferences,
      appearance: () => live.current.appearance.effective,
      context: () => live.current.props.context ?? {},
      readOnly: () => !!projection.conflict,
      workspace: (id) => {
        if (id === "source")
          setMode((m) => (m === "write" ? "source" : "write"));
        else if (id === "attachment") setPicker("file");
        else if (id === "table") setPicker("table");
        else if (id === "searchNotes") {
          prepare();
          setPicker("note");
        } else if (id === "comment")
          root.current
            ?.querySelector<HTMLInputElement>(".suggestion-message input")
            ?.focus();
        else
          notify(
            "This navigation command is available in the accepted document. Your proposal remains separate.",
          );
      },
      message: setError,
      recover: (source) => {
        download(props.title + "-proposal-recovery.md", source);
        return true;
      },
      prepare: (range) => prepare(range),
      link: (target) => {
        if (!openExternalEditorLink(target))
          notify(
            "Open note links from the accepted document; your proposal is retained here.",
          );
      },
      navigate: () => {},
      notes: () => [],
      changed: (source) => setSource(source),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [projection, props.format]);
  useEffect(() => {
    view.current?.configure();
  }, [mode, appearance.effective, editorSettings.preferences]);
  const prepare = (range?: { from: number; to: number }) => {
    if (!projection || !view.current) return;
    const { anchor, head } = view.current.selection,
      from = range?.from ?? Math.min(anchor, head),
      to = range?.to ?? Math.max(anchor, head);
    insertion.current = {
      bookmark: projection.relative({ anchor: from, head: to }),
      text: projection.source.slice(from, to),
    };
  };
  const insertionRange = () => {
    const pending = insertion.current;
    if (!pending || !projection || projection.conflict) return null;
    const selection = projection.absolute(pending.bookmark);
    if (
      !selection ||
      projection.source.slice(selection.anchor, selection.head) !== pending.text
    ) {
      setError(
        "The insertion position changed. Close the picker and choose a new position.",
      );
      return null;
    }
    return { from: selection.anchor, to: selection.head };
  };
  const insert = (value: string) => {
    const range = insertionRange();
    if (!range || !projection) return;
    projection.transact({
      kind: "command",
      changes: [{ ...range, insert: value }],
      selection: {
        anchor: range.from + value.length,
        head: range.from + value.length,
      },
    });
    insertion.current = null;
    setPicker(null);
    requestAnimationFrame(() => view.current?.focus(range.from + value.length));
  };
  const close = async () => {
    try {
      await outbox.current?.localFlush();
      props.onClose();
    } catch (e) {
      setError((e as Error).message + " Export the proposal before closing.");
    }
  };
  return (
    <div
      className="revision-workspace suggestion-workspace"
      ref={root}
      role="region"
      aria-label="Suggesting edits"
    >
      <header className="revision-header">
        <button
          className="icon-button"
          aria-label="Return to accepted document"
          onClick={() => void close()}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2>Suggesting · {props.title}</h2>
          <p role="status">{status}</p>
        </div>
        <button
          className="button ghost"
          onClick={() =>
            download(
              props.title +
                "-proposal" +
                (props.format === "latex" ? ".tex" : ".md"),
              source,
            )
          }
        >
          <Download size={15} />
          Export proposal
        </button>
        <button
          className="button secondary"
          disabled={!projection || busy || !!projection.conflict}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await outbox.current?.flush();
              notify("Proposal published. Accepted content is unchanged.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Send size={15} />
          Publish proposal
        </button>
      </header>
      <div className="revision-compare-toolbar">
        <div className="ws-segmented">
          <button
            aria-pressed={mode === "write"}
            onClick={() => setMode("write")}
          >
            <Eye size={15} />
            Visual
          </button>
          <button
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
          >
            <Braces size={15} />
            Source
          </button>
        </div>
        {props.format !== "latex" && (
          <>
            <button
              className="icon-button"
              aria-label="Bold"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view.current?.execute("bold")}
            >
              <Bold size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Italic"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view.current?.execute("italic")}
            >
              <Italic size={15} />
            </button>
            {props.insertScope && (
              <>
                <button
                  className="icon-button"
                  aria-label="Insert proposal attachment"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    prepare();
                    setPicker("file");
                  }}
                >
                  <Paperclip size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Link a note in proposal"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    prepare();
                    setPicker("note");
                  }}
                >
                  <Link2 size={15} />
                </button>
              </>
            )}
            <button
              className="icon-button"
              aria-label="Insert proposal table"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view.current?.execute("table")}
            >
              <Table2 size={15} />
            </button>
          </>
        )}
        <button
          className="icon-button"
          aria-label="Undo proposal edit"
          onClick={() => projection?.history(false)}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Redo proposal edit"
          onClick={() => projection?.history(true)}
        >
          <Redo2 size={15} />
        </button>
        <span className="revision-notice">
          Edits are proposals, not changes to the shared document.
        </span>
      </div>
      <ErrorNotice message={error} />
      {(picker === "file" || picker === "note") && props.insertScope && (
        <InsertResource
          kind={picker}
          note={props.insertScope.note}
          space={props.insertScope.space}
          onClose={() => {
            setPicker(null);
            insertion.current = null;
          }}
          onInsert={insert}
        />
      )}
      {picker === "table" && (
        <Dialog
          title="Insert proposal table"
          onClose={() => {
            setPicker(null);
            insertion.current = null;
          }}
        >
          <TablePicker
            onInsert={(rows, columns) => {
              const range = insertionRange();
              if (!range) return;
              view.current?.execute("table", { ...range, rows, columns });
              insertion.current = null;
              setPicker(null);
              requestAnimationFrame(() => view.current?.focus());
            }}
          />
        </Dialog>
      )}
      <div className="suggestion-edit-scroll">
        {props.format === "latex" ? (
          projection &&
          (mode === "source" ? (
            <StudioSource
              binding={projection}
              readOnly={!!projection.conflict}
            />
          ) : (
            <MathVisual
              binding={projection}
              readOnly={!!projection.conflict}
              onRetain={(value) =>
                download(props.title + "-proposal.tex", value)
              }
            />
          ))
        ) : (
          <div ref={host} className={"research-editor mode-" + mode} />
        )}
      </div>
      <footer className="suggestion-message">
        <label>
          Note to reviewers
          <input
            maxLength={10000}
            value={message}
            placeholder="Explain the change or cite supporting evidence"
            onChange={(e) => {
              const value = e.target.value;
              setMessage(value);
              live.current.message = value;
              if (projection)
                outbox.current?.update({
                  source: projection.source,
                  hunks: projection.hunks,
                  message: value,
                });
            }}
          />
        </label>
        <span>{source.length.toLocaleString()} characters</span>
      </footer>
    </div>
  );
}
