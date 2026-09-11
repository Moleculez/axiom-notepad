"use client";
import { useEffect, useRef, useState } from "react";
import type { MathfieldElement } from "mathlive";
import type { NativeBinding } from "@axiom/editor/binding";
import { minimalChange } from "@axiom/markdown";
import { ErrorNotice, Loading } from "../workspace/ui";
import { downloadText } from "../../lib/tools/download";

/** Visual serialization is authored only by an input event, never by hydration,
 * setValue(), a remote update, or switching mode. Concurrent drafts are retained. */
export default function MathVisual({
  binding,
  readOnly,
  onRetain,
}: {
  binding: NativeBinding;
  readOnly: boolean;
  onRetain: (source: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    field = useRef<MathfieldElement | null>(null),
    readonly = useRef(readOnly),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState<string | null>(null);
  const retain = useRef(onRetain);
  retain.current = onRetain;
  readonly.current = readOnly;
  useEffect(() => {
    let alive = true,
      cleanup = () => {};
    void import("mathlive")
      .then(({ MathfieldElement }) => {
        if (!alive || !host.current) return;
        MathfieldElement.fontsDirectory = "/tool-assets/mathlive/fonts";
        MathfieldElement.soundsDirectory = null;
        const mf = new MathfieldElement();
        field.current = mf;
        host.current.append(mf);
        mf.mathVirtualKeyboardPolicy = "manual";
        mf.menuItems = [];
        mf.readOnly = readonly.current;
        mf.setAttribute("aria-label", "Visual equation editor");
        mf.setValue(binding.source, { silenceNotifications: true });
        setReady(true);
        let base = binding.source,
          focused = false,
          remote = false,
          applying = false;
        const sync = () => {
          base = binding.source;
          remote = false;
          mf.setValue(base, { silenceNotifications: true });
        };
        const focus = () => {
          focused = true;
          base = binding.source;
        };
        const blur = () => {
          focused = false;
          if (!remote) sync();
        };
        const input = () => {
          if (readonly.current) {
            sync();
            return;
          }
          const next = mf.getValue("latex");
          if (remote || binding.source !== base) {
            setConflict(next);
            retain.current(next);
            setError(
              "A collaborator changed the equation while you were editing visually. Your visual draft is retained below; the shared source was not overwritten.",
            );
            return;
          }
          if (next.length > 30000) {
            setError(
              "Equation exceeds the 30,000-character limit. Export your draft before simplifying it.",
            );
            setConflict(next);
            retain.current(next);
            return;
          }
          const change = minimalChange(base, next);
          if (change) {
            applying = true;
            try {
              binding.transact({
                kind: "typing",
                changes: [change],
                selection: {
                  anchor: change.from + change.insert.length,
                  head: change.from + change.insert.length,
                },
              });
            } finally {
              applying = false;
            }
          }
          base = binding.source;
        };
        const keys = (e: KeyboardEvent) => {
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key.toLowerCase() === "z" &&
            !e.isComposing
          ) {
            e.preventDefault();
            e.stopPropagation();
            if (!readonly.current) {
              binding.history(e.shiftKey);
              sync();
            }
          }
        };
        const pointer = (e: PointerEvent) => {
          if (e.button !== 0) return;
          // MathLive 0.110 delays keyboard focus by 60 ms. Focus its public
          // keyboard-sink part after pointer dispatch so rapid typing is not
          // delivered to the previously focused toolbar button.
          queueMicrotask(() => {
            if (!alive || !mf.isConnected) return;
            mf.shadowRoot
              ?.querySelector<HTMLElement>('[part="keyboard-sink"]')
              ?.focus({ preventScroll: true });
          });
        };
        mf.addEventListener("focus", focus);
        mf.addEventListener("blur", blur);
        mf.addEventListener("input", input);
        mf.addEventListener("keydown", keys);
        mf.addEventListener("pointerdown", pointer, true);
        const un = binding.subscribe((value, _selection, local) => {
          if (local) {
            base = value;
            if (!applying) sync();
            return;
          }
          if (focused) {
            remote = true;
            const draft = mf.getValue("latex");
            setConflict(draft);
            retain.current(draft);
            setError(
              "The shared source changed remotely. Finish or copy your visual draft, then reopen Visual to use the latest source.",
            );
          } else sync();
        });
        cleanup = () => {
          un();
          mf.removeEventListener("focus", focus);
          mf.removeEventListener("blur", blur);
          mf.removeEventListener("input", input);
          mf.removeEventListener("keydown", keys);
          mf.removeEventListener("pointerdown", pointer, true);
          mf.remove();
          field.current = null;
        };
      })
      .catch((e) => {
        if (alive)
          setError(
            `Visual input could not load: ${e.message}. Source editing is still available.`,
          );
      });
    return () => {
      alive = false;
      cleanup();
    };
  }, [binding]);
  useEffect(() => {
    if (field.current) field.current.readOnly = readOnly;
  }, [readOnly]);
  return (
    <div className="math-visual">
      <p className="ws-note">
        Structured input for supported equations. Source remains authoritative;
        advanced LaTeX and custom macros can always be edited in Source.
      </p>
      {!ready && !error && <Loading label="Loading visual input…" />}
      <div ref={host} />
      <ErrorNotice message={error} />
      {conflict !== null && (
        <div className="tool-recovery">
          <h3>Retained visual draft</h3>
          <pre>{conflict}</pre>
          <button
            className="button secondary"
            onClick={() => downloadText(conflict, "visual-draft.tex")}
          >
            Download draft
          </button>
          <button
            className="button secondary"
            onClick={() => {
              field.current?.setValue(binding.source, {
                silenceNotifications: true,
              });
              setConflict(null);
              setError(
                "Switch to Source and back to start a fresh visual edit against the current shared version.",
              );
            }}
          >
            Show current source
          </button>
        </div>
      )}
    </div>
  );
}
