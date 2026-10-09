"use client";
import { uiText, useInterfaceLocale, I18nText } from "@axiom/i18n/react";

import {
  ActionRow,
  Button,
  IconButton,
  TextInput,
  TextArea,
  NativeSelect,
} from "../ui/controls";
import { useState } from "react";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import Dialog from "../Dialog";
import { useData, ErrorNotice } from "../workspace/ui";
import { api } from "../../lib/client";
type Preset = {
  id: string;
  name: string;
  instructions: string;
  destination_id?: string | null;
  version?: number;
};
export default function AssistantWorkflows({
  spaceId,
  prompt,
  onPick,
  onReview,
}: {
  spaceId: string;
  prompt: string;
  onPick: (text: string) => void;
  onReview: (id: string) => void;
}) {
  useInterfaceLocale();
  const [open, setOpen] = useState(false),
    [edit, setEdit] = useState<Preset | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const presets = useData<{ builtIn: Preset[]; custom: Preset[] }>(
    open ? `spaces/${spaceId}/assistant/workflows` : null,
  );
  const changes = useData<
    { id: string; title: string; status: string; space_ids: string[] }[]
  >(open ? "assistant/change-sets" : null);
  const folders = useData<{ items: { id: string; name: string }[] }>(
    edit ? `resources?space=${spaceId}&view=all&kind=folder&limit=100` : null,
  );
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      presets.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        className="button ghost"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Layers size={15} />
        <I18nText id="Workflows" />
      </Button>
      {open && (
        <Dialog
          wide
          title={uiText("Productivity workflows")}
          subtitle={uiText(
            "Reusable starting points · every workspace change is reviewed",
          )}
          onClose={() => {
            setOpen(false);
            setEdit(null);
          }}
          className="assistant-workflow-dialog"
        >
          <ErrorNotice message={error || presets.error || changes.error} />
          {edit ? (
            <div className="change-set-fields">
              <label>
                <I18nText id="Name" />
                <TextInput
                  aria-label={uiText("Workflow name")}
                  value={edit.name}
                  maxLength={80}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label>
                <I18nText id="Instructions" />
                <TextArea
                  aria-label={uiText("Workflow instructions")}
                  rows={7}
                  maxLength={8000}
                  value={edit.instructions}
                  onChange={(e) =>
                    setEdit({ ...edit, instructions: e.target.value })
                  }
                />
              </label>
              <label>
                <I18nText id="Default destination" />
                <NativeSelect
                  aria-label={uiText("Workflow destination")}
                  value={edit.destination_id ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, destination_id: e.target.value || null })
                  }
                >
                  <option value="">
                    <I18nText id="Ask the assistant / workspace root" />
                  </option>
                  {folders.data?.items.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <ActionRow>
                <Button
                  data-dialog-cancel
                  className="button secondary"
                  onClick={() => setEdit(null)}
                >
                  <I18nText id="Cancel editing" />
                </Button>
                <Button
                  className="button primary"
                  disabled={
                    busy || !edit.name.trim() || !edit.instructions.trim()
                  }
                  onClick={() =>
                    void run(async () => {
                      await api(
                        `spaces/${spaceId}/assistant/workflows${edit.id ? `/${edit.id}` : ""}`,
                        {
                          method: edit.id ? "PATCH" : "POST",
                          body: JSON.stringify({
                            name: edit.name,
                            instructions: edit.instructions,
                            destinationId: edit.destination_id ?? null,
                            ...(edit.version ? { version: edit.version } : {}),
                          }),
                        },
                      );
                      setEdit(null);
                    })
                  }
                >
                  <I18nText id="Save private workflow" />
                </Button>
              </ActionRow>
            </div>
          ) : (
            <>
              <div className="assistant-workflow-grid">
                {presets.data?.builtIn.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onPick(p.instructions + "\n\nMy goal: ");
                      setOpen(false);
                    }}
                  >
                    <strong>{p.name}</strong>
                    <span>{p.instructions}</span>
                  </button>
                ))}
              </div>
              <section className="assistant-workflow-custom">
                <header>
                  <h3>
                    <I18nText id="Your private workflows" />
                  </h3>
                  <Button
                    className="button ghost"
                    onClick={() =>
                      setEdit({ id: "", name: "", instructions: prompt })
                    }
                  >
                    <Plus size={14} />
                    <I18nText id="Save a workflow" />
                  </Button>
                </header>
                {presets.data?.custom.map((p) => (
                  <div key={p.id}>
                    <button
                      onClick={() => {
                        onPick(
                          p.instructions +
                            (p.destination_id
                              ? `\nUse destination folder ${p.destination_id} in workspace ${spaceId}.`
                              : ""),
                        );
                        setOpen(false);
                      }}
                    >
                      {p.name}
                    </button>
                    <IconButton
                      className="icon-button"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => setEdit(p)}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      className="icon-button"
                      aria-label={`Delete ${p.name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`spaces/${spaceId}/assistant/workflows/${p.id}`, {
                            method: "DELETE",
                          }),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ))}
              </section>
              <section>
                <h3>
                  <I18nText id="Recent reviewed changes" />
                </h3>
                {changes.data
                  ?.filter((s) => s.space_ids.includes(spaceId))
                  .map((s) => (
                    <button
                      className="assistant-change-history"
                      key={s.id}
                      onClick={() => {
                        setOpen(false);
                        onReview(s.id);
                      }}
                    >
                      <span>{s.title}</span>
                      <small>{s.status}</small>
                    </button>
                  ))}
              </section>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
