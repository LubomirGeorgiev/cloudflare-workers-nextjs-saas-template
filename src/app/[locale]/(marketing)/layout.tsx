import NavFooterLayout from "@/layouts/NavFooterLayout";
import type { Locale } from "@/i18n/config";

export default function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  return <NavFooterLayout params={params}>{children}</NavFooterLayout>;
}
