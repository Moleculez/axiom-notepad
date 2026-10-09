"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";
import { formatNumber } from "@axiom/i18n";

import { Button, Checkbox, Notice, TextInput } from "../ui/controls";
import { useRef, useState } from "react";
import { Trash2, Unlink, ShieldCheck } from "lucide-react";
import type { TrashQuickPurgePlan } from "@axiom/shared/trash";
import { post } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import {
  bytes,
  ErrorNotice,
  Loading,
  useAction,
  useData,
  useWorkspace,
} from "./ui";

export default function TrashQuickPurgeDialog({
  operationId,
  resourceId,
  onClose,
  onPurged,
}: {
  operationId: string;
  resourceId: string;
  onClose: () => void;
  onPurged: () => void;
}) {
  const { t, locale } = useInterfaceLocale();
  const path = `trash/${operationId}/items/${resourceId}/quick-purge`;
  const data = useData<TrashQuickPurgePlan>(path),
    action = useAction();
  const [confirmation, setConfirmation] = useState(""),
    [acknowledged, setAcknowledged] = useState(false);
  const mutationId = useRef(crypto.randomUUID());
  const { refresh, notify } = useWorkspace();
  const plan = data.data;
  const reload = () => {
    setConfirmation("");
    setAcknowledged(false);
    mutationId.current = crypto.randomUUID();
    data.reload();
  };
  return (
    <Dialog
      title={uiText("Remove protection & purge")}
      subtitle={uiText(
        "One confirmation. Protection removal and file deletion happen together.",
      )}
      onClose={() => {
        if (!action.busy) onClose();
      }}
      className="trash-quick-dialog"
    >
      <ErrorNotice message={data.error || action.error} retry={reload} />
      {!plan ? (
        <Loading />
      ) : (
        <div className="trash-quick-review">
          <div className="trash-quick-file">
            <Trash2 size={20} aria-hidden="true" />
            <div>
              <strong>{plan.name}</strong>
              <small>
                <I18nText
                  id="{size} stored across all versions"
                  values={{ size: bytes(plan.bytes) }}
                />
              </small>
            </div>
          </div>
          <section aria-label={uiText("Quick purge impact")}>
            <h3>
              <Unlink size={16} aria-hidden="true" />
              <I18nText id="This action will remove" />
            </h3>
            <ul className="trash-quick-impact">
              {plan.impacts.map((item) => (
                <li key={item.label}>
                  <span>{uiText(item.label)}</span>
                  <strong>{formatNumber(locale, item.count)}</strong>
                </li>
              ))}
            </ul>
          </section>
          {plan.breaksLinks && (
            <Notice tone="warning">
              <I18nText id="Notes and saved revisions will be kept, but their links to this file will stop working. Their text is not rewritten. This includes older versions of the file." />
            </Notice>
          )}
          {plan.canPurge ? (
            <>
              {plan.breaksLinks && (
                <label className="ws-checkbox">
                  <Checkbox
                    checked={acknowledged}
                    disabled={action.busy}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <I18nText id="I understand that existing attachment links will stop working." />
                </label>
              )}
              <label className="trash-delete-confirm">
                <I18nText
                  id="Type {confirmation} to remove the protection above and permanently delete this file."
                  slots={{
                    confirmation: (
                      <strong>
                        <bdi>DELETE FOREVER</bdi>
                      </strong>
                    ),
                  }}
                />
                <TextInput
                  aria-label={uiText("Confirm quick purge")}
                  placeholder="DELETE FOREVER"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  disabled={action.busy}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          ) : (
            <section
              className="trash-quick-blockers"
              aria-label={uiText("Remaining protection")}
            >
              <h3>
                <ShieldCheck size={16} aria-hidden="true" />
                <I18nText id="Still requires permission or review" />
              </h3>
              <ul>
                {plan.blockers.map((reason) => (
                  <li key={reason}>{uiText(reason)}</li>
                ))}
              </ul>
              <p>
                <I18nText id="Nothing will be changed while these protections remain." />
              </p>
            </section>
          )}
          <Notice tone="warning">
            <I18nText id="This affects this file only. It cannot be undone. Shared stored data may remain. If protection changes after this preview, nothing is removed." />
          </Notice>
        </div>
      )}
      <DialogFooter>
        <Button
          data-dialog-cancel
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          <I18nText id="Back" />
        </Button>
        <Button
          className="button secondary"
          disabled={action.busy || data.loading}
          onClick={reload}
        >
          <I18nText id="Refresh preview" />
        </Button>
        {plan?.canPurge && (
          <Button
            className="button danger"
            disabled={
              action.busy ||
              data.loading ||
              confirmation !== "DELETE FOREVER" ||
              (plan.breaksLinks && !acknowledged)
            }
            onClick={() =>
              void action.run(async () => {
                const result = await post<{ purged: boolean; name: string }>(
                  path,
                  {
                    mutationId: mutationId.current,
                    fingerprint: plan.fingerprint,
                    confirmation,
                    acknowledgeBrokenLinks: acknowledged,
                  },
                );
                refresh();
                notify(
                  t(
                    "Permanently deleted {name} and removed the confirmed protection. This cannot be undone.",
                    { name: result.name },
                  ),
                );
                onPurged();
              })
            }
            pending={!!action.busy}
          >
            <Trash2 size={15} aria-hidden="true" />
            {uiText("Remove protection & purge")}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
