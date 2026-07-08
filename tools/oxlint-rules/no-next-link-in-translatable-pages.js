import path from "node:path"

// Translatable pages live under the `[locale]` App Router segment, where hrefs
// must be locale-prefixed. The plain `next/link` renders bare hrefs and breaks
// out of the active locale, so those pages must use `Link` from
// `@/i18n/navigation` (next-intl's locale-aware Link) instead.
//
// Admin pages (and everything else outside `[locale]`) are intentionally
// untranslated, so they may keep importing `next/link` directly.
const LOCALE_SEGMENT = "/app/[locale]/"
const ADMIN_SEGMENT = "/admin/"
const INTL_NAVIGATION_IMPORT = "@/i18n/navigation"

function normalizePath(filePath) {
  return path.resolve(filePath).replaceAll(path.sep, "/")
}

function isTranslatablePage(filePath) {
  const normalized = normalizePath(filePath)

  // Only files rendered under the localized route tree are translatable.
  if (!normalized.includes(LOCALE_SEGMENT)) {
    return false
  }

  // Admin lives outside `[locale]` today, but guard explicitly so an admin
  // sub-tree nested under a localized route would still be exempt.
  if (normalized.includes(ADMIN_SEGMENT)) {
    return false
  }

  return true
}

export const noNextLinkInTranslatablePagesRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing `next/link` in translatable pages; use `Link` from `@/i18n/navigation` instead.",
    },
    schema: [],
  },
  create(context) {
    if (!isTranslatablePage(context.filename)) {
      return {}
    }

    return {
      ImportDeclaration(node) {
        if (node.source?.value !== "next/link") {
          return
        }

        context.report({
          node: node.source,
          message: `Do not import "next/link" in translatable pages under app/[locale]. Import { Link } from "${INTL_NAVIGATION_IMPORT}" so hrefs stay prefixed with the active locale. Admin pages are exempt and may keep using "next/link".`,
        })
      },
    }
  },
}
