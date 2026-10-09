/** Presentation and client guidance only. These flags never authorize a write. */
const lifecycle = {
  draft: {
    label: "Review required",
    nextStep: "review",
    message: "Nothing applies without your approval.",
  },
  queued: {
    label: "Queued",
    nextStep: "wait",
    message: "Approval received. Waiting for background processing.",
  },
  applying: {
    label: "Applying",
    nextStep: "wait",
    message: "Applying the changes you approved.",
  },
  complete: {
    label: "Completed",
    nextStep: "open_results",
    message: "Approved changes have been applied.",
  },
  partial: {
    label: "Stopped",
    nextStep: "inspect_results",
    message:
      "Processing stopped. Inspect completed results before reviewing any remaining changes.",
  },
  cancelled: {
    label: "Cancelled",
    nextStep: "inspect_results",
    message:
      "This request was cancelled. No remaining changes will be applied.",
  },
  undone: {
    label: "Undone",
    nextStep: "inspect_results",
    message:
      "Inspect the action receipts for the results of this undone request.",
  },
} as const;

export function changeSetLifecycle(status: string) {
  const state = Object.hasOwn(lifecycle, status)
    ? lifecycle[status as keyof typeof lifecycle]
    : ({
        label: "Unknown status",
        nextStep: "inspect_status",
        message: "Refresh the request status before taking further action.",
      } as const);
  return {
    ...state,
    requiresApproval: status === "draft",
    processing: status === "queued" || status === "applying",
  };
}

/** Repeat-safe preparations and status reads must describe the same lifecycle. */
export function changeSetReceipt(
  value: { id: string; status: string },
  origin: string,
) {
  const state = changeSetLifecycle(value.status);
  return {
    changeSetId: value.id,
    requiresApproval: state.requiresApproval,
    nextStep: state.nextStep,
    message: state.message,
    approvalUrl: `${origin}/workbench/settings/connections?review=${value.id}`,
  };
}
