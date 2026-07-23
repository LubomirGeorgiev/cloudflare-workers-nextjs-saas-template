import { getSessionFromCookie } from "@/utils/auth";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { redirect as nextRedirect } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { generateState, generateCodeVerifier } from "arctic";
import { getGoogleSSOClient } from "@/lib/sso/google-sso";
import { cookies } from "next/headers";
import {
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME,
} from "@/constants";
import ms from "ms";
import { isGoogleSSOEnabled } from "@/flags";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { getLocale } from "next-intl/server";
import { shouldUseSecureCookies } from "@/utils/cookie-security";

export async function GET() {
  return withRateLimit(async () => {
    const locale = await getLocale();

    if (!(await isGoogleSSOEnabled())) {
      console.error("Google client ID or secret is not set")
      return redirect({ href: "/", locale })
    }

    const session = await getSessionFromCookie()

    if (session) {
      // Dashboard lives outside `[locale]`; keep next/navigation redirect.
      return nextRedirect(REDIRECT_AFTER_SIGN_IN)
    }

    let ssoRedirectUrl: null | URL = null

    try {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();

      const google = getGoogleSSOClient();

      ssoRedirectUrl = google.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);

      const secure = await shouldUseSecureCookies();
      const cookieOptions = {
        path: "/",
        httpOnly: true,
        secure,
        maxAge: Math.floor(ms("10 minutes") / 1000),
        sameSite: "lax"
      } as const;
      const cookieStore = await cookies()
      cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE_NAME, state, cookieOptions)
      cookieStore.set(GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME, codeVerifier, cookieOptions)
    } catch (error) {
      console.error('Error generating Google OAuth state and code verifier', error)
      return redirect({ href: "/", locale })
    }

    return new Response(null, {
      status: 307,
      headers: {
        Location: ssoRedirectUrl.toString()
      }
    });
  }, RATE_LIMITS.GOOGLE_SSO_REQUEST)
}
