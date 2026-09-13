import type { RevisionContent } from "@axiom/shared/revisions";
import type { ToolProject } from "@axiom/shared/research-tools";
import { api, post } from "../client";
import { datasetRequestHeaders } from "../dataset";

export const imageBundleBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
export async function readImageRevision(revision: RevisionContent) {
  if (!revision.download)
    throw new Error("This image revision cannot be downloaded.");
  const response = await fetch(revision.download, {
    headers: datasetRequestHeaders(),
  });
  if (!response.ok)
    throw new Error("The image revision is unavailable. Nothing was changed.");
  return response.blob();
}
export async function copyImageRevision(
  project: ToolProject,
  revision: RevisionContent,
  name: string,
) {
  const bundle = await imageBundleBase64(await readImageRevision(revision));
  const created = await post("tools", {
    kind: "image",
    spaceId: project.space_id,
    parentId: project.parent_id ?? null,
    name,
    mutationId: crypto.randomUUID(),
  });
  const lease = await post("tools/" + created.id + "/lease", {});
  try {
    const target = await api<ToolProject>("tools/" + created.id);
    await post("tools/" + created.id + "/save", {
      token: lease.token,
      fence: lease.fence,
      expectedVersion: target.current_version_id,
      bundle,
      label: "Copied revision",
      mutationId: crypto.randomUUID(),
    });
    return { id: created.id };
  } finally {
    await post("tools/" + created.id + "/lease", {
      token: lease.token,
      release: true,
    }).catch(() => {});
  }
}
