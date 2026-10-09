"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Slider, NativeSelect, TextInput, TextArea } from "../ui/controls";
import type { MediaInsertionOptions } from "../../lib/media-insertion";
export default function MediaOptions({
  value,
  onChange,
  mime,
}: {
  value: MediaInsertionOptions;
  onChange: (value: MediaInsertionOptions) => void;
  mime: string;
}) {
  useInterfaceLocale();
  const image = mime.startsWith("image/"),
    update = (patch: Partial<MediaInsertionOptions>) =>
      onChange({ ...value, ...patch });
  return (
    <div className="media-options">
      <label>
        <I18nText id="Insert as" />
        <NativeSelect
          aria-label={uiText("Insert as")}
          value={value.display}
          onChange={(e) =>
            update({
              display: e.target.value as MediaInsertionOptions["display"],
            })
          }
        >
          <option value="link">
            <I18nText id="Text link" />
          </option>
          <option value="card">
            <I18nText id="File card" />
          </option>
          <option value="preview">
            <I18nText id="Inline preview" />
          </option>
          {image && (
            <>
              <option value="image">
                <I18nText id="Image" />
              </option>
              <option value="figure">
                <I18nText id="Numbered figure" />
              </option>
            </>
          )}
        </NativeSelect>
      </label>
      <label>
        {image ? uiText("Alternative text") : uiText("Link label")}
        <TextInput
          value={value.alt}
          placeholder={
            image
              ? uiText("Describe the image for readers…")
              : uiText("Use the filename")
          }
          onChange={(e) => update({ alt: e.target.value })}
        />
      </label>
      {value.display !== "link" && (
        <label>
          <I18nText id="Caption" />
          <TextArea
            aria-label={uiText("Caption")}
            rows={2}
            value={value.caption}
            placeholder={uiText("Optional · Markdown and math supported")}
            onChange={(e) => update({ caption: e.target.value })}
          />
        </label>
      )}
      {value.display === "figure" && (
        <label>
          <I18nText id="Figure label" />
          <TextInput
            value={value.label}
            placeholder={uiText("fig-experiment")}
            pattern="(?:fig-)?[A-Za-z0-9_-]{1,80}"
            onChange={(e) => update({ label: e.target.value })}
          />
        </label>
      )}
      {image && value.display !== "link" && (
        <div className="media-options-pair">
          <label>
            <I18nText id="Width" /> <span>{value.width}%</span>
            <Slider
              aria-label={uiText("Image width")}
              aria-valuetext={`${value.width}% of the page`}

              min={10}
              max={100}
              step={5}
              value={value.width}
              onChange={(e) => update({ width: Number(e.target.value) })}
            />
          </label>
          <label>
            <I18nText id="Alignment" />
            <NativeSelect
              value={value.align}
              onChange={(e) =>
                update({
                  align: e.target.value as MediaInsertionOptions["align"],
                })
              }
            >
              <option value="left">
                <I18nText id="Left" />
              </option>
              <option value="center">
                <I18nText id="Center" />
              </option>
              <option value="right">
                <I18nText id="Right" />
              </option>
            </NativeSelect>
          </label>
        </div>
      )}
      {mime === "application/pdf" && (
        <label>
          <I18nText id="Start at page" />
          <TextInput
            type="number"
            min={1}
            max={100000}
            value={value.page}
            onChange={(e) =>
              update({
                page: Math.max(
                  1,
                  Math.min(100000, Number(e.target.value) || 1),
                ),
              })
            }
          />
        </label>
      )}
      {/^(audio|video)\//.test(mime) && (
        <label>
          <I18nText id="Start at time (seconds)" />
          <TextInput
            type="number"
            min={0}
            max={86400}
            value={value.time}
            onChange={(e) =>
              update({
                time: Math.max(0, Math.min(86400, Number(e.target.value) || 0)),
              })
            }
          />
        </label>
      )}
    </div>
  );
}
