"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import Dialog from "../Dialog";
import { post, timeAgo } from "../../lib/client";
import {
  Badge,
  bytes,
  Empty,
  ErrorNotice,
  Loading,
  useAction,
  useData,
  useWorkspace,
} from "./ui";

export function ExportsPage() {
  const { revision, spaces } = useWorkspace(),
    result = useData<any[]>("exports", revision),
    action = useAction();
  const [remove, setRemove] = useState<string | null>(null),
    running = result.data?.some((item) =>
      ["queued", "running"].includes(item.status),
    );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(result.reload, 3000);
    return () => clearInterval(timer);
  }, [running, result.reload]);
  return (
    <section>
      <p className="ws-note">
        Select items in Explorer to prepare a portable ZIP. Exports contain
        current Markdown, matching BibTeX, and exact linked file versions. They
        do not contain comments, account data, or full edit history; use an
        administrator backup for full recovery. Up to 1,000 items, 25 MB of
        Markdown, and 100 GB of files per export. Finished archives stay until
        you remove them.
      </p>
      <ErrorNotice
        message={result.error || action.error}
        retry={result.error ? result.reload : undefined}
      />
      {result.loading && !result.data && <Loading />}
      {result.data?.length ? (
        <div className="ws-card">
          {result.data.map((item) => (
            <div className="ws-version" key={item.id}>
              <strong>
                {spaces.find((space) => space.id === item.space_id)?.name ??
                  "Workspace export"}{" "}
                <Badge>{item.status}</Badge>
              </strong>
              <small>
                {item.items} source items · {timeAgo(item.created_at)}
                {item.bytes ? ` · ${bytes(item.bytes)}` : ""}
              </small>
              <ErrorNotice message={item.error} />
              <div className="ws-actions">
                {item.status === "ready" && (
                  <a
                    className="button secondary"
                    href={`/api/v1/exports/${item.id}/download`}
                  >
                    <Download size={15} />
                    Download ZIP
                  </a>
                )}
                {!["queued", "running"].includes(item.status) && (
                  <button
                    className="button secondary"
                    onClick={() => setRemove(item.id)}
                  >
                    Remove archive…
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !result.loading && (
          <Empty title="No exports yet">
            Choose a folder or select files in Explorer, then choose Export
            selection.
          </Empty>
        )
      )}
      {remove && (
        <Dialog
          title="Remove this prepared archive?"
          onClose={() => !action.busy && setRemove(null)}
        >
          <p>
            The ZIP on the server will be permanently removed. Your original
            notes and files are unchanged; you can export them again.
          </p>
          <ErrorNotice message={action.error} />
          <div className="dialog-footer">
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => setRemove(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await post(`exports/${remove}/remove`);
                  setRemove(null);
                  result.reload();
                })
              }
            >
              Remove archive
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
