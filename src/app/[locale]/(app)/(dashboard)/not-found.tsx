import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getTranslations } from "@/i18n/server";

// Renders inside the dashboard layout, so a missing team or record keeps the sidebar.
export default async function DashboardNotFound() {
  const t = await getTranslations("NotFound");

  return (
    <div className="container mx-auto flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
      <p className="mt-4 max-w-xl text-muted-foreground">{t("appDescription")}</p>
      <Link href="/dashboard" className={cn(buttonVariants(), "mt-8")}>
        {t("goToDashboard")}
      </Link>
    </div>
  );
}
