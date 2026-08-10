import path from "node:path"

// Why this rule exists.
//
// If you ask next-intl for translations without telling it the locale, it works the locale out by
// reading the request headers. Reading headers tells the framework "this page depends on the
// request", so it refuses to cache the page and ignores any `revalidate` you set. One such call
// anywhere in a page's tree does it — including a shared component like the footer — and nothing
// fails, the page just quietly stops being cached.
//
// The fix is always the same: `getTranslator({ locale, namespace: "Namespace" })` from
// "@/i18n/translator", with `locale` coming from the route's `params`.
//
// Do not try to avoid passing the locale around by stashing it somewhere per-request. That is what
// next-intl's own `setRequestLocale` does (a React `cache()` slot) and it does not work here: a
// child can render before the layout that sets it, and each render pass gets a fresh slot. Reads
// then miss at random and fall back to the default locale, so the page renders in the wrong
// language some of the time. This was measured, not assumed. It stays imported in
// `app/[locale]/layout.tsx` as a best-effort cache hint for next-intl's own implicit-locale APIs
// (a server-rendered `<Link>`), which is why it is the one allowed import below.
//
// Deliberately no exemption for `not-found.tsx`. It gets no props from Next.js, so it cannot read a
// locale from `params` — but it is also rendered as part of a *successful* request, not just a 404,
// so an implicit call there makes the whole route uncacheable. Make it a `"use client"` component
// and use `useTranslations`, which reads the locale from NextIntlClientProvider.
//
// The two modules are checked differently on purpose. Every runtime export of "next-intl/server"
// except `setRequestLocale` resolves the locale from the request, so that module gets an import
// allowlist and no call-shape analysis to get wrong. "next-intl" mixes safe exports (`hasLocale`,
// `createTranslator`, `NextIntlClientProvider`) with request-scoped hooks, so there only the hook
// calls are reported.
const WATCHED_SEGMENTS = ["/src/app/[locale]/", "/src/components/", "/src/layouts/"]

// The signed-in app is exempt: every route under it is session-gated, so it reads the session
// cookie and is already uncacheable before next-intl gets a say. Shared components are not exempt —
// a public page can render the same component — so they stay in the watched set above.
const EXEMPT_SEGMENTS = ["/src/app/[locale]/(app)/"]

// Route handlers are exempt: they are dynamic by default and are not part of any page's render
// tree, so resolving the locale from the request costs no caching there. Pages, layouts, and
// components get no such pass.
const EXEMPT_BASENAME_PATTERN = /^route\.[cm]?[jt]sx?$/

const TRANSLATOR_IMPORT = "@/i18n/translator"
const NEXT_INTL_MODULE = "next-intl"
const NEXT_INTL_SERVER_MODULE = "next-intl/server"
const REQUEST_HOOKS = new Set(["useTranslations", "useLocale", "useFormatter", "useNow"])

// `getRequestConfig` is the config module's own export and lives in src/i18n/, outside the watched
// dirs. Everything else here resolves the locale from headers(); use `getTranslator` instead.
const ALLOWED_NEXT_INTL_SERVER_IMPORTS = new Set(["setRequestLocale"])

const CACHING_CONSEQUENCE =
  "makes this route uncacheable (vinext returns no-store and ignores `revalidate`)"
const EXPLICIT_LOCALE_FIX = `Use \`getTranslator({ locale, namespace: "Namespace" })\` from "${TRANSLATOR_IMPORT}" with the locale from \`params\`.`

function normalizePath(filePath) {
  return path.resolve(filePath).replaceAll(path.sep, "/")
}

function isWatchedFile(filePath) {
  const normalized = normalizePath(filePath)

  if (EXEMPT_BASENAME_PATTERN.test(path.basename(normalized))) {
    return false
  }

  if (EXEMPT_SEGMENTS.some((segment) => normalized.includes(segment))) {
    return false
  }

  return WATCHED_SEGMENTS.some((segment) => normalized.includes(segment))
}

function getSourceCode(context) {
  return context.sourceCode ?? context.getSourceCode?.()
}

function getProgramBody(context) {
  return getSourceCode(context)?.ast?.body ?? []
}

// A `"use client"` file runs in the browser, where these hooks read from `NextIntlClientProvider`
// and never touch `headers()`.
function hasUseClientDirective(context) {
  for (const statement of getProgramBody(context)) {
    if (statement.type !== "ExpressionStatement") {
      break
    }
    const value = statement.expression?.value ?? statement.directive
    if (typeof value !== "string") {
      break
    }
    if (value === "use client") {
      return true
    }
  }

  return false
}

