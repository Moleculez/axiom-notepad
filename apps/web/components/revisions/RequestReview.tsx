"use client";
import { useState } from "react";
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
}: {
  resourceId: string;
  reference: string;
  onClose: () => void;
}) {
  const { notify } = useWorkspace(),
    action = useAction(),
    data = useData<{ reviewers: { id: string; name: string }[] }>(
      "resources/" + resourceId + "/review-requests",
    );
  const [reviewer, setReviewer] = useState(""),
    [message, setMessage] = useState("");
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
            });
            notify("Review assigned to the saved milestone.");
            onClose();
          });
        }}
      >
        {data.loading && <Loading label="Finding reviewers…" />}
        <label>
          Reviewer
          <select
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
          </select>
        </label>
        <label>
          What should they check?
          <textarea
            maxLength={5000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Assumptions, derivation, reproducibility, or figure accuracy…"
          />
        </label>
        <ErrorNotice message={action.error || data.error} />
        <div className="dialog-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={action.busy || !reviewer}
          >
            Request review
          </button>
        </div>
      </form>
    </Dialog>
  );
}
