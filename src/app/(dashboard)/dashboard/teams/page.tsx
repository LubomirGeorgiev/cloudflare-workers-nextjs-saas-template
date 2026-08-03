import { getCurrentSession } from "@/utils/auth";
import { getUserTeamsAction } from "@/actions/team-actions";
import { notFound } from "next/navigation";
import { redirectToSignIn } from "@/utils/auth-redirect";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusIcon, Users } from "lucide-react";
import type { Route } from "next";
import { PageHeader } from "@/components/page-header";
import { PendingInvitations } from "./pending-invitations";
import { getTranslations } from "next-intl/server";
import type { TeamSummary } from "@/lib/teams/teams";

export async function generateMetadata() {
  const t = await getTranslations("Client.Dashboard.Teams");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function TeamsIndexPage() {
  const t = await getTranslations("Client.Dashboard.Teams");

  const session = await getCurrentSession();

  if (!session) {
    return redirectToSignIn("/dashboard/teams");
  }

  const { data: result, serverError } = await getUserTeamsAction();

  let teams: TeamSummary[] = [];
  if (result?.success && result.data) {
    teams = result.data;
  }

  if (serverError) {
    return notFound();
  }

  return (
    <>
      <PageHeader
        items={[
          {
            href: "/dashboard/teams",
            label: t("breadcrumb")
          }
        ]}
      />
      <div className="container mx-auto px-5 pb-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">{t("title")}</h1>
            <p className="text-muted-foreground mt-2">{t("subtitle")}</p>
          </div>
          <Link
            href={"/dashboard/teams/create" as Route}
            className={buttonVariants()}
          >
              <PlusIcon className="h-4 w-4 mr-2" />
              {t("createTeam")}
          </Link>
        </div>

        {/* Show pending invitations */}
        <PendingInvitations />

        {teams.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardHeader>
              <CardTitle className="text-xl">{t("emptyTitle")}</CardTitle>
              <CardDescription>
                {t("emptyDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center py-8">
              <Users className="h-16 w-16 text-muted-foreground/50" />
            </CardContent>
            <CardFooter className="flex justify-center pb-8">
              <Link
                href={"/dashboard/teams/create" as Route}
                className={buttonVariants()}
              >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  {t("createFirstTeam")}
              </Link>
            </CardFooter>
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <Link key={team.id} href={`/dashboard/teams/${team.slug}` as Route}>
                <Card className="h-full transition-all hover:border-primary hover:shadow-md">
                  <CardHeader className="flex flex-row items-start gap-4">
                    {team.avatarUrl ? (
                      <div className="h-12 w-12 rounded-md overflow-hidden">
                        {/* oxlint-disable-next-line nextjs/no-img-element */}
                        <img
                          src={team.avatarUrl}
                          alt={`${team.name} logo`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                        <Users className="h-6 w-6" />
                      </div>
                    )}
                    <div className="space-y-1">
                      <CardTitle>{team.name}</CardTitle>
                      {team.role && (
                        <CardDescription>
                          {t("yourRole")} <span className="capitalize">{team.role.name}</span>
                        </CardDescription>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="line-clamp-2 text-muted-foreground">
                      {team.description || t("noDescription")}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}

            <Link href={"/dashboard/teams/create" as Route}>
              <Card className="h-full border-dashed border-2 hover:border-primary transition-all">
                <CardHeader className="text-center pt-8">
                  <CardTitle className="text-xl">{t("createNewTeam")}</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <PlusIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
