"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, PackageOpen, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables click-to-sort on this column when provided. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
  className?: string;
};

export type DataTableFilter<T> = {
  id: string;
  label: string;
  options: { label: string; value: string }[];
  predicate: (row: T, value: string) => boolean;
};

const DEFAULT_PAGE_SIZE = 10;
const ALL_VALUE = "__all__";

export function DataTable<T>({
  columns,
  data,
  getRowId,
  isLoading = false,
  searchPlaceholder = "Rechercher...",
  searchValue,
  onSearchChange,
  searchFields,
  filters,
  rowActions,
  onRowClick,
  selectable = true,
  emptyTitle = "Aucun résultat",
  emptyDescription,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;
  isLoading?: boolean;
  searchPlaceholder?: string;
  /** Controlled search — pass this + onSearchChange when the parent already
   * filters `data` itself (e.g. a server-side search query). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Uncontrolled local search — filters `data` client-side by these fields. */
  searchFields?: (row: T) => (string | null | undefined)[];
  filters?: DataTableFilter<T>[];
  rowActions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
}) {
  const isControlledSearch = searchValue !== undefined;
  const [localSearch, setLocalSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ columnId: string; direction: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const search = isControlledSearch ? (searchValue ?? "") : localSearch;

  const filtered = useMemo(() => {
    let rows = data;

    if (!isControlledSearch && searchFields && search.trim()) {
      const needle = search.trim().toLowerCase();
      rows = rows.filter((row) =>
        searchFields(row).some((field) => field?.toLowerCase().includes(needle)),
      );
    }

    if (filters) {
      for (const filter of filters) {
        const value = activeFilters[filter.id];
        if (value && value !== ALL_VALUE) {
          rows = rows.filter((row) => filter.predicate(row, value));
        }
      }
    }

    return rows;
  }, [data, isControlledSearch, searchFields, search, filters, activeFilters]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((c) => c.id === sort.columnId);
    if (!column?.sortValue) return filtered;

    const withValues = filtered.map((row) => ({ row, value: column.sortValue!(row) }));
    withValues.sort((a, b) => {
      if (a.value < b.value) return sort.direction === "asc" ? -1 : 1;
      if (a.value > b.value) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
    return withValues.map((w) => w.row);
  }, [filtered, sort, columns]);

  const hasActiveQuery =
    Boolean(search.trim()) || Object.values(activeFilters).some((v) => v && v !== ALL_VALUE);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleSort(columnId: string) {
    setPage(1);
    setSort((current) => {
      if (current?.columnId !== columnId) return { columnId, direction: "asc" };
      if (current.direction === "asc") return { columnId, direction: "desc" };
      return null;
    });
  }

  function handleSearchChange(value: string) {
    setPage(1);
    if (isControlledSearch) onSearchChange?.(value);
    else setLocalSearch(value);
  }

  function handleFilterChange(filterId: string, value: string) {
    setPage(1);
    setActiveFilters((current) => ({ ...current, [filterId]: value }));
  }

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((row) => selected.has(getRowId(row)));

  function toggleSelectAllOnPage() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) {
        for (const row of pageRows) next.delete(getRowId(row));
      } else {
        for (const row of pageRows) next.add(getRowId(row));
      }
      return next;
    });
  }

  function toggleRowSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasToolbar = onSearchChange || searchFields || (filters && filters.length > 0);

  return (
    <div className="space-y-3">
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {(isControlledSearch || searchFields) && (
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              className="max-w-xs"
            />
          )}
          {filters?.map((filter) => (
            <Select
              key={filter.id}
              value={activeFilters[filter.id] ?? ALL_VALUE}
              onValueChange={(value) => handleFilterChange(filter.id, value)}
            >
              <SelectTrigger className="w-auto min-w-36">
                <SelectValue placeholder={filter.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{filter.label} : tous</SelectItem>
                {filter.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleSelectAllOnPage}
                    aria-label="Tout sélectionner"
                    disabled={pageRows.length === 0}
                  />
                </TableHead>
              )}
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    "text-xs font-semibold tracking-wide text-muted-foreground uppercase",
                    column.align === "right" && "text-right",
                    column.className,
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.id)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {column.header}
                      {sort?.columnId === column.id ? (
                        sort.direction === "asc" ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
              {rowActions && <TableHead className="w-px" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  Chargement...
                </TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                  className="h-40 text-center"
                >
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    {hasActiveQuery ? (
                      <>
                        <SearchX className="size-8 opacity-40" strokeWidth={1.5} />
                        <p className="text-sm font-medium text-foreground">Aucun résultat</p>
                        <p className="text-sm">Essayez une autre recherche ou d&apos;autres filtres.</p>
                      </>
                    ) : (
                      <>
                        <PackageOpen className="size-8 opacity-40" strokeWidth={1.5} />
                        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                        {emptyDescription && <p className="text-sm">{emptyDescription}</p>}
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => {
                const id = getRowId(row);
                return (
                  <TableRow
                    key={id}
                    data-state={selected.has(id) ? "selected" : undefined}
                    onClick={() => onRowClick?.(row)}
                    className={cn("h-14", onRowClick && "cursor-pointer")}
                  >
                    {selectable && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(id)}
                          onCheckedChange={() => toggleRowSelected(id)}
                          aria-label="Sélectionner la ligne"
                        />
                      </TableCell>
                    )}
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn(column.align === "right" && "text-right", column.className)}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell
                        className="text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">{rowActions(row)}</div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {sorted.length > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            Page {currentPage} sur {totalPages} · {sorted.length} résultats
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
