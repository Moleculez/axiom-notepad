"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, TextInput } from "./ui/controls";
import { useState } from "react";
export default function TablePicker({
  onInsert,
}: {
  onInsert: (rows: number, columns: number) => void;
}) {
  useInterfaceLocale();
  const [rows, setRows] = useState(2),
    [columns, setColumns] = useState(2);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onInsert(rows, columns);
      }}
    >
      <p className="muted">
        <I18nText id="A Markdown table with a header and editable data cells. Add more rows or columns while you write." />
      </p>
      <div className="table-picker-controls">
        <label>
          <I18nText id="Data rows" />
          <TextInput
            name="rows"
            aria-label={uiText("Table rows")}
            type="number"
            min={1}
            max={100}
            value={rows}
            onChange={(e) => setRows(Number(e.target.value))}
          />
        </label>
        <label>
          <I18nText id="Columns" />
          <TextInput
            name="columns"
            aria-label={uiText("Table columns")}
            type="number"
            min={1}
            max={30}
            value={columns}
            onChange={(e) => setColumns(Number(e.target.value))}
          />
        </label>
      </div>
      <div
        className="table-picker-preview"
        aria-hidden="true"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(columns, 8))}, 1fr)`,
        }}
      >
        {Array.from(
          {
            length:
              Math.max(1, Math.min(rows + 1, 6)) *
              Math.max(1, Math.min(columns, 8)),
          },
          (_, i) => (
            <span
              className={i < Math.min(columns, 8) ? "header" : ""}
              key={i}
            />
          ),
        )}
      </div>
      <div className="dialog-footer">
        <Button className="button primary" type="submit">
          <I18nText id="Insert table" />
        </Button>
      </div>
    </form>
  );
}
