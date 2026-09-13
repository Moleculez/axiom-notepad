import type { FileType } from "@axiom/shared/file-types";
export type FileCreationRequest = {
  type: FileType;
  target?: { spaceId: string; parentId: string | null };
  importFile?: string;
  importVersion?: string;
};
export function requestFileCreation(request: FileCreationRequest) {
  window.dispatchEvent(
    new CustomEvent("axiom:create-file", { detail: request }),
  );
}
