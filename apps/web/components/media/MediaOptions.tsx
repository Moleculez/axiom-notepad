"use client";
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
  const image = mime.startsWith("image/"),
    update = (patch: Partial<MediaInsertionOptions>) =>
      onChange({ ...value, ...patch });
  return (
    <div className="media-options">
      <label>
        Insert as
        <NativeSelect
          aria-label="Insert as"
          value={value.display}
          onChange={(e) =>
            update({
              display: e.target.value as MediaInsertionOptions["display"],
            })
          }
        >
          <option value="link">Text link</option>
          <option value="card">File card</option>
          <option value="preview">Inline preview</option>
          {image && (
            <>
              <option value="image">Image</option>
              <option value="figure">Numbered figure</option>
            </>
          )}
        </NativeSelect>
      </label>
      <label>
        {image ? "Alternative text" : "Link label"}
        <TextInput
          value={value.alt}
          placeholder={
            image ? "Describe the image for readers…" : "Use the filename"
          }
          onChange={(e) => update({ alt: e.target.value })}
        />
      </label>
      {value.display !== "link" && (
        <label>
          Caption
          <TextArea
            aria-label="Caption"
            rows={2}
            value={value.caption}
            placeholder="Optional · Markdown and math supported"
            onChange={(e) => update({ caption: e.target.value })}
          />
        </label>
      )}
      {value.display === "figure" && (
        <label>
          Figure label
          <TextInput
            value={value.label}
            placeholder="fig-experiment"
            pattern="(?:fig-)?[A-Za-z0-9_-]{1,80}"
            onChange={(e) => update({ label: e.target.value })}
          />
        </label>
      )}
      {image && value.display !== "link" && (
        <div className="media-options-pair">
          <label>
            Width <span>{value.width}%</span>
            <Slider
              aria-label="Image width"
              aria-valuetext={`${value.width}% of the page`}

              min={10}
              max={100}
              step={5}
              value={value.width}
              onChange={(e) => update({ width: Number(e.target.value) })}
            />
          </label>
          <label>
            Alignment
            <NativeSelect
              value={value.align}
              onChange={(e) =>
                update({
                  align: e.target.value as MediaInsertionOptions["align"],
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </NativeSelect>
          </label>
        </div>
      )}
      {mime === "application/pdf" && (
        <label>
          Start at page
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
          Start at time (seconds)
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
