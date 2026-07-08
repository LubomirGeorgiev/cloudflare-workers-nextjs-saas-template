import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import { CreateTeamForm } from "@/components/teams/create-team-form";
import { PageHeader } from "@/components/page-header";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Client.Dashboard.Teams");

  return {
    title: t("createMetaTitle"),
    description: t("createMetaDescription"),
  };
}

export default async function CreateTeamPage() {
  const t = await getTranslations("Client.Dashboard.Teams");

  // Check if the user is authenticated
  const session = await getSessionFromCookie();

  if (!session) {
    redirect("/sign-in?redirect=/dashboard/teams/create");
  }

  return (
    <>
      <PageHeader
        items={[
          {
            href: "/dashboard/teams",
            label: t("breadcrumb")
          },
          {
            href: "/dashboard/teams/create",
            label: t("createTeam")
          }
        ]}
      />
      <div className="container mx-auto px-5 pb-12">
        <div className="max-w-xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold mt-4">{t("createNewTeam")}</h1>
            <p className="text-muted-foreground mt-2">
              {t("createPageSubtitle")}
            </p>
          </div>

          <div className="border rounded-lg p-6 bg-card">
            <CreateTeamForm />
          </div>
        </div>
      </div>
    </>
  );
}
