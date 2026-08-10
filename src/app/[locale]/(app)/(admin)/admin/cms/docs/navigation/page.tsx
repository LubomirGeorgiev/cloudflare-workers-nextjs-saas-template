import { redirect } from "@/i18n/navigation";
import { requireAdminOrRedirectHome } from "@/utils/auth-redirect";
import { type Locale } from "@/i18n/config";

export default async function DocsNavigationPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  await requireAdminOrRedirectHome();

  const { locale } = await params;

  return redirect({ href: "/admin/cms/navigation/docs", locale });
}
