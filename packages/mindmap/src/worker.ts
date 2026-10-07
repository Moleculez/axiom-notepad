import { projectMindmap } from "./projection";
import { layoutMindmap } from "./layout";
import { withMindmapSupporting } from "./presentation";
import { parseMarkdown } from "../../markdown/src/parser";
import type { ParsedDocument } from "../../markdown/src/types";
import {
  mindmapResearchIndex,
  mindmapResearchMatches,
  mindmapViewProjection,
  type MindmapResearchLens,
  type MindmapResearchIndex,
} from "./research";
import type {
  MindmapProjection,
  MindmapLayout,
  MindmapSettings,
} from "./types";
import { mindmapLimits } from "./types";

export type MindmapRequest = {
  id: number;
  source: string;
  title: string;
  settings: MindmapSettings;
  folds: { position: number; type: string }[];
  sizes: Record<string, { width: number; height: number }>;
  view?: {
    supporting?: boolean;
    focus?: { position: number; type: string };
    research?: {
      lens: MindmapResearchLens;
      query: string;
      resultsOnly: boolean;
    };
  };
};
export type MindmapResponse = { id: number } & (
  | {
      projection: MindmapProjection;
      viewProjection: MindmapProjection;
      layout: MindmapLayout;
      error?: never;
    }
  | {
      error: string;
      projection?: never;
      viewProjection?: never;
      layout?: never;
    }
);
export function computeMindmap(
  request: MindmapRequest,
  cached?: MindmapProjection,
  owner?: ParsedDocument,
  research?: MindmapResearchIndex,
): MindmapResponse {
  try {
    if (request.source.length > mindmapLimits.source)
      throw new Error(
        "Mind maps use the existing one-million-character document limit.",
      );
    const document =
      owner ?? (cached ? undefined : parseMarkdown(request.source));
    const base =
      cached ?? projectMindmap(request.source, request.title, document);
    const projection = request.view?.supporting
      ? withMindmapSupporting(base, request.source)
      : base;
    const positions = new Set(
      request.folds.map((f) => `${f.type}:${f.position}`),
    );
    const folded = projection.nodes
      .filter(
        (node) =>
          positions.has(`${node.blockType}:${node.from}`) &&
          node.kind !== "root",
      )
      .map((node) => node.id);
    const focusedProjection = mindmapViewProjection(
      projection,
      request.view?.focus,
    );
    const lens = request.view?.research;
    const viewProjection =
      lens?.resultsOnly && (lens.lens !== "all" || lens.query.trim())
        ? mindmapViewProjection(
            projection,
            request.view?.focus,
            mindmapResearchMatches(
              projection,
              research ??
                mindmapResearchIndex(
                  projection,
                  document ?? parseMarkdown(request.source),
                ),
              lens.lens,
              lens.query,
              focusedProjection.rootId,
            ).map((n) => n.id),
          )
        : focusedProjection;
    return {
      id: request.id,
      projection,
      viewProjection,
      layout: layoutMindmap(
        viewProjection,
        request.settings,
        folded,
        request.sizes,
      ),
    };
  } catch (error) {
    return {
      id: request.id,
      error:
        error instanceof Error
          ? error.message
          : "This document could not be mapped. Its complete source is still available.",
    };
  }
}

/** A worker owns one bounded projection cache, not a growing document history. */
export function createMindmapComputer() {
  let source: string | undefined,
    title: string | undefined,
    projection: MindmapProjection | undefined,
    owner: ParsedDocument | undefined,
    research: MindmapResearchIndex | undefined;
  return (request: MindmapRequest) => {
    if (source !== request.source || title !== request.title) {
      try {
        if (request.source.length > mindmapLimits.source)
          throw new Error("Document exceeds the mind-map source limit.");
        if (source !== request.source || !owner)
          owner = parseMarkdown(request.source);
        projection = projectMindmap(request.source, request.title, owner);
        research = mindmapResearchIndex(projection, owner);
      } catch {
        projection = undefined;
        owner = undefined;
        research = undefined;
      }
    }
    const response = computeMindmap(request, projection, owner, research);
    source = request.source;
    title = request.title;
    return response;
  };
}
