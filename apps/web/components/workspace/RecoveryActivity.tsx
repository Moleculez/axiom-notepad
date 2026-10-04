"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  FileArchive,
  FileCheck2,
  FileText,
  MessageSquare,
  Puzzle,
  RefreshCw,
} from "lucide-react";
import {
  activityIsRunning,
  activityNeedsAttention,
  type RecoveryActivityItem,
} from "@axiom/shared/recovery-activity";
import { api, timeAgo } from "../../lib/client";
import { openAssistant } from "../../lib/assistant";
import { Button, HelpText, IconButton } from "../ui/controls";
import { ErrorNotice, useData, useWorkspace } from "./ui";
import { FileOperationActivity } from "./FileOperations";
import ChangeSetReview from "../assistant/ChangeSetReview";
const icons = {
  files: FileCheck2,
  export: FileArchive,
  ocr: FileText,
  tool: FileText,
  assistant: MessageSquare,
  extension: Puzzle,
};
export default function RecoveryActivity({ onClose }: { onClose: () => void }) {
  const { revision, navigate, open } = useWorkspace();
  const result = useData<{ items: RecoveryActivityItem[] }>(
    "recovery-activity",
    revision,
  );
  const [attention, setAttention] = useState(false),
    [operation, setOperation] = useState<string | null>(null),
    [review, setReview] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const active = result.data?.items.some((i) => activityIsRunning(i.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden && navigator.onLine) result.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [active, result.revalidate]);
  const items = (result.data?.items ?? []).filter(
    (i) => !attention || activityNeedsAttention(i.status),
  );
  const inspect = (i: RecoveryActivityItem) => {
    if (i.kind === "files") setOperation(i.id);
    else if (i.kind === "extension") setReview(i.changeSetId!);
    else {
      onClose();
      if (i.kind === "assistant")
        openAssistant({ spaceId: i.spaceId, conversationId: i.conversationId });
      else if (i.resourceId) open({ id: i.resourceId, kind: "file" });
      else navigate("/settings/exports");
    }
  };
  return (
    <div className="recovery-activity">
      <div className="recovery-filter">
        <Button
          variant="ghost"
          size="compact"
          aria-pressed={!attention}
          onClick={() => setAttention(false)}
        >
          Recent
        </Button>
        <Button
          variant="ghost"
          size="compact"
          aria-pressed={attention}
          onClick={() => setAttention(true)}
        >
          Needs attention
        </Button>
        <IconButton label="Refresh activity" onClick={result.revalidate}>
          <RefreshCw size={15} />
        </IconButton>
      </div>
      <ErrorNotice
        message={result.error || error}
        retry={result.error ? result.reload : undefined}
      />
      <HelpText>
        Existing job controllers own retries, cancellation and recovery. No work
        is restarted automatically here.
      </HelpText>
      <ul
        className="recovery-activity-list"
        aria-label="Recent background work"
      >
        {items.map((i) => {
          const Icon = icons[i.kind];
          return (
            <li key={i.kind + ":" + i.id}>
              <Icon size={18} />
              <div>
                <strong>{i.title}</strong>
                <small>
                  {i.status} · {timeAgo(i.createdAt)}
                </small>
              </div>
              <IconButton
                label={"Inspect " + i.title}
                onClick={() => inspect(i)}
              >
                <ArrowUpRight size={16} />
              </IconButton>
              {(i.kind === "extension" && activityIsRunning(i.status)) ||
              (i.kind === "extension" && i.status === "draft") ? (
                <Button
                  size="compact"
                  variant="ghost"
                  pending={busy === i.id}
                  onClick={async () => {
                    setError("");
                    setBusy(i.id);
                    try {
                      await api("plugins/proposals/" + i.id, {
                        method: "DELETE",
                      });
                      result.revalidate();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </li>
          );
        })}
        {!items.length && (
          <li className="muted">
            {result.loading
              ? "Loading activity…"
              : attention
                ? "Nothing needs attention."
                : "No background work yet."}
          </li>
        )}
      </ul>
      {operation !== null && (
        <FileOperationActivity
          id={operation || undefined}
          onOpen={setOperation}
          onClose={() => setOperation(null)}
        />
      )}
      {review && (
        <ChangeSetReview
          id={review}
          onClose={() => setReview(null)}
          onChange={result.revalidate}
        />
      )}
    </div>
  );
}
