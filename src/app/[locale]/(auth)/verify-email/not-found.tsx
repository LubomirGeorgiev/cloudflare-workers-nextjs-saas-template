import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("Client.Auth.VerifyEmail");
  const tCommon = await getTranslations("Client.Auth.Common");

  return (
    <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <CardDescription>
            {t("notFoundDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>{t("notFoundReasonExpired")}</li>
            <li>{t("notFoundReasonAlreadyVerified")}</li>
            <li>{t("notFoundReasonModified")}</li>
          </ul>

          <div className="space-y-2">
            <Link
              href="/sign-in"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
                {tCommon("signIn")}
            </Link>
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
                {t("goToHome")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
