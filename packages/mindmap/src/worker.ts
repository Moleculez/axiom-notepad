import { projectMindmap } from "./projection";
import { layoutMindmap } from "./layout";
import type {
  MindmapProjection,
  MindmapLayout,
  MindmapSettings,
} from "./types";

export type MindmapRequest = {
  id: number;
  source: string;
  title: string;
  settings: MindmapSettings;
  folds: { position: number; type: string }[];
  sizes: Record<string, { width: number; height: number }>;
};
export type MindmapResponse = { id: number } & (
  | { projection: MindmapProjection; layout: MindmapLayout; error?: never }
  | { error: string; projection?: never; layout?: never }
);
export function computeMindmap(
  request: MindmapRequest,
  cached?: MindmapProjection,
): MindmapResponse {
  try {
    const projection = cached ?? projectMindmap(request.source, request.title);
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
    return {
      id: request.id,
      projection,
      layout: layoutMindmap(
        projection,
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
    projection: MindmapProjection | undefined;
  return (request: MindmapRequest) => {
    const response = computeMindmap(
      request,
      source === request.source && title === request.title
        ? projection
        : undefined,
    );
    source = request.source;
    title = request.title;
    projection = response.projection;
    return response;
  };
}
