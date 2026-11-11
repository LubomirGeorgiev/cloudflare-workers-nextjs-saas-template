import { buttonVariants } from "@/components/ui/button";
import { ClientMessagesProvider } from "@/components/client-messages-provider";
import NavFooterLayout from "@/layouts/NavFooterLayout";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CLIENT_MESSAGE_SCOPES } from "@/i18n/client-namespaces";
import { getLocale } from "@/i18n/server";
import { getTranslator } from "@/i18n/translator";

// A not-found boundary gets no `params`, so the locale comes from `getLocale`: the URL locale
// that `src/proxy.ts` forwards.
export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslator({ locale, namespace: "NotFound" });
  const params = Promise.resolve({ locale });

  return (
    <ClientMessagesProvider params={params} namespaces={CLIENT_MESSAGE_SCOPES.notFound.namespaces}>
      <NavFooterLayout params={params}>
        <div className="container mx-auto flex flex-col items-center px-4 py-24 text-center sm:py-32">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">{t("description")}</p>
          <Link href="/" className={cn(buttonVariants(), "mt-8")}>
            {t("goHome")}
          </Link>
        </div>
      </NavFooterLayout>
    </ClientMessagesProvider>
  );
}
