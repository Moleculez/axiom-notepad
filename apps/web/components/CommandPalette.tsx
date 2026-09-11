"use client";
import { useId, useState } from "react";
import { Search, ArrowUpRight } from "lucide-react";
import { ActionIcon } from "../lib/icons/ActionIcon";
import { editorCommandIcons } from "../lib/icons/editor-commands";
import {
  editorCommands,
  keysFor,
  shortcutLabel,
  shortcutPlatform,
  type EditorCommandId,
  type EditorPreferences,
} from "@axiom/shared/editor";
export default function CommandPalette({
  preferences,
  insertOnly = false,
  hasNote,
  offline,
  onExecute,
  tableActive = false,
}: {
  preferences: EditorPreferences;
  insertOnly?: boolean;
  hasNote: boolean;
  offline: boolean;
  onExecute: (id: EditorCommandId) => void;
  tableActive?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0),
    id = useId(),
    platform = shortcutPlatform();
  const commands = editorCommands.filter(
    (c) =>
      (!insertOnly || c.insert) &&
      `${c.label} ${c.category} ${c.keywords}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const active = Math.min(index, commands.length - 1);
  const disabled = (command: (typeof editorCommands)[number]) =>
    (command.scope === "table" && !tableActive) ||
    (!hasNote &&
      !["searchNotes", "shortcuts", "commands"].includes(command.id)) ||
    (command.id === "attachment" && offline);
  return (
    <div className="command-palette">
      <label className="command-search">
        <Search size={18} />
        <input
          autoFocus
          aria-label={insertOnly ? "Find a block" : "Find a command"}
          role="combobox"
          aria-controls={id}
          aria-expanded="true"
          aria-activedescendant={
            commands[active] ? id + "-" + commands[active].id : undefined
          }
          placeholder={
            insertOnly
              ? "Headings, math, tables, citations…"
              : "What would you like to do?"
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next =
                (active + (e.key === "ArrowDown" ? 1 : -1) + commands.length) %
                commands.length;
              setIndex(next);
              document
                .getElementById(id + "-" + commands[next]?.id)
                ?.scrollIntoView({ block: "nearest" });
            }
            if (
              e.key === "Enter" &&
              commands[active] &&
              !disabled(commands[active])
            ) {
              e.preventDefault();
              onExecute(commands[active].id);
            }
          }}
        />
      </label>
      <div
        role="listbox"
        id={id}
        aria-label={insertOnly ? "Insert blocks" : "Editor commands"}
        className="command-results"
      >
        {commands.map((c, i) => {
          return (
            <button
              type="button"
              role="option"
              id={id + "-" + c.id}
              aria-selected={i === active}
              aria-disabled={disabled(c)}
              key={c.id}
              onMouseMove={() => setIndex(i)}
              onClick={() => {
                if (!disabled(c)) onExecute(c.id);
              }}
            >
              <ActionIcon name={editorCommandIcons[c.id]} />
              <span>
                <strong>{c.label}</strong>
                <small>
                  {disabled(c)
                    ? c.id === "attachment"
                      ? "Reconnect to upload an attachment"
                      : c.scope === "table"
                        ? "Select a table cell first"
                        : "Open a note first"
                    : c.category +
                      (c.scope === "table"
                        ? " · select a table cell first"
                        : "")}
                </small>
              </span>
              <kbd>
                {keysFor(c.id, preferences, platform)
                  .map((k) => shortcutLabel(k, platform))
                  .join(" / ")}
              </kbd>
              <ArrowUpRight size={13} />
            </button>
          );
        })}
        {!commands.length && (
          <p className="muted command-empty">
            No commands match “{query}”. Try “math”, “code”, or “heading”.
          </p>
        )}
      </div>
      <div className="command-footer">
        <span>↑ ↓ Navigate · Enter Select · Esc Close</span>
        <span>{commands.length} commands</span>
      </div>
    </div>
  );
}
