import "server-only";

// The provider has no registration hook, so the D1 mirror of a DCR client is taken from the
// response on its way out. Bookkeeping only — it must never delay or fail the registration.
// fallow-ignore-next-line unused-export -- Reached through a lazy `import()` in worker-entrypoint.ts.
export function mirrorDcrRegistrationResponse({
  response,
  ctx,
}: {
  response: Response;
  ctx: ExecutionContext;
}): void {
  const mirrorCopy = response.clone();

  ctx.waitUntil(
    mirrorCopy
      .json()
      .then(async (registration) =>
        (await import("@/lib/oauth/oauth-registration-mirror")).mirrorDcrRegistration(registration),
      )
      .catch((error) => console.error("Failed to read OAuth registration response", error)),
  );
}
