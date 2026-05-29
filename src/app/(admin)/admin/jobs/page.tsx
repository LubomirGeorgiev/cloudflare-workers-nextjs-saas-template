import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import {
  CloudflareQueueTable,
  D1ScheduledJobsTable,
} from "./jobs-tables";
import {
  getSchedulerQueueMetricsForAdmin,
  listScheduledJobsForAdmin,
  previewSchedulerQueueForAdmin,
  type QueueMetricsTableState,
  type QueuePreviewTableState,
} from "@/lib/scheduler/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scheduled Jobs | Admin",
  description: "Inspect scheduled jobs stored in D1 and Cloudflare Queues",
};

export default async function AdminJobsPage() {
  const [d1Jobs, queueMetrics, queuePreview] = await Promise.all([
    listScheduledJobsForAdmin(),
    getSchedulerQueueMetricsForAdmin(),
    previewSchedulerQueueForAdmin(),
  ]);
  const d1JobRows = d1Jobs.map((job) => ({
    id: job.id,
    type: job.type,
    dedupeKey: job.dedupeKey,
    payload: job.payload,
    runAt: job.runAt.toISOString(),
  }));
  const queuePreviewRows: QueuePreviewTableState = queuePreview.status === "ready"
    ? {
        ...queuePreview,
        messages: queuePreview.messages.map((message) => ({
          id: message.id,
          attempts: message.attempts,
          bodyText: message.bodyText,
          metadata: message.metadata,
          publishedAt: message.publishedAt.toISOString(),
        })),
      }
    : queuePreview;
  const queueMetricsRow: QueueMetricsTableState = queueMetrics.status === "ready"
    ? {
        ...queueMetrics,
        oldestMessageTimestamp: queueMetrics.oldestMessageTimestamp?.toISOString() ?? null,
      }
    : queueMetrics;

  return (
    <>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/jobs", label: "Scheduled Jobs" },
        ]}
      />
      <main className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduled Jobs</h1>
          <p className="mt-2 text-muted-foreground">
            Inspect deferred scheduler payloads in D1 and messages waiting in the Cloudflare scheduler queue.
          </p>
        </div>
        <D1ScheduledJobsTable jobs={d1JobRows} />
        <CloudflareQueueTable
          queueMetrics={queueMetricsRow}
          queuePreview={queuePreviewRows}
        />
      </main>
    </>
  );
}
