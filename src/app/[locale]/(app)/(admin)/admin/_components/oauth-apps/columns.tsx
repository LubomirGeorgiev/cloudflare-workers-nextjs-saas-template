"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, MoreHorizontal, ShieldQuestion } from "lucide-react";
import type { InferSafeActionFnResult } from "next-safe-action";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OAuthAppRegistrationSource } from "@/db/schema";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { RelativeDateCell } from "../relative-date-cell";
import type { getOAuthAppsAction } from "../../_actions/oauth-apps-actions";

// A table, not a ladder: a source added to the schema union without a label here is a compile error.
const SOURCE_LABEL_KEY = {
  cimd: "sourceCimd",
  dcr: "sourceDcr",
  portal: "sourcePortal",
} as const satisfies Record<OAuthAppRegistrationSource, string>;

// Derive the row model from the action's return DTO so the table stays in sync.
export type OAuthAppRow = NonNullable<
  InferSafeActionFnResult<typeof getOAuthAppsAction>["data"]
>["apps"][number];

interface OAuthAppActionHandlers {
  onToggleVerified: (row: OAuthAppRow) => void;
  onDelete: (row: OAuthAppRow) => void;
}

function DateCell({ value }: { value: Date | null }) {
  const t = useTranslations("Client.Admin.OAuthApps");

  return <RelativeDateCell value={value} emptyLabel={t("never")} />;
}

function NameCell({ row }: { row: OAuthAppRow }) {
  const t = useTranslations("Client.Admin.OAuthApps");

  return (
    <div className="flex items-center gap-2">
      {row.logoUri ? (
        // Self-asserted third-party asset: never routed through the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.logoUri} alt="" className="size-6 rounded object-contain" referrerPolicy="no-referrer" />
      ) : null}
      <span>{row.name ?? t("unnamed")}</span>
    </div>
  );
}

function VerifiedCell({ row }: { row: OAuthAppRow }) {
  const t = useTranslations("Client.Admin.OAuthApps");
  const isVerified = Boolean(row.verifiedAt);

  return (
    <Badge variant={isVerified ? "default" : "secondary"} className="gap-1">
      {isVerified ? <BadgeCheck className="size-3.5" /> : <ShieldQuestion className="size-3.5" />}
      {isVerified ? t("verified") : t("unverified")}
    </Badge>
  );
}

function SourceCell({ row }: { row: OAuthAppRow }) {
  const t = useTranslations("Client.Admin.OAuthApps");
  const labelKey = row.registrationSource ? SOURCE_LABEL_KEY[row.registrationSource] : null;

  return <Badge variant="outline">{t(labelKey ?? "sourceUnknown")}</Badge>;
}

function RenewalCell({ row }: { row: OAuthAppRow }) {
  const t = useTranslations("Client.Admin.OAuthApps");

  if (row.registrationSource !== "dcr") {
    return <span className="text-muted-foreground">{t("notApplicable")}</span>;
  }

  return <DateCell value={row.lastRenewedAt} />;
}

function ActionsCell({ row, handlers }: { row: OAuthAppRow; handlers: OAuthAppActionHandlers }) {
  const t = useTranslations("Client.Admin.OAuthApps");
  const { copy } = useCopyToClipboard();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-8 p-0" />}>
        <span className="sr-only">{t("openMenu")}</span>
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("actions")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => copy(row.clientId)}>
          {t("copyClientId")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlers.onToggleVerified(row)}>
          {row.verifiedAt ? t("unverifyAction") : t("verifyAction")}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onClick={() => handlers.onDelete(row)}>
          {t("deleteAction")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function createOAuthAppColumns({
  handlers,
  labels,
}: {
  handlers: OAuthAppActionHandlers;
  labels: Record<"name" | "clientId" | "source" | "verified" | "created" | "lastRenewed", string>;
}): ColumnDef<OAuthAppRow>[] {
  return [
    {
      accessorKey: "name",
      header: labels.name,
      cell: ({ row }) => <NameCell row={row.original} />,
    },
    {
      accessorKey: "clientId",
      header: labels.clientId,
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">{row.original.clientId}</span>
      ),
    },
    {
      accessorKey: "registrationSource",
      header: labels.source,
      cell: ({ row }) => <SourceCell row={row.original} />,
    },
    {
      accessorKey: "verifiedAt",
      header: labels.verified,
      cell: ({ row }) => <VerifiedCell row={row.original} />,
    },
    {
      accessorKey: "createdAt",
      header: labels.created,
      cell: ({ row }) => <DateCell value={row.original.createdAt} />,
    },
    {
      accessorKey: "lastRenewedAt",
      header: labels.lastRenewed,
      cell: ({ row }) => <RenewalCell row={row.original} />,
    },
    {
      id: "actions",
      cell: ({ row }) => <ActionsCell row={row.original} handlers={handlers} />,
    },
  ];
}
