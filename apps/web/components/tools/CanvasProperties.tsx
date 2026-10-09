"use client";
import { uiText, useInterfaceLocale, I18nText } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  HelpText,
  NativeSelect,
  TextInput,
} from "../ui/controls";
import { useEffect, useState, type ReactNode } from "react";
import {
  canvasTitle,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
} from "@axiom/shared/canvas";
import { canvasSides } from "@axiom/shared/canvas-geometry";
import type { ResourceCardPreview } from "@axiom/shared/canvas-preview";

export default function CanvasProperties({
  node,
  edge,
  data,
  preview,
  readOnly,
  updateNode,
  updateEdge,
  changeFile,
  fitGroup,
}: {
  node?: CanvasNode;
  edge?: CanvasEdge;
  data: CanvasData;
  preview?: ResourceCardPreview;
  readOnly: boolean;
  updateNode: (changes: Record<string, unknown>) => boolean;
  updateEdge: (changes: Record<string, unknown>) => boolean;
  changeFile: () => void;
  fitGroup: () => void;
}) {
  useInterfaceLocale();
  if (!node && !edge)
    return (
      <HelpText>
        <I18nText id="Select one card or connection to inspect its properties." />
      </HelpText>
    );
  return (
    <fieldset className="canvas-properties" disabled={readOnly}>
      {node && (
        <>
          <Property label={uiText("Name")}>
            <Draft
              value={
                node.title ?? (node.type === "group" ? (node.label ?? "") : "")
              }
              label={uiText("Card name")}
              max={200}
              save={(title) =>
                updateNode({
                  title,
                  ...(node.type === "group" ? { label: title } : {}),
                })
              }
            />
          </Property>
          <Property label={uiText("Tags")}>
            <Draft
              value={(node.tags ?? []).join(", ")}
              label={uiText("Card tags")}
              max={820}
              save={(value) =>
                updateNode({
                  tags: [
                    ...new Set(
                      value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    ),
                  ],
                })
              }
            />
            <small>
              <I18nText id="Comma-separated · up to 20 tags" />
            </small>
          </Property>
          {node.type === "link" && (
            <Property label={uiText("Web address")}>
              <Draft
                value={node.url}
                label={uiText("Web address")}
                max={4000}
                save={(url) => updateNode({ url })}
              />
              <small>
                <I18nText id="External pages load only when you choose Interact. Some sites do not allow embedding." />
              </small>
            </Property>
          )}
          {node.type === "file" && (
            <>
              <Property label={uiText("Linked resource")}>
                <span className="canvas-property-value">
                  {preview?.resource.name ?? node.file}
                </span>
                <Button
                  type="button"
                  className="button secondary"
                  onClick={changeFile}
                >
                  <I18nText id="Change file…" />
                </Button>
              </Property>
              <label className="canvas-property-toggle">
                <Checkbox
                  checked={!node.versionId}
                  disabled={
                    readOnly || (preview?.kind !== "file" && !node.versionId)
                  }
                  onChange={(e) =>
                    updateNode({
                      versionId: e.target.checked
                        ? undefined
                        : preview?.kind === "file"
                          ? preview.file.versionId
                          : undefined,
                    })
                  }
                />
                <span>
                  <I18nText id="Follow latest version" />
                  <small>
                    {node.versionId
                      ? uiText("Pinned to a saved file version")
                      : uiText("Updates when the linked resource changes")}
                  </small>
                </span>
              </label>
              <Property label={uiText("Image fit")}>
                <NativeSelect
                  aria-label={uiText("Image fit")}
                  value={node.fit ?? "contain"}
                  onChange={(e) => updateNode({ fit: e.target.value })}
                >
                  <option value="contain">
                    <I18nText id="Show entire image" />
                  </option>
                  <option value="cover">
                    <I18nText id="Fill card" />
                  </option>
                </NativeSelect>
              </Property>
              {preview?.kind === "file" && preview.file.kind === "pdf" && (
                <Property label={uiText("Preview page")}>
                  <Draft
                    label={uiText("Preview page")}
                    value={String(node.previewPage ?? 1)}
                    type="number"
                    save={(value) => updateNode({ previewPage: Number(value) })}
                  />
                </Property>
              )}
            </>
          )}
          <hr />
          <label className="canvas-property-toggle">
            <Checkbox
              checked={!!node.locked}
              onChange={(e) => updateNode({ locked: e.target.checked })}
            />
            <span>
              <I18nText id="Lock position and size" />
              <small>
                <I18nText id="Content remains editable." />
              </small>
            </span>
          </label>
          {node.type !== "group" && (
            <label className="canvas-property-toggle">
              <Checkbox
                checked={node.heightMode === "auto"}
                disabled={readOnly || !!node.locked}
                onChange={(e) =>
                  updateNode({
                    heightMode: e.target.checked ? "auto" : "manual",
                  })
                }
              />
              <span>
                <I18nText id="Automatic height" />
                <small>
                  <I18nText id="Fits content between 120 and 800 px. Width stays fixed." />
                </small>
              </span>
            </label>
          )}
          <div className="canvas-property-pair">
            <Property label={uiText("Width")}>
              <Draft
                label={uiText("Card width")}
                type="number"
                disabled={!!node.locked}
                value={String(node.width)}
                save={(v) => updateNode({ width: Number(v) })}
              />
            </Property>
            <Property label={uiText("Height")}>
              <Draft
                label={uiText("Card height")}
                type="number"
                disabled={!!node.locked}
                value={String(node.height)}
                save={(v) =>
                  updateNode({ height: Number(v), heightMode: "manual" })
                }
              />
            </Property>
          </div>
          {node.type === "group" && (
            <Button
              type="button"
              className="button secondary"
              disabled={!!node.locked}
              onClick={fitGroup}
            >
              <I18nText id="Fit around contained cards" />
            </Button>
          )}
          <HelpText>
            {node.type} · {node.id}
          </HelpText>
        </>
      )}
      {edge && (
        <>
          <Property label={uiText("Label")}>
            <Draft
              label={uiText("Connection label")}
              value={edge.label ?? ""}
              max={1000}
              save={(label) => updateEdge({ label })}
            />
          </Property>
          {(["from", "to"] as const).map((end) => (
            <div className="canvas-connection-properties" key={end}>
              <Property
                label={end === "from" ? uiText("From card") : uiText("To card")}
              >
                <NativeSelect
                  aria-label={`${end} card`}
                  value={edge[`${end}Node`]}
                  onChange={(e) =>
                    updateEdge({ [`${end}Node`]: e.target.value })
                  }
                >
                  {data.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {canvasTitle(n)}
                    </option>
                  ))}
                </NativeSelect>
              </Property>
              <div className="canvas-property-pair">
                <Property label={uiText("Port")}>
                  <NativeSelect
                    aria-label={`${end} port`}
                    value={
                      edge[`${end}Side`] ?? (end === "from" ? "right" : "left")
                    }
                    onChange={(e) =>
                      updateEdge({ [`${end}Side`]: e.target.value })
                    }
                  >
                    {canvasSides.map((side) => (
                      <option key={side}>{side}</option>
                    ))}
                  </NativeSelect>
                </Property>
                <Property label={uiText("Arrow")}>
                  <NativeSelect
                    aria-label={`${end} arrow`}
                    value={
                      edge[`${end}End`] ?? (end === "to" ? "arrow" : "none")
                    }
                    onChange={(e) =>
                      updateEdge({ [`${end}End`]: e.target.value })
                    }
                  >
                    <option value="none">
                      <I18nText id="None" />
                    </option>
                    <option value="arrow">
                      <I18nText id="Arrow" />
                    </option>
                  </NativeSelect>
                </Property>
              </div>
            </div>
          ))}
          <small>
            <I18nText id="Change a card or port here to reconnect without deleting the connection." />
          </small>
        </>
      )}
    </fieldset>
  );
}
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="canvas-property">
      <span>{label}</span>
      {children}
    </div>
  );
}
function Draft({
  value,
  label,
  save,
  max,
  type = "text",
  disabled = false,
}: {
  value: string;
  label: string;
  save: (v: string) => boolean;
  max?: number;
  type?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value),
    [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const commit = () => {
    if (draft !== value && !save(draft)) setDraft(value);
    setFocused(false);
  };
  return (
    <TextInput
      aria-label={label}
      type={type}
      maxLength={max}
      disabled={disabled}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          setFocused(false);
        }
      }}
    />
  );
}
