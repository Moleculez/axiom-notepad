"use client";
import { Button, Checkbox } from "../ui/controls";
import { useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  FileClock,
  Link2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { TrashProtection } from "@axiom/shared/trash";
import { post } from "../../lib/client";
import { ErrorNotice, Loading, useAction, useData, useWorkspace } from "./ui";

export default function TrashProtectionDetails({
  operationId,
  resourceId,
  onChanged,
  onClose,
}: {
  operationId: string;
  resourceId: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const path = `trash/${operationId}/items/${resourceId}`;
  const data = useData<TrashProtection>(`${path}/protection`),
    action = useAction();
  const [confirmed, setConfirmed] = useState(false);
  const { navigate, refresh, notify } = useWorkspace();
  const value = data.data;
  const open = (href: string) => {
    onClose();
    navigate(href);
  };
  return (
    <section className="trash-protection" aria-label="File protection details">
      <ErrorNotice
        message={data.error || action.error}
        retry={() => {
          setConfirmed(false);
          data.reload();
        }}
      />
      {!value ? (
        data.loading ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="trash-protection-heading">
            <ShieldCheck size={17} aria-hidden="true" />
            <strong>What keeps this file in Trash?</strong>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={() => {
                setConfirmed(false);
                data.reload();
              }}
            >
              Refresh details
            </button>
          </div>
          {!!value.reading.length && (
            <section className="trash-protection-section">
              <h4>
                <Bookmark size={15} aria-hidden="true" />
                Your reading data
              </h4>
              <p>
                These are your own bookmarks, reading-list entries or saved page
                positions. You can remove them here without restoring the file.
                Other people’s records and PDF annotations are not affected.
              </p>
              <ul className="trash-reading-records">
                {value.reading.map((record) => (
                  <li key={record.id}>
                    <span>
                      {record.label ||
                        (record.kind === "progress"
                          ? "Saved page position"
                          : record.kind === "bookmark"
                            ? "Untitled bookmark"
                            : "Reading-list entry")}
                    </span>
                    <small>
                      {record.kind === "progress"
                        ? "Position"
                        : record.kind === "reading"
                          ? "Reading list"
                          : "Bookmark"}
                    </small>
                  </li>
                ))}
              </ul>
              {value.moreReading && (
                <p>
                  Showing the first 500 records. Review any remaining records
                  after removing this batch.
                </p>
              )}
              {value.canClearReading && (
                <div className="trash-reading-confirm">
                  <label className="ws-checkbox">
                    <Checkbox
                      checked={confirmed}
                      disabled={action.busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    Remove the {value.reading.length} personal reading record
                    {value.reading.length === 1 ? "" : "s"} shown above
                  </label>
                  <Button
                    className="button secondary"
                    disabled={!confirmed || action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const result = await post<{ removed: number }>(
                          `${path}/clear-reading`,
                          {
                            mutationId: crypto.randomUUID(),
                            confirmation: "REMOVE MY READING DATA",
                            records: value.reading.map(({ id, version }) => ({
                              id,
                              version,
                            })),
                          },
                        );
                        setConfirmed(false);
                        data.reload();
                        notify(
                          `Removed ${result.removed} of your reading records. The file has not been deleted.`,
                        );
                        await onChanged();
                      })
                    }
                    pending={!!action.busy}
                  >
                    {"Remove my reading data & recheck"}
                  </Button>
                </div>
              )}
            </section>
          )}
          {value.otherReading && (
            <section className="trash-protection-section">
              <h4>
                <Bookmark size={15} aria-hidden="true" />
                Another reader’s data
              </h4>
              <p>
                Another person has a bookmark, reading-list entry or saved
                position for this file. Their private records cannot be removed
                here. Restore the file so they can review their data, or keep it
                in Trash.
              </p>
            </section>
          )}
          {!!value.sources.length && (
            <section className="trash-protection-section">
              <h4>
                <FileClock size={15} aria-hidden="true" />
                Notes & saved history
              </h4>
              <p>
                Remove an unwanted attachment link in its note, then save and
                recheck. A saved revision, suggestion or undo record can still
                retain the file after its current link is removed; Trash does
                not erase that history.
              </p>
              <ul className="trash-source-list">
                {value.sources.map((source) => (
                  <li key={source.id}>
                    <div>
                      <strong>{source.name}</strong>
                      <small>
                        {[
                          source.current && "Current content",
                          source.history && "Saved revision / review history",
                          source.deleted && "In Trash",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => open(source.href)}
                    >
                      {source.deleted ? "View in Trash" : "Open note"}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {value.sources.some((source) => source.history) && (
                <p className="trash-guidance">
                  For saved history, open the note’s Version history to review
                  it. If that history is still needed, restore this file or
                  leave it safely in Trash.
                </p>
              )}
              {value.sources.some((source) => source.deleted) && (
                <p className="trash-guidance">
                  If you intend to remove a trashed note and all its
                  attachments, close this preview and select them together. They
                  can be deleted together only when nothing outside that
                  selection retains them.
                </p>
              )}
              {value.moreSources && (
                <p>
                  Showing the first 50 retaining notes. More notes still
                  reference this file.
                </p>
              )}
            </section>
          )}
          {!!value.references.length && (
            <section className="trash-protection-section">
              <h4>
                <Link2 size={15} aria-hidden="true" />
                Reference library
              </h4>
              <p>
                Review the linked source and detach the file if it is no longer
                needed as research evidence.
              </p>
              <ul className="trash-source-list">
                {value.references.map((reference) => (
                  <li key={reference.id}>
                    <strong>{reference.name}</strong>
                    <button
                      className="text-button"
                      onClick={() => open(reference.href)}
                    >
                      Open reference
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {value.moreReferences && (
                <p>More library references retain this file.</p>
              )}
            </section>
          )}
          {value.restrictedSources && (
            <p className="trash-guidance">
              A source you cannot access also retains this file. Its details are
              private; ask its owner or a workspace manager to review it.
            </p>
          )}
          {value.safeguards.map((item) => (
            <section className="trash-protection-section" key={item.label}>
              <h4>{item.label}</h4>
              <p>{item.description}</p>
              {item.href && (
                <button
                  className="text-button"
                  onClick={() => open(item.href!)}
                >
                  {item.action}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              )}
            </section>
          ))}
          {!value.reading.length &&
            !value.otherReading &&
            !value.sources.length &&
            !value.references.length &&
            !value.restrictedSources &&
            !value.safeguards.length && (
              <p>
                No current protection was found. Recheck the preview to update
                this item’s status.
              </p>
            )}
          {value.canRestore && (
            <div className="trash-protection-recovery">
              <p>
                Still need the evidence? Restore it with its links and reading
                data intact.
              </p>
              <Button
                className="button secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await post(`resources/${resourceId}/restore`, {
                      version: value.version,
                      mutationId: crypto.randomUUID(),
                    });
                    refresh();
                    notify(
                      "File restored. Its references and reading data were kept.",
                    );
                    await onChanged();
                  })
                }
              >
                <RotateCcw size={15} aria-hidden="true" />
                Restore file
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
