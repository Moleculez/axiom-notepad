"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import type { ArchivePage } from "@axiom/shared/planning-archives";
import {
  ActionRow,
  Button,
  HelpText,
  NativeSelect,
  SearchField,
} from "../ui/controls";
import { useData } from "./ui";

type Filters = { q: string; sort: "oldest" | "newest"; limit: number };
/** Only summary search is debounced. Edits, mutations and version fences are not. */
export function usePlanningArchive<
  F extends Filters,
  P extends ArchivePage<unknown>,
>(endpoint: string, initial: F, revision = 0, enabled = true) {
  const [filters, setFilters] = useState(initial);
  const [search, setSearch] = useState(initial.q);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    resultsRef.current?.scrollTo({ top: 0 });
  }, [cursors, filters]);
  const set = (patch: Partial<F>) => {
    setFilters((old) => ({ ...old, ...patch }));
    setCursors([null]);
  };
  useEffect(() => {
    if (search.trim() === filters.q) return;
    const timer = setTimeout(() => {
      setFilters((old) => ({ ...old, q: search.trim() }));
      setCursors([null]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, filters.q]);
  const cursor = cursors.at(-1);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== "") params.set(key, String(value));
  if (cursor) params.set("cursor", cursor);
  const data = useData<P>(enabled ? `${endpoint}?${params}` : null, revision);
  const refresh = () => {
    if (cursor) setCursors([null]);
    else data.reload();
  };
  const reset = () => {
    setSearch(initial.q);
    setFilters(initial);
    setCursors([null]);
  };
  return {
    filters,
    search,
    setSearch,
    set,
    reset,
    refresh,
    data,
    resultsRef,
    first: () => setCursors([null]),
    pagination: {
      page: cursors.length,
      limit: filters.limit,
      count: data.data?.items.length ?? 0,
      // A peer refresh must not disable a loaded button between pointerdown and
      // click. A foreground page change has no current-target data and is gated.
      loading: data.loading && !data.data,
      hasPrevious: cursors.length > 1,
      hasNext: !!data.data?.nextCursor && !data.error,
      onPrevious: () => setCursors((old) => old.slice(0, -1)),
      onNext: () => {
        const next = data.data?.nextCursor;
        if (next) setCursors((old) => [...old, next]);
      },
      onLimit: (limit: number) => set({ limit } as Partial<F>),
    },
  };
}
export function ArchiveSearch({
  label,
  search,
  onSearch,
  sort,
  onSort,
  loading,
  onRefresh,
  children,
}: {
  label: string;
  search: string;
  onSearch: (value: string) => void;
  sort?: Filters["sort"];
  onSort?: (value: Filters["sort"]) => void;
  loading: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="planning-archive-search">
      <SearchField
        aria-label={label}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onClear={() => onSearch("")}
        placeholder={label}
      />
      {children}
      {sort && onSort && (
        <NativeSelect
          aria-label={`${label} order`}
          value={sort}
          onChange={(e) => onSort(e.target.value as Filters["sort"])}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </NativeSelect>
      )}
      <Button
        size="compact"
        variant="ghost"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshCw size={14} />
        Refresh
      </Button>
    </div>
  );
}
export function ArchivePagination({
  label,
  page,
  limit,
  count,
  loading,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onLimit,
}: {
  label: string;
  page: number;
  limit: number;
  count: number;
  loading: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onLimit: (limit: number) => void;
}) {
  return (
    <nav className="planning-archive-pagination" aria-label={`${label} pages`}>
      <HelpText aria-live="polite">
        Page {page} · {count} shown
      </HelpText>
      <NativeSelect
        aria-label={`${label} per page`}
        value={limit}
        onChange={(e) => onLimit(Number(e.target.value))}
      >
        {[15, 30, 60, 100].map((n) => (
          <option key={n} value={n}>
            {n} per page
          </option>
        ))}
      </NativeSelect>
      <ActionRow>
        <Button
          size="compact"
          disabled={loading || !hasPrevious}
          onClick={onPrevious}
        >
          <ArrowLeft size={14} />
          Previous
        </Button>
        <Button size="compact" disabled={loading || !hasNext} onClick={onNext}>
          Next
          <ArrowRight size={14} />
        </Button>
      </ActionRow>
    </nav>
  );
}
