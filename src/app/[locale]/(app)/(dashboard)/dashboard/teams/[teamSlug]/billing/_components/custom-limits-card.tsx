import { Check } from "lucide-react";
import type { Messages } from "use-intl/core";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeamLimitOverrides } from "@/constants/limit-overrides";
import { TEAM_PLAN_LIMIT_KEYS, type TeamPlanLimits } from "@/constants/plans";
import { getTranslations } from "@/i18n/server";

/**
 * The limits that staff set for this team in place of the plan values. The plan cards show the
 * catalog, so without this card a team with a custom deal sees no number that applies to it.
 */
export async function CustomLimitsCard({ overrides }: { overrides: TeamLimitOverrides }) {
  const t = await getTranslations("Client.Dashboard.Billing.CustomLimits");
  const lines = buildLines({ overrides, t });
  if (lines.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {lines.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-primary" /> {line}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function buildLines({
  overrides,
  t,
}: {
  overrides: TeamLimitOverrides;
  t: Awaited<ReturnType<typeof getTranslations<"Client.Dashboard.Billing.CustomLimits">>>;
}): string[] {
  return TEAM_PLAN_LIMIT_KEYS.flatMap((key) => {
    const count = overrides[key];
    return count === undefined ? [] : [t(LIMIT_LINE_KEYS[key], { count })];
  });
}

// A Record over the limit keys: a fork that adds a limit key fails typecheck until it adds a line.
const LIMIT_LINE_KEYS: Record<keyof TeamPlanLimits, keyof Messages["Client"]["Dashboard"]["Billing"]["CustomLimits"]> = {
  seats: "seats",
  projects: "projects",
};
