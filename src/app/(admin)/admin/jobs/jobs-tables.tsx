"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { AlertCircle, Cloud, Database, Info } from "lucide-react";
import * as React from "react";

import { DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  QueueMessageTableRow,
  QueueMetricsTableState,
  QueuePreviewTableState,
  ScheduledJobTableRow,
} from "@/lib/scheduler/admin";
import { formatDateTime, formatRelativeDateTime } from "@/utils/format-date";

const JOBS_PAGE_SIZE_OPTIONS = [10, 20, 50];

function formatPayload(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function getPageCount(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

function usePaginatedRows<Row>(rows: Row[]) {
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(JOBS_PAGE_SIZE_OPTIONS[0]);
  const pageCount = getPageCount(rows.length, pageSize);
  const pageRows = React.useMemo(
    () => rows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
    [pageIndex, pageSize, rows],
  );

  function handlePageChange(nextPageIndex: number) {
    setPageIndex(Math.min(Math.max(nextPageIndex, 0), pageCount - 1));
  }

  function handlePageSizeChange(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPageIndex(0);
  }

  return {
    pageCount,
    pageIndex,
    pageRows,
    pageSize,
    setPageIndex: handlePageChange,
    setPageSize: handlePageSizeChange,
  };
}

function PayloadPreview({ value }: { value: string }) {
  return (
    <pre className="max-h-40 min-w-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
      {value}
    </pre>
  );
}

const d1JobColumns: ColumnDef<ScheduledJobTableRow>[] = [
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.type}</div>
        <div className="mt-1 text-xs text-muted-foreground">{row.original.id}</div>
      </div>
    ),
  },
  {
    accessorKey: "dedupeKey",
    header: "Dedupe Key",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.dedupeKey}</span>
    ),
  },
  {
    accessorKey: "runAt",
    header: "Run At",
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <div>{formatRelativeDateTime(row.original.runAt)}</div>
        <div className="text-xs text-muted-foreground">
          {formatDateTime(row.original.runAt)}
        </div>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => {
      const isDue = new Date(row.original.runAt).getTime() <= Date.now();

      return (
        <Badge variant={isDue ? "destructive" : "secondary"}>
          {isDue ? "Due" : "Scheduled"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "payload",
    header: "Payload",
    cell: ({ row }) => <PayloadPreview value={formatPayload(row.original.payload)} />,
  },
];

const queueMessageColumns: ColumnDef<QueueMessageTableRow>[] = [
  {
    accessorKey: "id",
    header: "Message",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span>,
  },
  {
    accessorKey: "publishedAt",
    header: "Published",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{formatDateTime(row.original.publishedAt)}</span>
    ),
  },
  {
    accessorKey: "attempts",
    header: "Attempts",
  },
  {
    accessorKey: "metadata",
    header: "Metadata",
    cell: ({ row }) => <PayloadPreview value={formatPayload(row.original.metadata)} />,
  },
  {
    accessorKey: "bodyText",
    header: "Payload",
    cell: ({ row }) => <PayloadPreview value={row.original.bodyText} />,
  },
];

function QueueConfigAlert({ queuePreview }: { queuePreview: Exclude<QueuePreviewTableState, { status: "ready" }> }) {
  if (queuePreview.status === "missing-config") {
    const missingNames = queuePreview.missing.map((name) => <code key={name}>{name}</code>);

    return (
      <Alert variant="warning">
        <Info className="size-4" />
        <AlertTitle>Cloudflare Queue preview is not configured</AlertTitle>
        <AlertDescription>
          Add {missingNames.reduce<React.ReactNode[]>(
            (nodes, node, index) => (index === 0 ? [node] : [...nodes, ", ", node]),
            [],
          )} to the Worker environment. The API token needs Queues read access.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant={queuePreview.status === "error" ? "destructive" : "warning"}>
      <AlertCircle className="size-4" />
      <AlertTitle>Cloudflare Queue preview unavailable</AlertTitle>
      <AlertDescription>{queuePreview.message}</AlertDescription>
    </Alert>
  );
}

function QueueMetrics({ queueMetrics }: { queueMetrics: QueueMetricsTableState }) {
  if (queueMetrics.status !== "ready") {
    return (
      <Alert variant="warning">
        <AlertCircle className="size-4" />
        <AlertTitle>Cloudflare Queue metrics unavailable</AlertTitle>
        <AlertDescription>{queueMetrics.message}</AlertDescription>
      </Alert>
    );
  }

  const metrics = [
    {
      label: "Backlog messages",
      value: queueMetrics.backlogCount.toLocaleString(),
    },
    {
      label: "Backlog size",
      value: formatBytes(queueMetrics.backlogBytes),
    },
    {
      label: "Oldest message",
      value: queueMetrics.oldestMessageTimestamp
        ? formatDateTime(queueMetrics.oldestMessageTimestamp)
        : "None",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-md border bg-muted/20 p-4">
          <div className="text-sm text-muted-foreground">{metric.label}</div>
          <div className="mt-2 text-2xl font-semibold">{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

export function D1ScheduledJobsTable({ jobs }: { jobs: ScheduledJobTableRow[] }) {
  const pagination = usePaginatedRows(jobs);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Database className="size-5" />
              D1 Scheduled Jobs
              <Badge variant="outline">{jobs.length}</Badge>
            </CardTitle>
            <CardDescription>
              Jobs persisted because they are outside the Cloudflare Queue delay window.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={d1JobColumns}
          data={pagination.pageRows}
          pageCount={pagination.pageCount}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPageIndex}
          onPageSizeChange={pagination.setPageSize}
          totalCount={jobs.length}
          itemNameSingular="job"
          itemNamePlural="jobs"
          pageSizeOptions={JOBS_PAGE_SIZE_OPTIONS}
        />
      </CardContent>
    </Card>
  );
}

export function CloudflareQueueTable({
  queueMetrics,
  queuePreview,
}: {
  queueMetrics: QueueMetricsTableState;
  queuePreview: QueuePreviewTableState;
}) {
  const messages = queuePreview.status === "ready" ? queuePreview.messages : [];
  const pagination = usePaginatedRows(messages);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Cloud className="size-5" />
              Cloudflare Queue
            </CardTitle>
            <CardDescription>
              Previewed messages from {queuePreview.queueName}. Preview does not lease or acknowledge messages.
            </CardDescription>
          </div>
          <Badge variant="outline">{messages.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <QueueMetrics queueMetrics={queueMetrics} />
        {queuePreview.status !== "ready" && <QueueConfigAlert queuePreview={queuePreview} />}
        <DataTable
          columns={queueMessageColumns}
          data={pagination.pageRows}
          pageCount={pagination.pageCount}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPageIndex}
          onPageSizeChange={pagination.setPageSize}
          totalCount={messages.length}
          itemNameSingular="message"
          itemNamePlural="messages"
          pageSizeOptions={JOBS_PAGE_SIZE_OPTIONS}
        />
      </CardContent>
    </Card>
  );
}
