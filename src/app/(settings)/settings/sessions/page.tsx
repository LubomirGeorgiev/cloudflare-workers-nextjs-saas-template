import { Suspense } from "react";
import { SessionsClient } from "./sessions.client";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionsAction } from "./sessions.actions";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Client.Settings.Sessions");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function SessionsPage() {
  const { data: sessions, serverError } = await getSessionsAction()

  if (serverError || !sessions) {
    return redirect("/sign-in")
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
      <SessionsClient sessions={sessions} />
    </Suspense>
  );
}
