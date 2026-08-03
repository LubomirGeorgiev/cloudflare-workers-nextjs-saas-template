import { Suspense } from "react";
import { SessionsClient } from "./sessions.client";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionsAction } from "./sessions.actions";
import { PageErrorState } from "@/components/page-error-state";
import { resolvePageAction } from "@/utils/page-action-result";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Client.Settings.Sessions");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function SessionsPage() {
  const sessions = await resolvePageAction(await getSessionsAction())

  if (!sessions.ok) {
    return <PageErrorState message={sessions.message} />;
  }

  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[70px] w-full" />
          ))}
        </div>
      }
    >
      <SessionsClient sessions={sessions.data} />
    </Suspense>
  );
}
