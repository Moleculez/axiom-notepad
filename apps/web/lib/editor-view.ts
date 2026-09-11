import { NativeEditorView } from "./native-editor/view";
import { AxiomEditorView } from "./editor-vnext/view";

/** Deployment gate, not a document preference. Both engines use identical
 * Markdown/Yjs/session contracts, so rollback needs no migration. */
export const EditorView =
  process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE === "milkdown"
    ? AxiomEditorView
    : NativeEditorView;
export type EditorView = NativeEditorView | AxiomEditorView;
