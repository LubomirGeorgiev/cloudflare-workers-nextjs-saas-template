import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TransactionHistory } from "./_components/transaction-history";
import { CreditPackages } from "./_components/credit-packages";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";
import { CreditSystemDisabled } from "@/components/credit-system-disabled";

export default async function BillingPage() {
  const session = await getSessionFromCookie();

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <>
      <PageHeader
        items={[
          {
            href: "/dashboard",
            label: "Dashboard"
          },
          {
            href: "/dashboard/billing",
            label: "Billing"
          }
        ]}
      />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {DISABLE_CREDIT_BILLING_SYSTEM ? (
          <CreditSystemDisabled />
        ) : (
          <>
            <CreditPackages />
            <div className="mt-4">
              <NuqsAdapter>
                <TransactionHistory />
              </NuqsAdapter>
            </div>
          </>
        )}
      </div>
    </>
  );
}
