"use client";

import { useId, useState } from "react";
import { VibeButton } from "./vibe-button";
import { VibeField } from "./vibe-field";
import { VibeIcon } from "./vibe-icon";

const PAGE_SIZE = 20;

interface TablePaginationControls {
  currentPage: number;
  pageCount: number;
  total: number;
  pageInput: string | null;
  changePage(page: number): void;
  setPageInput(value: string): void;
}

export function useTablePagination<T>(items: readonly T[], scope = "") {
  const [state, setState] = useState({ scope, page: 1, input: null as string | null });
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = state.scope === scope ? Math.min(state.page, pageCount) : 1;
  const pageInput = state.scope === scope && state.page === currentPage ? state.input : null;
  if (state.scope !== scope || state.page !== currentPage) {
    setState({ scope, page: currentPage, input: null });
  }
  const controls: TablePaginationControls = {
    currentPage,
    pageCount,
    total: items.length,
    pageInput,
    changePage(page) {
      if (Number.isInteger(page) && page >= 1 && page <= pageCount) {
        setState({ scope, page, input: null });
      }
    },
    setPageInput(input) {
      setState({ scope, page: currentPage, input });
    },
  };
  return {
    visibleItems: items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    controls,
  };
}

export function VibeTablePagination({
  label,
  pagination: { currentPage, pageCount, total, pageInput, changePage, setPageInput },
}: {
  label: string;
  pagination: TablePaginationControls;
}) {
  const fieldId = useId();
  if (total === 0) return null;
  return (
    <nav aria-label={label} className="vibe-table-pagination">
      <span className="vibe-table-pagination__summary" role="status">
        第 {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, total)} 条，共 {total} 条
      </span>
      <div className="vibe-table-pagination__actions">
        <VibeButton type="button" variant="outline" shape="square" aria-label="上一页" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>
          <VibeIcon name="arrow-left" />
        </VibeButton>
        <form className="vibe-table-pagination__jump" onSubmit={event => {
          event.preventDefault();
          changePage(Number(pageInput ?? currentPage));
        }}>
          <VibeField fieldId={fieldId} label="跳转页码" density="compact" aria-label="跳转页码" type="number" inputMode="numeric" min={1} max={pageCount} step={1} required value={pageInput ?? String(currentPage)} onFocus={event => event.target.select()} onChange={event => setPageInput(event.target.value)} />
          <span>/ {pageCount} 页</span>
          <VibeButton type="submit" variant="text">跳转</VibeButton>
        </form>
        <VibeButton type="button" variant="outline" shape="square" aria-label="下一页" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>
          <VibeIcon name="arrow-right" />
        </VibeButton>
      </div>
    </nav>
  );
}
