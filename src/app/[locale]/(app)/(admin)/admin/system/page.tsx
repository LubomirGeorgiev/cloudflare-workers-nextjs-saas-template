import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { getSystemActionAvailability } from "@/lib/admin/system-actions";
import { requireAdminOrRedirectHome } from "@/utils/auth-redirect";

import { SystemActions } from "./_components/system-actions";

export const metadata: Metadata = {
  title: "System | Admin",
  description: "Run system maintenance tasks for search indexes and caches",
};

export default async function AdminSystemPage() {
  await requireAdminOrRedirectHome();

  // Sequential on purpose: the guard runs before the read it guards.
  const availability = await getSystemActionAvailability();

  return (
    <>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/system", label: "System" },
        ]}
      />
      <main className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System</h1>
          <p className="mt-2 text-muted-foreground">
            Maintenance tasks for CMS search indexes, data cache, and the CDN caches.
          </p>
        </div>

        <SystemActions availability={availability} />

        <p className="text-sm text-muted-foreground">
          The same tasks are available on the internal admin API and MCP server under the
          &quot;System&quot; tag. The operations are listed in the OpenAPI document linked on the{" "}
          <Link href="/admin/api" className="underline underline-offset-4">
            Internal API
          </Link>{" "}
          page.
        </p>
      </main>
    </>
  );
}
