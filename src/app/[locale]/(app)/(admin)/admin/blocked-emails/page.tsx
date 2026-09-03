import type { Metadata } from "next"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { PageHeader } from "@/components/page-header"
import { ADMIN_BLOCKED_EMAILS_PATH } from "@/constants"
import { BlockedEmailsTable } from "../_components/blocked-emails/blocked-emails-table"

export const metadata: Metadata = {
  title: "Blocked Emails",
  description: "Email patterns that cannot register an account",
}

export default function AdminBlockedEmailsPage() {
  return (
    <NuqsAdapter>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_BLOCKED_EMAILS_PATH, label: "Blocked Emails" },
        ]}
      />
      <BlockedEmailsTable />
    </NuqsAdapter>
  )
}
