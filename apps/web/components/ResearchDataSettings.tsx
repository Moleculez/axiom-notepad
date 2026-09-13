"use client";
import { confirmAction } from "../lib/app-prompt";
import { useEffect, useState } from "react";
import {
  Bookmark,
  Download,
  FileText,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { type ReadingItem } from "@axiom/shared/research";
import type { Preferences } from "@axiom/shared/appearance";
import {
  allResearch,
  removeResearch,
  type ResearchController,
  type CachedPaper,
} from "../lib/research-store";
import { download } from "../lib/client";
import BookmarkManager from "./BookmarkManager";
import { exportNoteMarks } from "../lib/note-marks-store";
import { exportVisualMarks } from "../lib/visual-mark-store";
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export default function ResearchDataSettings({
  userId,
  research,
  preferences,
  onOpenPaper,
  onOpenBookmark,
}: {
  userId: string;
  research: ResearchController;
  preferences: Preferences;
  onOpenPaper: (paper: CachedPaper) => void;
  onOpenBookmark: (item: ReadingItem) => void;
}) {
  const [estimate, setEstimate] = useState<StorageEstimate>({}),
    [message, setMessage] = useState("");
  useEffect(() => {
    void navigator.storage
      ?.estimate()
      .then(setEstimate)
      .catch(() => {});
  }, [research.papers]);
  const work = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await research.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const bookmarks = research.entries.filter(
    (e) =>
      e.kind === "reading" &&
      (e.value as ReadingItem).kind === "bookmark" &&
      !e.value.deleted,
  );
  return (
    <div className="research-data-settings">
      <section className="settings-card">
        <h3>
          <HardDrive size={20} />
          Offline papers on this device
        </h3>
        <p className="muted">
          Only papers you choose are downloaded. Browser storage is not an
          encrypted vault; use a trusted device. Offline copies cannot be
          remotely recalled. Signing out clears this account’s cached research.
        </p>
        <div className="storage-meter">
          <strong>
            {size(research.papers.reduce((n, p) => n + p.meta.bytes, 0))} in{" "}
            {research.papers.length} papers
          </strong>
          <span>
            {estimate.usage !== undefined
              ? `${size(estimate.usage)} total site storage / ${size(estimate.quota ?? 0)} estimated quota`
              : "Storage estimates are unavailable in this browser."}
          </span>
        </div>
        {research.papers.map((p) => (
          <div className="offline-paper-row" key={p.key}>
            <FileText size={20} />
            <button className="text-button" onClick={() => onOpenPaper(p)}>
              {p.meta.name}
            </button>
            <span>{size(p.meta.bytes)}</span>
            <button
              className="text-button"
              onClick={() =>
                void work(async () => {
                  await removeResearch(userId, p.key);
                })
              }
            >
              Unpin
            </button>
          </div>
        ))}
        {!research.papers.length && (
          <p className="muted">
            Open a PDF and choose Keep offline to add it here.
          </p>
        )}
        <button
          className="button secondary small"
          disabled={!research.papers.length}
          onClick={async () => {
            if (
              await confirmAction(
                "Remove all offline PDF copies from this account on this device? Notes, annotations, and unsynced changes will be kept.",
                {
                  title: "Clear offline PDFs?",
                  confirmLabel: "Clear copies",
                  destructive: true,
                },
              )
            )
              void work(async () => {
                for (const paper of research.papers)
                  await removeResearch(userId, paper.key);
              });
          }}
        >
          Clear offline PDFs only
        </button>
      </section>
      <section className="settings-card">
        <h3>
          <Bookmark size={20} />
          Personal bookmarks
        </h3>
        <p className="muted">
          Bookmarks in the current research group. Reading positions resume
          automatically.
        </p>
        <BookmarkManager
          research={research}
          userId={userId}
          onOpen={onOpenBookmark}
        />
        {!bookmarks.length && (
          <p className="muted">
            Bookmark a note section or a PDF page to return to it later.
          </p>
        )}
      </section>
      <section className="settings-card">
        <h3>Synchronization & personal export</h3>
        <p role="status">{research.status}</p>
        <p>
          {research.entries.filter((e) => e.pending).length} pending changes in
          this group.
        </p>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() => void work(() => research.sync())}
          >
            <RefreshCw size={15} />
            Retry sync
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void work(async () => {
                const all = await allResearch(userId);
                download(
                  "axiom-personal-reading.json",
                  JSON.stringify(
                    {
                      format: "axiom-personal-reading",
                      version: 1,
                      exportedAt: new Date().toISOString(),
                      preferences,
                      noteMarks: await exportNoteMarks(userId),
                      visualMarks: await exportVisualMarks(userId),
                      items: all.filter(
                        (r) =>
                          r.kind === "reading" ||
                          (r.kind === "annotation" &&
                            "author_id" in r.value &&
                            r.value.author_id === userId),
                      ),
                    },
                    null,
                    2,
                  ),
                  "application/json",
                );
              })
            }
          >
            <Download size={15} />
            Export personal reading data
          </button>
        </div>
        <p className="muted">
          Includes your cached bookmarks, reading state, owned annotations and
          preferences across groups—not PDF files, other researchers’
          annotations, account credentials, or history. Keep exports private.
          Full restoration uses an administrator backup.
        </p>
        {research.entries
          .filter((e) => e.error)
          .map((entry) => (
            <article className="research-conflict" key={entry.key}>
              <strong>
                {entry.kind === "annotation"
                  ? "Annotation"
                  : (entry.value as ReadingItem).data.label || "Reading item"}
              </strong>
              <p>{entry.error}</p>
              <div className="button-row">
                {!Object.hasOwn(entry, "conflict") && (
                  <button
                    className="button secondary small"
                    onClick={() =>
                      void work(() => research.resolve(entry, true))
                    }
                  >
                    Retry this item
                  </button>
                )}
                <button
                  className="button secondary small"
                  onClick={() =>
                    download(
                      "unsynced-reading-item.json",
                      JSON.stringify(entry, null, 2),
                      "application/json",
                    )
                  }
                >
                  Export local changes
                </button>
                {Object.hasOwn(entry, "conflict") ? (
                  <>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        void work(() => research.resolve(entry, true))
                      }
                    >
                      Keep my changes
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        void work(() => research.resolve(entry, false))
                      }
                    >
                      Use server version
                    </button>
                  </>
                ) : (
                  <button
                    className="button secondary small"
                    onClick={async () => {
                      if (
                        await confirmAction(
                          "Discard this local unsynchronized item? Export it first if you need a copy.",
                          {
                            title: "Discard local item?",
                            confirmLabel: "Discard item",
                            destructive: true,
                          },
                        )
                      )
                        void work(async () => {
                          await removeResearch(userId, entry.key);
                        });
                    }}
                  >
                    Discard local item
                  </button>
                )}
              </div>
            </article>
          ))}
      </section>
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
