import { Link } from "@/i18n/navigation";
import { SiX as XIcon, SiGithub as GithubIcon } from '@icons-pack/react-simple-icons'
import { getTranslator } from "@/i18n/translator";
import type { Locale } from "@/i18n/config";
import { AskiChatLogo } from "@/components/aski-chat-logo";
import { LogoLockup } from "@/components/logo";
import ThemeSwitch from "@/components/theme-switch";
import LocaleSwitcher from "@/components/locale-switcher";
import { GITHUB_REPO_URL, SITE_NAME } from "@/constants";
import {
  GithubStarsBadge,
  GithubStarsBadgeFallback,
} from "@/components/github-stars-badge";
import { Suspense } from "react";

export async function Footer({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Footer" });
  const tGithub = await getTranslator({ locale, namespace: "Client.GithubStars" });

  return (
    <footer className="border-t dark:bg-muted/30 bg-muted/60 shadow">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="py-6 md:py-8">
          {/* Responsive grid with better mobile spacing */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-6">
            {/* Legal Links */}
            <div className="space-y-3 md:space-y-4 flex flex-col items-center md:items-start">
              <h3 className="text-sm font-semibold text-foreground text-center md:text-left">{t("legal")}</h3>
              <ul className="space-y-2 flex flex-col items-center md:items-start">
                <li>
                  <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground text-center md:text-left">
                    {t("termsOfService")}
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground text-center md:text-left">
                    {t("privacyPolicy")}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Company Info */}
            <div className="space-y-3 md:space-y-4 flex flex-col items-center md:items-start">
              <h3 className="text-sm font-semibold text-foreground text-center md:text-left">{t("company")}</h3>
              <ul className="space-y-2 flex flex-col items-center md:items-start">
                <li>
                  <Link href="/" className="text-sm text-muted-foreground hover:text-foreground text-center md:text-left">
                    {t("home")}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Social Links and Theme Switch */}
            <div className="space-y-3 md:space-y-4 flex flex-col items-center md:items-start">
              <h3 className="text-sm font-semibold text-foreground text-center md:text-left">{t("social")}</h3>
              <div className="flex items-center space-x-4">
                <a
                  href="https://github.com/LubomirGeorgiev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group text-muted-foreground transition-colors duration-300 ease-out hover:text-foreground"
                >
                  <GithubIcon className="h-5 w-5 transition-transform duration-300 ease-out group-hover:scale-110 motion-reduce:transform-none" />
                  <span className="sr-only">{tGithub("github")}</span>
                </a>
                <a
                  href="https://x.com/LubomirGeorg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-5 w-5" />
                  <span className="sr-only">X (formerly Twitter)</span>
                </a>
              </div>
            </div>
          </div>

          {/* Copyright - Optimized for mobile */}
          <div className="mt-6 pt-6 md:mt-8 md:pt-8 border-t">
            <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between md:gap-4">
              <div className="flex flex-col items-center gap-2 md:items-start">
                <Link
                  href="/"
                  prefetch={false}
                  className="text-foreground transition-colors hover:text-primary"
                >
                  <LogoLockup />
                </Link>
                <p className="text-sm text-muted-foreground text-center md:text-left">
                  © {new Date().getFullYear()} {SITE_NAME}. {t("allRightsReserved")}
                </p>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-4 md:space-x-4">
                {GITHUB_REPO_URL && (
                  <Suspense fallback={<GithubStarsBadgeFallback size="sm" />}>
                    <GithubStarsBadge size="sm" locale={locale} />
                  </Suspense>
                )}

                <div className="flex items-center gap-4">
                  <LocaleSwitcher />
                  <ThemeSwitch />

                  <a
                    href="https://aski.chat?utm_source=saas-template-footer"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center font-medium text-sm hover:text-foreground transition-colors"
                  >
                    <span className="whitespace-nowrap">{t("builtBy")}</span>
                    <AskiChatLogo className="h-7 w-7 mx-1.5" />
                    <span className="whitespace-nowrap">Aski.Chat</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
