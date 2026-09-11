import {
  Editor,
  rootCtx,
  nodesCtx,
  marksCtx,
  defaultValueCtx,
  editorStateOptionsCtx,
  editorViewOptionsCtx,
  editorViewCtx,
  editorStateCtx,
  schemaCtx,
} from "@milkdown/kit/core";
import {
  TextSelection,
  NodeSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import {
  type EditorView,
  type DirectEditorProps,
} from "@milkdown/kit/prose/view";
import type { Schema } from "@milkdown/kit/prose/model";
import { nodes, marks } from "./schema";
import { type Projection } from "./projection";
import type { SourceSelection } from "./transactions";

export type RichSurfaceOptions = {
  projection: (schema: Schema) => Projection;
  dispatch: (transaction: Transaction) => void;
  props: Omit<DirectEditorProps, "state" | "dispatchTransaction">;
};
export class RichSurface {
  readonly editor: Editor;
  view!: EditorView;
  projection!: Projection;
  private constructor(parent: HTMLElement, options: RichSurfaceOptions) {
    // Register Axiom's schema in Milkdown's lifecycle. Remark serialization and
    // stock collab/history/input rules are intentionally not enabled.
    const unsupported = () => {
      throw new Error(
        "Use Axiom source transactions, not Milkdown serialization.",
      );
    };
    const converter = { match: () => false, runner: unsupported };
    this.editor = Editor.make().config((ctx) => {
      ctx.set(rootCtx, parent);
      ctx.set(
        nodesCtx,
        Object.entries(nodes).map(([name, spec]) => [
          name,
          { ...spec, parseMarkdown: converter, toMarkdown: converter },
        ]),
      );
      ctx.set(
        marksCtx,
        Object.entries(marks).map(([name, spec]) => [
          name,
          { ...spec, parseMarkdown: converter, toMarkdown: converter },
        ]),
      );
      ctx.set(defaultValueCtx, {
        type: "json",
        value: { type: "doc", content: [{ type: "paragraph" }] },
      });
      ctx.set(editorStateOptionsCtx, (state) => {
        this.projection = options.projection(ctx.get(schemaCtx));
        return { ...state, doc: this.projection.doc, plugins: [] };
      });
      ctx.set(editorViewOptionsCtx, {
        ...options.props,
        dispatchTransaction: (transaction) => options.dispatch(transaction),
      });
    });
  }
  static async create(parent: HTMLElement, options: RichSurfaceOptions) {
    const surface = new RichSurface(parent, options);
    await surface.editor.create();
    surface.view = surface.editor.ctx.get(editorViewCtx);
    return surface;
  }
  apply(transaction: Transaction) {
    const state = this.view.state.apply(transaction);
    this.view.updateState(state);
    this.editor.ctx.set(editorStateCtx, state);
  }
  update(
    projection: Projection,
    selection: SourceSelection,
    focus = false,
    visualSelection?: SourceSelection,
  ) {
    this.projection = projection;
    const state = this.view.state;
    let tr = state.tr;
    const start = state.doc.content.findDiffStart(projection.doc.content);
    if (start !== null) {
      const end = state.doc.content.findDiffEnd(projection.doc.content)!;
      const overlap = Math.max(0, start - Math.min(end.a, end.b));
      // The interactive replace fitter may invent cells/paragraphs to repair a
      // structural slice. A source projection is already valid: apply it exactly,
      // or replace the view document if the minimal slice cannot join safely.
      const result = tr.maybeStep(
        new ReplaceStep(
          start,
          end.a + overlap,
          projection.doc.slice(start, end.b + overlap),
        ),
      );
      if (result.failed || !tr.doc.eq(projection.doc))
        tr = state.tr.replaceWith(
          0,
          state.doc.content.size,
          projection.doc.content,
        );
    }
    const anchor =
        visualSelection?.anchor ?? projection.map.positionAt(selection.anchor),
      head = visualSelection?.head ?? projection.map.positionAt(selection.head);
    const image =
      !visualSelection &&
      projection.blocks.find(
        (block) =>
          block.node.type === "image" &&
          Math.min(selection.anchor, selection.head) === block.node.from &&
          Math.max(selection.anchor, selection.head) === block.node.to,
      );
    tr.setSelection(
      image
        ? NodeSelection.create(tr.doc, image.from)
        : TextSelection.create(tr.doc, anchor, head),
    )
      .setMeta("axiom:projection", true)
      .setMeta("addToHistory", false);
    this.apply(tr);
    if (focus) {
      this.view.focus();
      this.apply(this.view.state.tr.scrollIntoView());
    }
  }
  async destroy() {
    await this.editor.destroy();
  }
}
