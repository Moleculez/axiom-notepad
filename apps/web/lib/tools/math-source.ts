import {
  Prec,
  Transaction,
  StateField,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { keymap, Decoration, EditorView } from "@codemirror/view";
import {
  autocompletion,
  completionKeymap,
  acceptCompletion,
  closeCompletion,
  type Completion,
} from "@codemirror/autocomplete";
import {
  mathSourceSuggestions,
  mathSourceInsertion,
} from "@axiom/editor/math-source-completions";
import { mathSymbolIcon } from "../icons/math-symbols";

type MathFields = { ranges: { from: number; to: number }[]; active: number };
const setMathFields = StateEffect.define<MathFields | null>();
const mathFields = StateField.define<MathFields | null>({
  create: () => null,
  update: (value, transaction) => {
    if (value && transaction.docChanged) {
      value = {
        ...value,
        ranges: value.ranges.map((range) => ({
          from: transaction.changes.mapPos(range.from, -1),
          to: transaction.changes.mapPos(range.to, 1),
        })),
      };
      if (
        value.ranges.every(
          (range) =>
            range.from === value!.ranges[0].from &&
            range.to === value!.ranges[0].from,
        )
      )
        value = null;
    }
    for (const effect of transaction.effects)
      if (effect.is(setMathFields)) return effect.value;
    if (transaction.state.readOnly) return null;
    if (value && (transaction.selection || transaction.docChanged)) {
      const range = value.ranges[value.active],
        selection = transaction.state.selection.main;
      if (!range || selection.from < range.from || selection.to > range.to)
        value = null;
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) =>
      Decoration.set(
        value?.ranges
          .filter((range) => range.to > range.from)
          .map((range) =>
            Decoration.mark({ class: "cm-snippetField" }).range(
              range.from,
              range.to,
            ),
          ) ?? [],
        true,
      ),
    ),
});
export function clearMathSourceFields(view: EditorView) {
  if (!view.state.field(mathFields, false)) return false;
  view.dispatch({ effects: setMathFields.of(null) });
  return true;
}
export function moveMathSourceField(view: EditorView, direction: 1 | -1) {
  const current = view.state.field(mathFields, false);
  if (!current || view.state.readOnly) return false;
  const active = current.active + direction,
    range = current.ranges[active];
  if (!range) return false;
  view.dispatch({
    selection: { anchor: range.from, head: range.to },
    effects: setMathFields.of(
      active === current.ranges.length - 1 ? null : { ...current, active },
    ),
    scrollIntoView: true,
  });
  return true;
}

export function insertMathSource(
  view: EditorView,
  value: string,
  fields: readonly [number, number][],
  from = view.state.selection.main.from,
  to = view.state.selection.main.to,
) {
  if (view.state.readOnly) return;
  closeCompletion(view);
  const insertion = mathSourceInsertion(value, fields, from, to);
  view.dispatch({
    changes: insertion.changes,
    selection: insertion.selection,
    ...(fields.length
      ? { effects: setMathFields.of({ ranges: insertion.ranges, active: 0 }) }
      : {}),
    scrollIntoView: true,
    annotations: Transaction.userEvent.of("input.complete"),
  });
  view.focus();
}

/** Opt-in only for Math Studio. Ordinary code surfaces remain completion-free. */
export function mathSourceExtensions(macros: () => string): Extension {
  return [
    mathFields,
    Prec.highest(
      keymap.of([
        {
          key: "Tab",
          run: (view) => acceptCompletion(view) || moveMathSourceField(view, 1),
          shift: (view) => moveMathSourceField(view, -1),
        },
        {
          key: "Escape",
          run: (view) => closeCompletion(view) || clearMathSourceFields(view),
        },
        ...completionKeymap,
      ]),
    ),
    autocompletion({
      override: [
        (context) => {
          if (context.state.readOnly || !context.state.selection.main.empty)
            return null;
          const result = mathSourceSuggestions(
            context.state.doc.toString(),
            context.pos,
            context.explicit,
            macros(),
          );
          if (!result) return null;
          return {
            from: result.from,
            to: result.to,
            filter: false,
            options: result.options.map((item): Completion => ({
              label: item.label,
              detail: item.title,
              type: "text",
              ...(item.symbol ? { symbol: item.symbol } : {}),
              apply: (view, _completion, from) => {
                // Recompute against the current caret after any collaborator edit.
                const current = mathSourceSuggestions(
                  view.state.doc.toString(),
                  view.state.selection.main.head,
                  true,
                  macros(),
                );
                const choice = current?.options.find(
                  (entry) => entry.label === item.label,
                );
                if (!view.state.readOnly && current?.from === from && choice)
                  insertMathSource(
                    view,
                    choice.value,
                    choice.fields,
                    current.from,
                    current.to,
                  );
                else closeCompletion(view);
              },
            })),
          };
        },
      ],
      defaultKeymap: false,
      activateOnTypingDelay: 20,
      interactionDelay: 0,
      maxRenderedOptions: 40,
      icons: false,
      tooltipClass: () => "studio-math-completions",
      optionClass: () => "studio-math-completion",
      addToOptions: [
        {
          position: 20,
          render: (completion) =>
            mathSymbolIcon(
              (completion as Completion & { symbol?: string }).symbol ?? "",
            ),
        },
      ],
    }),
  ];
}
