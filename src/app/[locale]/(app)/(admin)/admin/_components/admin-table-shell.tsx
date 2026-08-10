"use client";

import type { ReactNode } from "react";

interface AdminTableShellProps {
  /** Page title and whatever chrome sits beside it (a filter input, a description). */
  header: ReactNode;
  isLoading: boolean;
  loadingMessage: string;
  /** The action's server error, if it failed; takes precedence over the empty state. */
  errorMessage?: string;
  emptyMessage: string;
  hasData: boolean;
  /** The DataTable, rendered only once there is data to put in it. */
  children: ReactNode;
}

// The page chrome and the loading/error/empty ladder every admin table repeats around its
// DataTable. Only the header and the table itself differ, so only those are props.
export function AdminTableShell({
  header,
  isLoading,
  loadingMessage,
  errorMessage,
  emptyMessage,
  hasData,
  children,
}: AdminTableShellProps) {
  return (
    <div className="p-6 w-full min-w-0 flex flex-col overflow-hidden">
      <div className="flex-shrink-0">{header}</div>
      <div className="mt-8 flex-1 min-h-0">
        {isLoading || errorMessage || !hasData ? (
          <div>{isLoading ? loadingMessage : errorMessage || emptyMessage}</div>
        ) : (
          <div className="w-full min-w-0">{children}</div>
        )}
      </div>
    </div>
  );
}
