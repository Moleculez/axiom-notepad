"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Preferences } from "@axiom/shared/appearance";
import type { EditorPreferences } from "@axiom/shared/editor";
import type { Resource } from "@axiom/shared/workspace";
import type { ResourceCardPreview } from "@axiom/shared/canvas-preview";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import type { CanvasData } from "@axiom/shared/canvas";
import type { CanvasRect } from "@axiom/shared/canvas-geometry";
import type { RenderContext } from "@axiom/markdown";

/** Browser services supplied by the authenticated workbench or local showcase. */
export type CanvasHost = {
  local?: boolean;
  identity: string;
  revision: number;
  appearance: { effective: Preferences; dark: boolean };
  editorSettings: { effective: EditorPreferences };
  notify: (message: string) => void;
  open: (
    resource: Pick<Resource, "id" | "kind"> & {
      document_type?: Resource["document_type"];
      versionId?: string;
    },
  ) => void;
  context?: () => RenderContext;
  resources: (query: string, signal: AbortSignal) => Promise<Resource[]>;
  resource: (id: string) => Promise<Resource>;
  resolvePreview: (
    id: string,
    versionId: string | undefined,
    signal: AbortSignal,
  ) => Promise<ResourceCardPreview>;
  importFiles?: (files: File[]) => Promise<Resource[]>;
  filePath?: (resource: Resource) => string;
  normalizeCanvas?: (data: CanvasData) => CanvasData;
  renderFile: (file: FilePreviewManifest, reload: () => void) => ReactNode;
  sharing?: ReactNode;
  explorer?: ReactNode;
  discussion?: (
    cardId: string | null,
    names: Map<string, string>,
    select: (id: string) => void,
  ) => ReactNode;
  assistant?: (nodeIds: string[]) => Promise<void>;
  export: (options: {
    source: CanvasData;
    selection: string[];
    viewport: CanvasRect;
    name: string;
    onClose: () => void;
  }) => ReactNode;
};
export const CanvasHostContext = createContext<CanvasHost | null>(null);
export function useCanvasHost() {
  const host = useContext(CanvasHostContext);
  if (!host) throw new Error("Canvas host missing");
  return host;
}
