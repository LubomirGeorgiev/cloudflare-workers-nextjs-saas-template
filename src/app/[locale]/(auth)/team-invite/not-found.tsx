"use client";

// "use client" on purpose: not-found gets no `params`, so the locale comes from `NextIntlClientProvider`.
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("Client.Auth.TeamInvite");

  return (
    <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <CardDescription>
            {t("notFoundDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("notFoundReasonsIntro")}
            </p>
            <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
              <li>{t("notFoundReasonIncorrectUrl")}</li>
              <li>{t("notFoundReasonRevoked")}</li>
              <li>{t("notFoundReasonExpired")}</li>
            </ul>
            <div className="pt-4">
              <Link href="/dashboard" className={cn(buttonVariants(), "w-full")}>
                {t("goToDashboard")}
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
