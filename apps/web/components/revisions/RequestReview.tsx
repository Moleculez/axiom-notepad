"use client";
import {
  Button,
  NativeSelect,
  TextArea,
  Checkbox,
  HelpText,
} from "../ui/controls";
import { useEffect, useState } from "react";
import { api } from "../../lib/client";
import type { PaperReviewPreview } from "@axiom/shared/paper-review";
import Dialog from "../Dialog";
import {
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
} from "../workspace/ui";
export default function RequestReview({
  resourceId,
  reference,
  onClose,
  markdown = false,
}: {
  resourceId: string;
  reference: string;
  onClose: () => void;
  markdown?: boolean;
}) {
  const { notify } = useWorkspace(),
    action = useAction(),
    data = useData<{ reviewers: { id: string; name: string }[] }>(
      "resources/" + resourceId + "/review-requests",
    );
  const [reviewer, setReviewer] = useState(""),
    [message, setMessage] = useState("");
  const [paper, setPaper] = useState(markdown),
    [paperPreview, setPaperPreview] = useState<PaperReviewPreview | null>(null),
    [paperError, setPaperError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!paper) return;
    const controller = new AbortController();
    setPaperPreview(null);
    setPaperError("");
    void api<PaperReviewPreview>(
      `resources/${resourceId}/paper-review-preview`,
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ reference }),
      },
    )
      .then((preview) => {
        if (!controller.signal.aborted) setPaperPreview(preview);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPaperError(error.message);
      });
    return () => controller.abort();
  }, [paper, reference, resourceId, attempt]);
  return (
    <Dialog
      title="Request a revision review"
      subtitle="Feedback is attached to this saved milestone. An approval is advisory and never accepts text suggestions automatically."
      onClose={() => !action.busy && onClose()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            if (!navigator.onLine)
              throw new Error("Connect before assigning a review.");
            await mutate("resources/" + resourceId + "/review-requests", {
              reference,
              reviewerId: reviewer,
              message,
              ...(paper && paperPreview
                ? { paperFingerprint: paperPreview.fingerprint }
                : {}),
            });
            notify("Review assigned to the saved milestone.");
            onClose();
          });
        }}
      >
        {data.loading && <Loading label="Finding reviewers…" />}
        <label>
          Reviewer
          <NativeSelect
            required
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
          >
            <option value="">Choose a collaborator</option>
            {data.data?.reviewers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {markdown && (
          <>
            <label className="research-inline-check">
              <Checkbox
                checked={paper}
                onChange={(event) => setPaper(event.target.checked)}
              />
              Freeze paper references and figure versions
            </label>
            {paper && (
              <>
                <HelpText>
                  {paperPreview
                    ? `${paperPreview.referenceKeys.length} bibliography keys · ${paperPreview.assets.length} exact attached versions. The reviewer must already have access; no permissions are changed.`
                    : "Preparing the milestone's dependency review…"}
                </HelpText>
                {!!paperPreview?.diagnostics.length && (
                  <details>
                    <summary>
                      Research checks ({paperPreview.diagnostics.length})
                    </summary>
                    <ul>
                      {paperPreview.diagnostics.map((d, i) => (
                        <li key={i}>{d.message}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <ErrorNotice
                  message={paperError}
                  retry={() => setAttempt((n) => n + 1)}
                />
              </>
            )}
          </>
        )}
        <label>
          What should they check?
          <TextArea
            maxLength={5000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Assumptions, derivation, reproducibility, or figure accuracy…"
          />
        </label>
        <ErrorNotice message={action.error || data.error} />
        <div className="dialog-footer">
          <Button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="button primary"
            disabled={action.busy || !reviewer || (paper && !paperPreview)}
          >
            Request review
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
