import { getCurrentSession } from "@/utils/auth"
import { NextResponse } from "next/server"
import { tryCatch } from "@/lib/try-catch"
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit"
import { AUTH_SESSION_PRESENT_COOKIE_NAME } from "@/constants"
import { SESSION_NO_STORE_CACHE_CONTROL } from "@/constants/cache-control"

function getSessionResponse({
  session,
}: {
  session: Awaited<ReturnType<typeof getCurrentSession>>;
}) {
  const headers = new Headers()
  headers.set("Cache-Control", SESSION_NO_STORE_CACHE_CONTROL)
  headers.set("Pragma", "no-cache")
  headers.set("Expires", "0")

  const response = NextResponse.json({
    session,
  }, {
    headers
  })

  if (!session) {
    response.cookies.delete(AUTH_SESSION_PRESENT_COOKIE_NAME)
  }

  return response
}

export async function GET() {
  return withRateLimit(async () => {
    const { data: session, error } = await tryCatch(getCurrentSession())

    if (error) {
      return getSessionResponse({
        session: null,
      })
    }

    return getSessionResponse({
      session,
    })
  }, RATE_LIMITS.GET_SESSION_API)
}
