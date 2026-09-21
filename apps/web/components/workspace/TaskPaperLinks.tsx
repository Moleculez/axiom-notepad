"use client";
import { Unlink } from "lucide-react";
import {
  ErrorNotice,
  WorkspaceLink,
  mutate,
  useAction,
  useData,
  useWorkspace,
} from "./ui";
type Link = {
  id: string;
  annotation_id: string;
  version_id: string;
  page: number;
  resource_id: string;
  name: string;
  shared: boolean;
};
export default function TaskPaperLinks({
  taskId,
  readOnly,
}: {
  taskId: string;
  readOnly: boolean;
}) {
  const { revision, refresh } = useWorkspace(),
    action = useAction(),
    data = useData<Link[]>(`tasks/${taskId}/paper-links`, revision);
  if (!data.data?.length && !data.error) return null;
  return (
    <section className="task-paper-links" aria-label="Linked paper annotations">
      <h3>Paper annotations</h3>
      <ErrorNotice message={action.error || data.error} retry={data.reload} />
      {data.data?.map((l) => (
        <div key={l.id}>
          <WorkspaceLink
            to={`/pdf/${l.resource_id}?version=${l.version_id}&page=${l.page}&annotation=${l.annotation_id}`}
          >
            {l.name} · p. {l.page}
            {!l.shared && <small> · Private</small>}
          </WorkspaceLink>
          {!readOnly && (
            <button
              type="button"
              className="icon-button"
              title="Remove paper link"
              aria-label={`Remove link to ${l.name} page ${l.page}`}
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await mutate(
                    `tasks/${taskId}/paper-links/${l.id}`,
                    {},
                    "DELETE",
                  );
                  refresh();
                })
              }
            >
              <Unlink size={15} />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
