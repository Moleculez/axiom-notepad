"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

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
  useInterfaceLocale();
  const [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  return (
    <Dialog
      title={uiText("Mind-map display")}
      subtitle={uiText(
        "Local presentation preferences. Markdown and collaborators' views are unchanged.",
      )}
      onClose={onClose}
    >
      <div className="mindmap-options">
        <Field label={uiText("Block presentation")}>
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
              <I18nText id="Research-rich · equations and excerpts" />
            </option>
            <option value="compact">
              <I18nText id="Compact · concise labels" />
            </option>
          </NativeSelect>
        </Field>
        <label className="ui-choice">
          <Switch
            checked={presentation.minimap}
            onChange={(e) =>
              onPresentation({ ...presentation, minimap: e.target.checked })
            }
          />
          <span>
            <I18nText id="Map overview" />
          </span>
        </label>
        <label className="ui-choice">
          <Switch
            checked={presentation.supporting}
            onChange={(e) =>
              onPresentation({ ...presentation, supporting: e.target.checked })
            }
          />
          <span>
            <I18nText id="Supporting material · metadata and definitions" />
          </span>
        </label>
        <Field label={uiText("Direction")}>
          <NativeSelect
            value={settings.layout}
            onChange={(e) =>
              onChange({
                ...settings,
                layout: e.target.value as MindmapSettings["layout"],
              })
            }
          >
            <option value="right">
              <I18nText id="Rightward" />
            </option>
            <option value="left">
              <I18nText id="Leftward" />
            </option>
            <option value="balanced">
              <I18nText id="Balanced" />
            </option>
          </NativeSelect>
        </Field>
        <Field label={uiText("Spacing")}>
          <NativeSelect
            value={settings.spacing}
            onChange={(e) =>
              onChange({
                ...settings,
                spacing: e.target.value as MindmapSettings["spacing"],
              })
            }
          >
            <option value="comfortable">
              <I18nText id="Comfortable" />
            </option>
            <option value="compact">
              <I18nText id="Compact" />
            </option>
          </NativeSelect>
        </Field>
        <Field label={uiText("Branch colors")}>
          <NativeSelect
            value={settings.colors}
            onChange={(e) =>
              onChange({
                ...settings,
                colors: e.target.value as MindmapSettings["colors"],
              })
            }
          >
            <option value="accent">
              <I18nText id="Theme accent" />
            </option>
            <option value="spectrum">
              <I18nText id="Theme spectrum" />
            </option>
          </NativeSelect>
        </Field>
        <Field label={uiText("Node width")}>
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
                  {value} <I18nText id="px" />
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label={uiText("Initial expanded depth")}>
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
                  {value} <I18nText id="levels" />
                </option>
              ))}
          </NativeSelect>
        </Field>
        <div className="mindmap-detail-actions">
          <Button onClick={onExpandAll}>
            <ChevronsUpDown size={16} />
            <I18nText id="Expand all" />
          </Button>
          <Button onClick={onFoldAll}>
            <ChevronsDownUp size={16} />
            <I18nText id="Fold all" />
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
            <I18nText id="Save file defaults" />
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>
          <I18nText id="Done" />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
