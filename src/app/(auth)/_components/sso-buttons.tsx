import { buttonVariants } from "@/components/ui/button"
import Link from "next/link";
import { useConfigStore } from "@/state/config";
import Google from "@/icons/google";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function SSOButtons({
  isSignIn = false
}: {
  isSignIn?: boolean
}) {
  const { isGoogleSSOEnabled } = useConfigStore()

  if (isGoogleSSOEnabled === null) {
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
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
              <Google className="w-[22px] h-[22px] mr-1" />
              {isSignIn ? "Sign in with Google" : "Sign up with Google"}
          </Link>
        </>
      )}
    </>
  )
}
