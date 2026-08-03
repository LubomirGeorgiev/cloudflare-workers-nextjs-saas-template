"use client";

import { parseAsInteger, useQueryState } from "nuqs";

import { DEFAULT_ADMIN_TABLE_PAGE_SIZE } from "@/constants";
import { getValidPageNumber } from "@/utils/get-valid-page-number";

/**
 * The URL-backed page/pageSize pair every admin table uses. Parsed as integers by nuqs rather than
 * round-tripped through `parseInt` at each use site, and validated, so a hand-edited `?page=0` or
 * `?page=abc` falls back to page 1 instead of reaching the query as NaN.
 */
export function useAdminTablePagination() {
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [pageSize, setPageSize] = useQueryState(
    "pageSize",
    parseAsInteger.withDefault(DEFAULT_ADMIN_TABLE_PAGE_SIZE),
  );

  const currentPage = getValidPageNumber({ value: page }) ?? 1;

  return {
    page: currentPage,
    pageSize,
    /** DataTable counts pages from zero; the URL counts from one. */
    pageIndex: currentPage - 1,
    onPageChange: (nextPageIndex: number) => setPage(nextPageIndex + 1),
    onPageSizeChange: (nextPageSize: number) => {
      setPageSize(nextPageSize);
      // A row that was on page 4 of 10 may not exist on page 4 of 50.
      setPage(1);
    },
    resetToFirstPage: () => setPage(1),
  };
}
