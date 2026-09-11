"use client";
import { useEffect, useRef, useImperativeHandle, type Ref } from "react";
import { closeCompletion } from "@codemirror/autocomplete";
import type { NativeBinding } from "@axiom/editor/binding";
import { TextSurface } from "@axiom/editor/text-surface";
import {
  insertMathSource,
  mathSourceExtensions,
  clearMathSourceFields,
} from "../../lib/tools/math-source";
export type StudioSourceHandle = {
  insert: (value: string, fields?: readonly [number, number][]) => void;
};
export default function StudioSource({
  binding,
  readOnly,
  macros = "",
  language = "latex",
  ref,
}: {
  binding: NativeBinding;
  readOnly: boolean;
  macros?: string;
  language?: string;
  ref?: Ref<StudioSourceHandle>;
}) {
  const host = useRef<HTMLDivElement>(null),
    readonly = useRef(readOnly),
    definitions = useRef(macros),
    surface = useRef<TextSurface | null>(null);
  readonly.current = readOnly;
  definitions.current = macros;
  useImperativeHandle(
    ref,
    () => ({
      insert(value, fields = []) {
        const editor = surface.current;
        if (!editor || readonly.current) return;
        editor.focus(binding.selection());
        insertMathSource(editor.view, value, fields);
      },
    }),
    [binding],
  );
  useEffect(() => {
    if (!host.current) return;
    const editor = new TextSurface(host.current, {
      value: { text: binding.source, from: 0 },
      label: language === "latex" ? "LaTeX source" : "Text source",
      readOnly: readonly.current,
      wrap: true,
      numbers: true,
      indent: 2,
      language,
      extensions:
        language === "latex"
          ? mathSourceExtensions(() => definitions.current)
          : [],
      edit: (changes, selection, kind) => {
        if (!readonly.current) binding.transact({ changes, selection, kind });
      },
      select: (s) => binding.select(s),
      keydown: (e) => {
        if (
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === "z" &&
          !e.isComposing
        ) {
          e.preventDefault();
          if (!readonly.current) binding.history(e.shiftKey);
          return true;
        }
        return false;
      },
    });
    surface.current = editor;
    const unsubscribe = binding.subscribe((_source, selection) => {
      editor.update({ text: binding.source, from: 0 }, selection);
    });
    const peers = binding.onPresence((value) =>
      editor.markers(
        value
          .filter((p) => p.selection)
          .map((p) => ({
            id: p.id,
            kind: "peer",
            from: Math.min(p.selection!.anchor, p.selection!.head),
            to: Math.max(p.selection!.anchor, p.selection!.head),
            head: p.selection!.head,
            color: p.color,
            label: p.name,
          })),
      ),
    );
    return () => {
      unsubscribe();
      peers();
      editor.destroy();
      surface.current = null;
    };
  }, [binding, language]);
  useEffect(() => {
    surface.current?.configure({ readOnly });
    if (readOnly && surface.current) {
      closeCompletion(surface.current.view);
      clearMathSourceFields(surface.current.view);
    }
  }, [readOnly]);
  return <div className="studio-source axiom-text-surface" ref={host} />;
}
