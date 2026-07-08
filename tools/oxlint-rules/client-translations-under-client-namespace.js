// Client components receive their messages from `NextIntlClientProvider`. The root
// provider forwards ONLY the top-level `Client` namespace (see `getClientMessages`),
// so every `useTranslations(...)` call inside a client component must reference a
// namespace under `Client.` (e.g. `useTranslations("Client.Auth.SignIn")`). A call
// to any other namespace would read messages that are never serialized to the
// client, so the lookup would throw at runtime.
//
// Server components, metadata, and server actions use `getTranslations` (async)
// and may read any namespace — including `Client.*` (the strings live in one place
// and are not duplicated) — so this rule only applies to `useTranslations` inside
// files carrying the `"use client"` directive.
const CLIENT_NAMESPACE = "Client"
const HOOK_NAME = "useTranslations"
const NEXT_INTL_MODULE = "next-intl"

// A file ships to the client only if it opens with the `"use client"` directive.
// Path-based detection would miss client components living outside `[locale]`
// (settings, dashboard, shared `src/components`), which still receive messages
// from the root provider, so key off the directive instead.
function hasUseClientDirective(programNode) {
  for (const statement of programNode.body) {
    // The directive prologue is a run of leading string-literal statements; stop
    // at the first statement that isn't one.
    if (
      statement.type !== "ExpressionStatement" ||
      statement.expression?.type !== "Literal" ||
      typeof statement.expression.value !== "string"
    ) {
      break
    }
    if (statement.expression.value === "use client") {
      return true
    }
  }
  return false
}

// Resolves a compile-time string from a string literal or a template literal that
// has no interpolations; returns null for anything only known at runtime.
function getStaticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked
  }
  return null
}

export const clientTranslationsUnderClientNamespaceRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require `useTranslations` in client components to reference the `Client.*` namespace, so the root provider can forward only that namespace to the client.",
    },
    schema: [],
  },
  create(context) {
    let isClientComponent = false
    // Local binding for `useTranslations` from `next-intl`; tracked so aliased
    // imports (`import { useTranslations as useT }`) are still matched and
    // unrelated identically-named functions are not.
    let hookLocalName = null

    return {
      Program(node) {
        isClientComponent = hasUseClientDirective(node)
      },
      ImportDeclaration(node) {
        if (node.source?.value !== NEXT_INTL_MODULE) {
          return
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported?.name === HOOK_NAME
          ) {
            hookLocalName = specifier.local.name
          }
        }
      },
      CallExpression(node) {
        if (!isClientComponent || !hookLocalName) {
          return
        }
        if (
          node.callee?.type !== "Identifier" ||
          node.callee.name !== hookLocalName
        ) {
          return
        }

        const namespaceArg = node.arguments[0]

        // A namespace-less call reads the whole (client) catalog root, which
        // reaches outside `Client.*` and defeats the subsetting convention.
        if (!namespaceArg) {
          context.report({
            node,
            message: `Call "${HOOK_NAME}" with an explicit "${CLIENT_NAMESPACE}.…" namespace in client components. Only the "${CLIENT_NAMESPACE}" namespace is forwarded to the client; a namespace-less call reads messages that are not serialized.`,
          })
          return
        }

        const namespace = getStaticString(namespaceArg)

        // A dynamic namespace can't be checked against the convention statically.
        if (namespace === null) {
          context.report({
            node: namespaceArg,
            message: `Pass a string-literal "${CLIENT_NAMESPACE}.…" namespace to "${HOOK_NAME}" in client components so it can be verified to live under the forwarded "${CLIENT_NAMESPACE}" namespace.`,
          })
          return
        }

        const topLevel = namespace.split(".")[0]
        if (topLevel !== CLIENT_NAMESPACE) {
          context.report({
            node: namespaceArg,
            message: `"${topLevel}" is not forwarded to the client. Client components may only use the "${CLIENT_NAMESPACE}.…" namespace (e.g. "${CLIENT_NAMESPACE}.${namespace}"). Move this copy under "${CLIENT_NAMESPACE}" in messages/*.json, or keep it server-side via getTranslations.`,
          })
        }
      },
    }
  },
}
