"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button } from "./ui/controls";
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
  researchEntries,
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
  useInterfaceLocale();
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
          <I18nText id="Offline papers on this device" />
        </h3>
        <p className="muted">
          <I18nText id="Only papers you choose are downloaded. Browser storage is not an encrypted vault; use a trusted device. Offline copies cannot be remotely recalled. Signing out clears this account’s cached research." />
        </p>
        <div className="storage-meter">
          <strong>
            {size(research.papers.reduce((n, p) => n + p.meta.bytes, 0))}{" "}
            <I18nText id="in" /> {research.papers.length}{" "}
            <I18nText id="papers" />
          </strong>
          <span>
            {estimate.usage !== undefined
              ? `${size(estimate.usage)} total site storage / ${size(estimate.quota ?? 0)} estimated quota`
              : uiText("Storage estimates are unavailable in this browser.")}
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
              <I18nText id="Unpin" />
            </button>
          </div>
        ))}
        {!research.papers.length && (
          <p className="muted">
            <I18nText id="Open a PDF and choose Keep offline to add it here." />
          </p>
        )}
        <Button
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
          <I18nText id="Clear offline PDFs only" />
        </Button>
      </section>
      <section className="settings-card">
        <h3>
          <Bookmark size={20} />
          <I18nText id="Personal bookmarks" />
        </h3>
        <p className="muted">
          <I18nText id="Bookmarks in the current reading context. Reading positions resume automatically." />
        </p>
        <BookmarkManager
          research={research}
          userId={userId}
          onOpen={onOpenBookmark}
        />
        {!bookmarks.length && (
          <p className="muted">
            <I18nText id="Bookmark a note section or a PDF page to return to it later." />
          </p>
        )}
      </section>
      <section className="settings-card">
        <h3>
          <I18nText id="Synchronization & personal export" />
        </h3>
        <p role="status">{research.status}</p>
        <p>
          {research.entries.filter((e) => e.pending).length}{" "}
          <I18nText id="pending changes in this reading context." />
        </p>
        <div className="button-row">
          <Button
            className="button secondary"
            onClick={() => void work(() => research.sync())}
          >
            <RefreshCw size={15} />
            <I18nText id="Retry sync" />
          </Button>
          <Button
            className="button secondary"
            onClick={() =>
              void work(async () => {
                const all = await researchEntries(userId);
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
            <I18nText id="Export personal reading data" />
          </Button>
        </div>
        <p className="muted">
          <I18nText id="Includes your cached bookmarks, reading state, owned annotations and preferences across workspaces—not PDF files, other researchers’ annotations, account credentials, or history. Keep exports private. Full restoration uses an administrator backup." />
        </p>
        {research.entries
          .filter((e) => e.error)
          .map((entry) => (
            <article className="research-conflict" key={entry.key}>
              <strong>
                {entry.kind === "annotation"
                  ? uiText("Annotation")
                  : (entry.value as ReadingItem).data.label || "Reading item"}
              </strong>
              <p>{entry.error}</p>
              <div className="button-row">
                {!Object.hasOwn(entry, "conflict") && (
                  <Button
                    className="button secondary small"
                    onClick={() =>
                      void work(() => research.resolve(entry, true))
                    }
                  >
                    <I18nText id="Retry this item" />
                  </Button>
                )}
                <Button
                  className="button secondary small"
                  onClick={() =>
                    download(
                      "unsynced-reading-item.json",
                      JSON.stringify(entry, null, 2),
                      "application/json",
                    )
                  }
                >
                  <I18nText id="Export local changes" />
                </Button>
                {Object.hasOwn(entry, "conflict") ? (
                  <>
                    <Button
                      data-dialog-cancel
                      className="button secondary small"
                      onClick={() =>
                        void work(() => research.resolve(entry, true))
                      }
                    >
                      <I18nText id="Keep my changes" />
                    </Button>
                    <Button
                      className="button secondary small"
                      onClick={() =>
                        void work(() => research.resolve(entry, false))
                      }
                    >
                      <I18nText id="Use server version" />
                    </Button>
                  </>
                ) : (
                  <Button
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
                    <I18nText id="Discard local item" />
                  </Button>
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
