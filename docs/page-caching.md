# Page caching: `export const revalidate`

Every public page opts into ISR with one number. The pages sit under `src/app/[locale]/(marketing)/`
and `src/app/[locale]/(legal)/`; each carries a one-line pointer comment back to this file.

Nothing under `src/app/[locale]/(app)/` is cached — those routes are session-gated, so they render per
request and must never export `revalidate`.

## What the timer is for on each page

A deploy starts an empty cache. So for text that only changes when we deploy, the timer buys nothing
on its own; it matters only for the live data on the page, or as a backstop.

| Pages | Value | What the timer actually bounds |
| --- | --- | --- |
| `(marketing)/page.tsx` | 3600 | How stale the GitHub star count can get. The page text changes only on deploy. |
| `docs/authentication`, `docs/mcp`, `docs/api`, `docs/api/errors` | 3600 | How stale the CMS-driven sidebar can get. The page text changes only on deploy. |
| `docs/[[...slug]]`, `blog`, `blog/[slug]`, `blog/authors`, `blog/authors/[authorId]`, `blog/tags`, `blog/tags/[slug]` | 3600 | Nothing, in the normal case. A CMS edit calls `revalidatePath` (`revalidateCmsEntryPaths` in `src/app/[locale]/(app)/(admin)/admin/_actions/cms-entry-revalidation.ts`) and clears these paths straight away, so readers see edits immediately. The hour is the backstop if that clearing fails. |
| `(legal)/privacy`, `(legal)/terms` | 86400 | Nothing. These change only on deploy, and there is no live data on them. |

## The value must be a numeric literal

Never write `export const revalidate = SOME_CONSTANT`, and never centralize the number itself. Vinext
reads this export twice, and only one of the two reads evaluates your code:

- **At runtime**, `resolveAppPageSegmentConfig` (`vinext/dist/server/app-segment-config.js`) reads the
  value off the imported module, so any expression works.
- **At build time**, `classifyAppRoute` (`vinext/dist/build/report.js`) parses the file and accepts
  only a number literal, `false`, `Infinity`, and a unary `+`/`-` on a literal. An identifier resolves
  to `null`, and the route drops from `isr` to `unknown`.

An `unknown` route loses its Nitro `swr` route rule (`vinext/dist/build/nitro-route-rules.js`, which
only emits a rule for `type === "isr"` with a finite positive number) and shows as unknown in the
build report. The page still revalidates at runtime, so the loss is silent.

Re-check this on a Vinext upgrade, the same as the other pinned-behavior audits.

## Adding a cacheable page

Put the literal above the default export with a one-line pointer, and add a row to the table above:

```ts
// Cached for an hour — see docs/page-caching.md.
export const revalidate = 3600;
```
