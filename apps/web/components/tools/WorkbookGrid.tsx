"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Copy, Link, Snowflake, X } from "lucide-react";
import {
  cellAddress,
  columnName,
  parseCellAddress,
  workbookCellAnchor,
  workbookRange,
  workbookViewRows,
  type WorkbookSheet,
  type WorkbookStyle,
} from "@axiom/shared/workbook-preview";
type Cell = { row: number; column: number };
function offsets(sizes: number[]) {
  const values = [0];
  for (const size of sizes) values.push(values.at(-1)! + size);
  return values;
}
function at(values: number[], offset: number) {
  let low = 0,
    high = values.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (values[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, values.length - 2);
}
export default function WorkbookGrid({
  sheet,
  styles,
  resourceId,
  versionId,
}: {
  sheet: WorkbookSheet;
  styles: WorkbookStyle[];
  resourceId: string;
  versionId: string;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    dragging = useRef(false),
    id = useId();
  const [start, setStart] = useState<Cell>({ row: 0, column: 0 }),
    [end, setEnd] = useState<Cell>({ row: 0, column: 0 }),
    [query, setQuery] = useState(""),
    [address, setAddress] = useState("A1"),
    [sort, setSort] = useState<{ column: number; direction: "asc" | "desc" }>(),
    [freeze, setFreeze] = useState(true),
    [widths, setWidths] = useState(sheet.widths),
    [windowSize, setWindowSize] = useState({ width: 900, height: 500 }),
    [scroll, setScroll] = useState({ top: 0, left: 0 }),
    [message, setMessage] = useState("");
  const rows = useMemo(
    () => workbookViewRows(sheet, query, sort),
    [sheet, query, sort],
  );
  const y = useMemo(
      () => offsets(rows.map((r) => sheet.heights[r])),
      [rows, sheet],
    ),
    x = useMemo(() => offsets(widths), [widths]);
  const frozenRows = freeze && !query ? sheet.frozenRows : 0,
    frozenColumns = freeze ? sheet.frozenColumns : 0;
  const first = Math.max(frozenRows, at(y, scroll.top) - 3),
    last = Math.min(rows.length, at(y, scroll.top + windowSize.height) + 4);
  const firstColumn = Math.max(frozenColumns, at(x, scroll.left) - 2),
    lastColumn = Math.min(
      widths.length,
      at(x, scroll.left + windowSize.width) + 3,
    );
  const visibleRows = new Set([
    ...Array.from({ length: frozenRows }, (_, i) => i),
    ...Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i),
  ]);
  const visibleColumns = new Set([
    ...Array.from({ length: frozenColumns }, (_, i) => i),
    ...Array.from(
      { length: Math.max(0, lastColumn - firstColumn) },
      (_, i) => firstColumn + i,
    ),
  ]);
  const merges = query ? [] : sheet.merges;
  for (const merge of merges)
    if (
      merge.bottom >= first &&
      merge.top < last &&
      merge.right >= firstColumn &&
      merge.left < lastColumn
    ) {
      visibleRows.add(merge.top);
      visibleColumns.add(merge.left);
    }
  const mergeRows = useMemo(() => {
    const result = new Map<number, typeof merges>();
    for (const row of visibleRows)
      result.set(
        row,
        merges.filter((merge) => merge.top <= row && merge.bottom >= row),
      );
    return result;
    // Merged-cell lookup only covers the virtual viewport, never the full workbook.
  }, [
    sheet,
    query,
    first,
    last,
    firstColumn,
    lastColumn,
    frozenRows,
    frozenColumns,
  ]);
  const cell = sheet.rows[end.row]?.[end.column],
    from = rows.indexOf(start.row),
    to = rows.indexOf(end.row);
  const statistics = useMemo(() => {
    try {
      return workbookRange(sheet, rows, start, end);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [sheet, rows, start, end]);
  const select = (next: Cell, extend = false) => {
    if (!query) next = workbookCellAnchor(sheet, next);
    if (
      !sheet.rows[next.row] ||
      next.column < 0 ||
      next.column >= widths.length
    )
      return;
    if (!extend) setStart(next);
    setEnd(next);
    setAddress(cellAddress(next.row, next.column));
  };
  const reveal = (next: Cell) => {
    const node = viewport.current,
      index = rows.indexOf(next.row);
    if (!node || index < 0) return;
    const top = y[index] + 32,
      left = x[next.column] + 48;
    if (
      index >= frozenRows &&
      (top < node.scrollTop + 32 + y[frozenRows] ||
        top + sheet.heights[next.row] > node.scrollTop + node.clientHeight)
    )
      node.scrollTop = Math.max(0, top - 32 - y[frozenRows]);
    if (
      next.column >= frozenColumns &&
      (left < node.scrollLeft + 48 + x[frozenColumns] ||
        left + widths[next.column] > node.scrollLeft + node.clientWidth)
    )
      node.scrollLeft = Math.max(0, left - 48 - x[frozenColumns]);
  };
  const copy = async (link = false) => {
    try {
      if (link) {
        const url = new URL(`/workbench/files/${resourceId}`, location.origin);
        url.searchParams.set("version", versionId);
        url.hash = new URLSearchParams({
          sheet: sheet.name,
          cell: cellAddress(end.row, end.column),
        }).toString();
        await navigator.clipboard.writeText(url.href);
      } else {
        if ("error" in statistics) throw new Error(statistics.error);
        await navigator.clipboard.writeText(statistics.text);
      }
      setMessage(
        link
          ? "Cell link copied. Access permissions are unchanged."
          : "Selected cells copied as tab-separated values.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWindowSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(node);
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("blur", stop);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [query, sort]);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1)),
      target = parseCellAddress(params.get("cell") ?? "");
    let frame = 0;
    if (
      params.get("sheet") === sheet.name &&
      target &&
      target.row < sheet.rows.length &&
      target.column < sheet.widths.length
    ) {
      const anchor = workbookCellAnchor(sheet, target);
      select(anchor);
      frame = requestAnimationFrame(() => reveal(anchor));
    }
    return () => cancelAnimationFrame(frame);
  }, [sheet]);
  const keys = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || !rows.length || !widths.length) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copy();
      return;
    }
    let r = rows.indexOf(end.row),
      c = end.column;
    const merge = !query
      ? sheet.merges.find((m) => m.top === end.row && m.left === end.column)
      : undefined;
    if (merge && event.key === "ArrowDown") r = merge.bottom;
    if (merge && event.key === "ArrowRight") c = merge.right;
    if (event.key === "ArrowDown") r++;
    else if (event.key === "ArrowUp") r--;
    else if (event.key === "ArrowRight") c++;
    else if (event.key === "ArrowLeft") c--;
    else if (event.key === "Home") {
      c = 0;
      if (event.ctrlKey || event.metaKey) r = 0;
    } else if (event.key === "End") {
      c = widths.length - 1;
      if (event.ctrlKey || event.metaKey) r = rows.length - 1;
    } else if (event.key === "Escape") {
      setStart(end);
      return;
    } else return;
    event.preventDefault();
    const next = {
      row: rows[Math.max(0, Math.min(rows.length - 1, r))],
      column: Math.max(0, Math.min(widths.length - 1, c)),
    };
    select(next, event.shiftKey);
    reveal(next);
  };
  return (
    <section
      className="workbook-grid-shell"
      aria-label={`${sheet.name} worksheet`}
    >
      <div className="workbook-controls">
        <input
          aria-label="Filter worksheet rows"
          placeholder="Filter rows…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSort(undefined);
          }}
        />
        <button
          className="icon-button"
          aria-label="Sort selected column ascending"
          title={
            sheet.merges.length
              ? "Sorting is unavailable on sheets with merged cells"
              : "Sort selected column ascending"
          }
          disabled={!rows.length || !!sheet.merges.length}
          onClick={() => setSort({ column: end.column, direction: "asc" })}
        >
          <ArrowDownAZ size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Sort selected column descending"
          disabled={!rows.length || !!sheet.merges.length}
          onClick={() => setSort({ column: end.column, direction: "desc" })}
        >
          <ArrowUpAZ size={17} />
        </button>
        {sort && (
          <button
            className="icon-button"
            aria-label="Clear worksheet sorting"
            onClick={() => setSort(undefined)}
          >
            <X size={15} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Use workbook frozen panes"
          aria-pressed={freeze}
          title="Use workbook frozen panes"
          onClick={() => setFreeze(!freeze)}
        >
          <Snowflake size={17} />
        </button>
        <span className="tool-spacer" />
        <button
          className="icon-button"
          aria-label="Copy selected cells"
          title="Copy selected cells"
          onClick={() => void copy()}
        >
          <Copy size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Copy cell link"
          title="Copy cell link"
          onClick={() => void copy(true)}
        >
          <Link size={16} />
        </button>
      </div>
      <div className="workbook-formula">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const target = parseCellAddress(address);
            if (
              target &&
              rows.includes(target.row) &&
              target.column < widths.length
            ) {
              select(target);
              reveal(target);
              viewport.current?.focus();
            } else
              setMessage("That cell is outside this preview or filtered out.");
          }}
        >
          <input
            aria-label="Go to cell"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </form>
        <span aria-hidden="true">ƒx</span>
        <output
          aria-label="Cell formula or value"
          title={
            cell?.formula
              ? "Formula shown for inspection only; never evaluated"
              : undefined
          }
        >
          {cell?.formula ? `=${cell.formula}` : (cell?.text ?? "")}
        </output>
      </div>
      <div
        ref={viewport}
        className="workbook-viewport"
        role="grid"
        aria-label="Spreadsheet data"
        aria-readonly="true"
        aria-rowcount={rows.length + 1}
        aria-colcount={widths.length + 1}
        tabIndex={0}
        onKeyDown={keys}
        onScroll={(e) =>
          setScroll({
            top: e.currentTarget.scrollTop,
            left: e.currentTarget.scrollLeft,
          })
        }
        aria-activedescendant={
          visibleRows.has(to) && visibleColumns.has(end.column)
            ? `${id}-${end.row}-${end.column}`
            : undefined
        }
      >
        <div
          className="workbook-canvas"
          style={{ width: x.at(-1)! + 48, height: y.at(-1)! + 32 }}
        >
          <div
            role="row"
            aria-rowindex={1}
            className="workbook-column-row"
            style={{ top: scroll.top, width: x.at(-1)! + 48 }}
          >
            <div
              role="columnheader"
              className="workbook-corner"
              style={{ left: scroll.left }}
            />
            {[...visibleColumns]
              .sort((a, b) => a - b)
              .map((c) => (
                <div
                  role="columnheader"
                  aria-colindex={c + 2}
                  key={c}
                  className="workbook-column"
                  style={{
                    left: 48 + x[c] + (c < frozenColumns ? scroll.left : 0),
                    width: widths[c],
                    zIndex: c < frozenColumns ? 2 : 1,
                  }}
                >
                  {columnName(c)}
                  <span
                    role="separator"
                    tabIndex={0}
                    aria-orientation="vertical"
                    aria-label={`Resize column ${columnName(c)}`}
                    aria-valuenow={Math.round(widths[c])}
                    aria-valuemin={48}
                    aria-valuemax={500}
                    onKeyDown={(e) => {
                      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                        e.preventDefault();
                        e.stopPropagation();
                        setWidths((old) =>
                          old.map((w, i) =>
                            i === c
                              ? Math.max(
                                  48,
                                  Math.min(
                                    500,
                                    w + (e.key === "ArrowLeft" ? -10 : 10),
                                  ),
                                )
                              : w,
                          ),
                        );
                      }
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      e.currentTarget.dataset.start = String(e.clientX);
                      e.currentTarget.dataset.width = String(widths[c]);
                    }}
                    onPointerMove={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        const width =
                          Number(e.currentTarget.dataset.width) +
                          e.clientX -
                          Number(e.currentTarget.dataset.start);
                        setWidths((old) =>
                          old.map((w, i) =>
                            i === c ? Math.max(48, Math.min(500, width)) : w,
                          ),
                        );
                      }
                    }}
                    onPointerUp={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                  />
                </div>
              ))}
          </div>
          {[...visibleRows]
            .sort((a, b) => a - b)
            .map((index) => {
              const row = rows[index];
              if (row === undefined) return null;
              return (
                <div
                  role="row"
                  aria-rowindex={index + 2}
                  key={row}
                  className="workbook-row"
                  style={{
                    top: 32 + y[index] + (index < frozenRows ? scroll.top : 0),
                    height: sheet.heights[row],
                    width: x.at(-1)! + 48,
                    zIndex: index < frozenRows ? 3 : 1,
                  }}
                >
                  <div
                    role="rowheader"
                    className="workbook-row-number"
                    style={{ left: scroll.left, height: sheet.heights[row] }}
                  >
                    {row + 1}
                  </div>
                  {[...visibleColumns]
                    .sort((a, b) => a - b)
                    .map((column) => {
                      const merged = mergeRows
                        .get(index)
                        ?.find((m) => m.left <= column && m.right >= column);
                      if (
                        merged &&
                        (merged.top !== row || merged.left !== column)
                      )
                        return null;
                      const cell = sheet.rows[row][column],
                        style = styles[cell?.style ?? 0] ?? {},
                        selected =
                          index >= Math.min(from, to) &&
                          index <= Math.max(from, to) &&
                          column >= Math.min(start.column, end.column) &&
                          column <= Math.max(start.column, end.column);
                      return (
                        <div
                          role="gridcell"
                          aria-colindex={column + 2}
                          aria-label={cellAddress(row, column)}
                          aria-selected={selected}
                          aria-rowspan={
                            merged ? merged.bottom - merged.top + 1 : undefined
                          }
                          aria-colspan={
                            merged ? merged.right - merged.left + 1 : undefined
                          }
                          id={`${id}-${row}-${column}`}
                          key={column}
                          className={`workbook-cell ${selected ? "selected" : ""}`}
                          title={cell?.text}
                          style={{
                            left:
                              48 +
                              x[column] +
                              (column < frozenColumns ? scroll.left : 0),
                            width: merged
                              ? x[merged.right + 1] - x[column]
                              : widths[column],
                            height: merged
                              ? y[merged.bottom + 1] - y[row]
                              : sheet.heights[row],
                            zIndex: column < frozenColumns ? 2 : 1,
                            fontWeight: style.bold ? 650 : undefined,
                            fontStyle: style.italic ? "italic" : undefined,
                            color: style.color,
                            background: style.background,
                            textAlign:
                              style.align ??
                              (cell?.number !== undefined ? "right" : "left"),
                            fontSize: style.fontSize,
                            whiteSpace: style.wrap ? "normal" : undefined,
                            textDecoration: style.underline
                              ? "underline"
                              : undefined,
                            borderColor: style.border ? "#9ca3af" : undefined,
                          }}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            dragging.current = true;
                            select({ row, column }, e.shiftKey);
                            viewport.current?.focus({ preventScroll: true });
                          }}
                          onPointerEnter={() => {
                            if (dragging.current) select({ row, column }, true);
                          }}
                        >
                          {cell?.text}
                        </div>
                      );
                    })}
                </div>
              );
            })}
        </div>
      </div>
      <footer className="workbook-status">
        <span>
          {rows.length.toLocaleString()} rows · {widths.length} columns ·
          Read-only
        </span>
        <span>
          {"error" in statistics
            ? statistics.error
            : `Count ${statistics.count}${statistics.numbers ? ` · Sum ${statistics.sum.toLocaleString()} · Average ${statistics.average.toLocaleString()}` : ""}`}
        </span>
      </footer>
      {message && (
        <p className="ws-note" role="status">
          {message}
          <button className="text-button" onClick={() => setMessage("")}>
            Dismiss
          </button>
        </p>
      )}
    </section>
  );
}
