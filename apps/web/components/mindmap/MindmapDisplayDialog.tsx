"use client";
import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { MindmapSettings } from "@axiom/mindmap";
import Dialog, { DialogFooter } from "../Dialog";
import { Button, Field, NativeSelect, Notice } from "../ui/controls";

/** Presentation controls do not acquire document authority or change Markdown. */
export default function MindmapDisplayDialog({
  settings,
  onChange,
  onFoldAll,
  onExpandAll,
  onSave,
  onClose,
}: {
  settings: MindmapSettings;
  onChange: (settings: MindmapSettings) => void;
  onFoldAll: () => void;
  onExpandAll: () => void;
  onSave?: () => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  return (
    <Dialog
      title="Mind-map display"
      subtitle="Local presentation preferences. Markdown and collaborators' views are unchanged."
      onClose={onClose}
    >
      <div className="mindmap-options">
        <Field label="Direction">
          <NativeSelect
            value={settings.layout}
            onChange={(e) =>
              onChange({
                ...settings,
                layout: e.target.value as MindmapSettings["layout"],
              })
            }
          >
            <option value="right">Rightward</option>
            <option value="left">Leftward</option>
            <option value="balanced">Balanced</option>
          </NativeSelect>
        </Field>
        <Field label="Spacing">
          <NativeSelect
            value={settings.spacing}
            onChange={(e) =>
              onChange({
                ...settings,
                spacing: e.target.value as MindmapSettings["spacing"],
              })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </NativeSelect>
        </Field>
        <Field label="Branch colors">
          <NativeSelect
            value={settings.colors}
            onChange={(e) =>
              onChange({
                ...settings,
                colors: e.target.value as MindmapSettings["colors"],
              })
            }
          >
            <option value="accent">Theme accent</option>
            <option value="spectrum">Theme spectrum</option>
          </NativeSelect>
        </Field>
        <Field label="Node width">
          <NativeSelect
            value={settings.nodeWidth}
            onChange={(e) =>
              onChange({ ...settings, nodeWidth: Number(e.target.value) })
            }
          >
            {Array.from(new Set([180, 220, 280, 360, 440, settings.nodeWidth]))
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value} px
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Initial expanded depth">
          <NativeSelect
            value={settings.initialDepth}
            onChange={(e) =>
              onChange({ ...settings, initialDepth: Number(e.target.value) })
            }
          >
            {Array.from(new Set([1, 2, 3, 4, 6, 12, settings.initialDepth]))
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value} levels
                </option>
              ))}
          </NativeSelect>
        </Field>
        <div className="mindmap-detail-actions">
          <Button onClick={onExpandAll}>
            <ChevronsUpDown size={16} />
            Expand all
          </Button>
          <Button onClick={onFoldAll}>
            <ChevronsDownUp size={16} />
            Fold all
          </Button>
        </div>
      </div>
      {message && <Notice tone="warning">{message}</Notice>}
      <DialogFooter>
        {onSave && (
          <Button
            disabled={saving}
            onClick={() => {
              setSaving(true);
              setMessage("");
              void onSave()
                .then(() =>
                  setMessage(
                    "File defaults saved. Each reader keeps their own local presentation.",
                  ),
                )
                .catch((e) => setMessage(e.message))
                .finally(() => setSaving(false));
            }}
          >
            Save file defaults
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
