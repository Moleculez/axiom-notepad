"use client";
import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { MindmapSettings } from "@axiom/mindmap";
import Dialog, { DialogFooter } from "../Dialog";
import { Button, Field, NativeSelect, Notice, Switch } from "../ui/controls";
import type { MindmapPresentation } from "../../lib/mindmap-state";

/** Presentation controls do not acquire document authority or change Markdown. */
export default function MindmapDisplayDialog({
  settings,
  onChange,
  onFoldAll,
  onExpandAll,
  onSave,
  onClose,
  presentation,
  onPresentation,
}: {
  settings: MindmapSettings;
  onChange: (settings: MindmapSettings) => void;
  onFoldAll: () => void;
  onExpandAll: () => void;
  onSave?: () => Promise<void>;
  onClose: () => void;
  presentation: MindmapPresentation;
  onPresentation: (value: MindmapPresentation) => void;
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
        <Field label="Block presentation">
          <NativeSelect
            value={presentation.preview}
            onChange={(e) =>
              onPresentation({
                ...presentation,
                preview: e.target.value as MindmapPresentation["preview"],
              })
            }
          >
            <option value="research">
              Research-rich · equations and excerpts
            </option>
            <option value="compact">Compact · concise labels</option>
          </NativeSelect>
        </Field>
        <label className="ui-choice">
          <Switch
            checked={presentation.minimap}
            onChange={(e) =>
              onPresentation({ ...presentation, minimap: e.target.checked })
            }
          />
          <span>Map overview</span>
        </label>
        <label className="ui-choice">
          <Switch
            checked={presentation.supporting}
            onChange={(e) =>
              onPresentation({ ...presentation, supporting: e.target.checked })
            }
          />
          <span>Supporting material · metadata and definitions</span>
        </label>
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
                    "File layout defaults saved. Block previews and the overview remain local to each reader.",
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
