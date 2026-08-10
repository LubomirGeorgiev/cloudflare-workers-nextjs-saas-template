"use client";

import { buttonVariants } from "@/components/ui/button"
import { getPathname } from "@/i18n/navigation";
import { usePublicAuthFeatureState } from "@/state/public-config";
import Google from "@/icons/google";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";

export default function SSOButtons({
  isSignIn = false
}: {
  isSignIn?: boolean
}) {
  const { isGoogleSSOEnabled, isLoaded } = usePublicAuthFeatureState()
  const t = useTranslations("Client.Auth.Common");
  const locale = useLocale();

  if (!isLoaded) {
    return (
      <Skeleton className="w-full h-[44px]" />
    )
  }

  return (
    <>
      {isGoogleSSOEnabled && (
        <>
          {/* Plain anchor, not `Link`: the route 307s to Google, and a client-side
              navigation would fetch it as RSC and fail the cross-origin CORS check. */}
          <a
            href={getPathname({ href: "/sso/google", locale })}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
              <Google className="w-[22px] h-[22px] mr-1" />
              {isSignIn ? t("signInWithGoogle") : t("signUpWithGoogle")}
          </a>
        </>
      )}
    </>
  )
}
