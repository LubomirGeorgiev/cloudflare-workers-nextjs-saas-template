import { buttonVariants } from "@/components/ui/button"
import { Link } from "@/i18n/navigation";
import { usePublicAuthFeatureState } from "@/state/public-config";
import Google from "@/icons/google";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export default function SSOButtons({
  isSignIn = false
}: {
  isSignIn?: boolean
}) {
  const { isGoogleSSOEnabled, isLoaded } = usePublicAuthFeatureState()
  const t = useTranslations("Client.Auth.Common");

  if (!isLoaded) {
    return (
      <Skeleton className="w-full h-[44px]" />
    )
  }

  return (
    <>
      {isGoogleSSOEnabled && (
        <>
          <Link
            href="/sso/google"
            prefetch={false}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
              <Google className="w-[22px] h-[22px] mr-1" />
              {isSignIn ? t("signInWithGoogle") : t("signUpWithGoogle")}
          </Link>
        </>
      )}
    </>
  )
}
