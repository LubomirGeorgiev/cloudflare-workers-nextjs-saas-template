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

export default async function ResetPasswordNotFound() {
  const t = await getTranslations("Client.Auth.ResetPassword");

  return (
    <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("invalidLinkTitle")}</CardTitle>
          <CardDescription>
            {t("invalidLinkDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/forgot-password"
            className={buttonVariants({ variant: "outline", className: "w-full" })}
          >
              {t("requestNewLink")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