// The binding a name reaches from `scope`. The innermost declaration wins, so a parameter or a
// local function shadowing an import resolves to the shadow, not to the import.
function findVariable({ scope, name }) {
  for (let current = scope; current !== null && current !== undefined; current = current.upper) {
    const variable = current.set?.get(name)
    if (variable !== undefined) {
      return variable
    }
  }

  return null
}

// The specifier that binds `name` to a runtime value of "next-intl", or `null`. Match on what the
// file imported, not on how the callee is spelled: a local `useTranslations` is harmless, and
// `useTranslations as useCopy` is not. Either half of the declaration can carry `type`.
function getNextIntlBinding({ scope, name }) {
  const variable = findVariable({ scope, name })

  for (const definition of variable?.defs ?? []) {
    if (definition.type !== "ImportBinding" || definition.node?.importKind === "type") {
      continue
    }

    const declaration = definition.parent
    if (declaration?.importKind === "type" || declaration?.source?.value !== NEXT_INTL_MODULE) {
      continue
    }

    return definition.node
  }

  return null
}

// Returns the hook callee as it is written, or `null` when the call is not a request-scoped hook.
function getRequestHookName({ callee, scope }) {
  if (callee?.type === "Identifier") {
    const binding = getNextIntlBinding({ scope, name: callee.name })

    return binding?.type === "ImportSpecifier" && REQUEST_HOOKS.has(binding.imported?.name)
      ? callee.name
      : null
  }

  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return null
  }
  if (callee.object?.type !== "Identifier" || callee.property?.type !== "Identifier") {
    return null
  }
  if (!REQUEST_HOOKS.has(callee.property.name)) {
    return null
  }

  const binding = getNextIntlBinding({ scope, name: callee.object.name })

  return binding?.type === "ImportNamespaceSpecifier"
    ? `${callee.object.name}.${callee.property.name}`
    : null
}

function reportServerModuleImport({ context, node }) {
  for (const specifier of node.specifiers ?? []) {
    if (specifier.type === "ImportNamespaceSpecifier") {
      context.report({
        node: specifier,
        message: `\`import * as ${specifier.local?.name} from "${NEXT_INTL_SERVER_MODULE}"\` reaches every locale-resolving export, and those read \`headers()\`, which ${CACHING_CONSEQUENCE}. Import \`setRequestLocale\` by name if that is all you need. ${EXPLICIT_LOCALE_FIX}`,
      })
      continue
    }

    if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") {
      continue
    }

    const exportName = specifier.imported?.name
    if (exportName === undefined || ALLOWED_NEXT_INTL_SERVER_IMPORTS.has(exportName)) {
      continue
    }

    context.report({
      node: specifier,
      message: `\`${exportName}\` from "${NEXT_INTL_SERVER_MODULE}" resolves the locale from \`headers()\`, which ${CACHING_CONSEQUENCE}. ${EXPLICIT_LOCALE_FIX}`,
    })
  }
}

export const noImplicitLocaleTranslationsRule = {
  meta: {
    // The literal type keeps this object assignable to oxlint's `Rule` in the TypeScript test.
    /** @type {"problem"} */
    type: "problem",
    docs: {
      description:
        "Disallow request-scoped translation APIs in server components; pass an explicit locale via `getTranslator`.",
    },
    schema: [],
  },
  create(context) {
    if (!isWatchedFile(context.filename)) {
      return {}
    }

    // Only the hook half has a `"use client"` escape hatch. "next-intl/server" is a server-only
    // module, so importing it from a client file is a bug in its own right.
    const checksHooks = !hasUseClientDirective(context)

    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || node.source?.value !== NEXT_INTL_SERVER_MODULE) {
          return
        }

        reportServerModuleImport({ context, node })
      },
      CallExpression(node) {
        if (!checksHooks) {
          return
        }

        // Call `getScope` directly: without it every call resolves to nothing and the rule turns
        // itself off, which is the exact failure this rule exists to catch.
        const scope = getSourceCode(context).getScope(node)
        const calleeName = getRequestHookName({ callee: node.callee, scope })
        if (calleeName === null) {
          return
        }

        context.report({
          node: node.callee,
          message: `\`${calleeName}\` resolves the locale from \`headers()\`, which ${CACHING_CONSEQUENCE}. ${EXPLICIT_LOCALE_FIX} Or add "use client" if this really is a client component.`,
        })
      },
    }
  },
}
