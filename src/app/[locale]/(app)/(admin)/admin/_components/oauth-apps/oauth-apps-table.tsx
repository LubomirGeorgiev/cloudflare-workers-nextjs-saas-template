"use client";

import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS } from "@/constants";
import { AdminTableShell } from "../admin-table-shell";
import { useAdminTablePagination } from "../use-admin-table-pagination";
import {
  deleteOAuthAppAction,
  getOAuthAppsAction,
  setOAuthAppVerifiedAction,
} from "../../_actions/oauth-apps-actions";
import { createOAuthAppColumns, type OAuthAppRow } from "./columns";

export function OAuthAppsTable() {
  const t = useTranslations("Client.Admin.OAuthApps");
  const { page, pageSize, pageIndex, onPageChange, onPageSizeChange } = useAdminTablePagination();

  const { execute: fetchApps, result, status } = useAction(getOAuthAppsAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("loadError"));
    },
  });

  const refresh = useCallback(() => {
    fetchApps({ page, pageSize });
  }, [fetchApps, page, pageSize]);

  useEffect(refresh, [refresh]);

  const { execute: toggleVerified } = useAction(setOAuthAppVerifiedAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || t("toastVerifyError")),
    onSuccess: () => {
      toast.success(t("toastVerifySuccess"));
      refresh();
    },
  });

  const { execute: deleteApp } = useAction(deleteOAuthAppAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || t("toastDeleteError")),
    onSuccess: () => {
      toast.success(t("toastDeleteSuccess"));
      refresh();
    },
  });

  const columns = useMemo(
    () =>
      createOAuthAppColumns({
        handlers: {
          onToggleVerified: (row: OAuthAppRow) =>
            toggleVerified({ clientId: row.clientId, isVerified: !row.verifiedAt }),
          onDelete: (row: OAuthAppRow) => deleteApp({ clientId: row.clientId }),
        },
        labels: {
          name: t("columnName"),
          clientId: t("columnClientId"),
          source: t("columnSource"),
          verified: t("columnVerified"),
          created: t("columnCreated"),
          lastRenewed: t("columnLastRenewed"),
        },
      }),
    [deleteApp, t, toggleVerified],
  );

  const data = result.data;
  const error = result.serverError;

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
      }
      isLoading={status === "executing" || status === "idle"}
      loadingMessage={t("loading")}
      errorMessage={error?.message}
      emptyMessage={t("empty")}
      hasData={Boolean(data)}
    >
      {data ? (
        <DataTable
          columns={columns}
          data={data.apps}
          pageCount={data.totalPages}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          totalCount={data.totalCount}
          itemNameSingular={t("itemSingular")}
          itemNamePlural={t("itemPlural")}
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
        />
      ) : null}
    </AdminTableShell>
  );
}
