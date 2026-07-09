import { noUnusedModuleExportsRule } from "./no-unused-module-exports.js"
import { noObjectParamsInReactCacheRule } from "./no-object-params-in-react-cache.js"
import { noNextLinkInTranslatablePagesRule } from "./no-next-link-in-translatable-pages.js"
import { clientTranslationsUnderClientNamespaceRule } from "./client-translations-under-client-namespace.js"

export { noUnusedModuleExportsRule } from "./no-unused-module-exports.js"
export { noObjectParamsInReactCacheRule } from "./no-object-params-in-react-cache.js"
export { noNextLinkInTranslatablePagesRule } from "./no-next-link-in-translatable-pages.js"
export { clientTranslationsUnderClientNamespaceRule } from "./client-translations-under-client-namespace.js"

const plugin = {
  meta: {
    name: "project",
  },
  rules: {
    "no-unused-module-exports": noUnusedModuleExportsRule,
    "no-object-params-in-react-cache": noObjectParamsInReactCacheRule,
    "no-next-link-in-translatable-pages": noNextLinkInTranslatablePagesRule,
    "client-translations-under-client-namespace": clientTranslationsUnderClientNamespaceRule,
  },
}

export default plugin
