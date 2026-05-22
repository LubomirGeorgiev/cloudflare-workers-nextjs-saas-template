import { noUnusedModuleExportsRule } from "./no-unused-module-exports.js"
import { noObjectParamsInReactCacheRule } from "./no-object-params-in-react-cache.js"

export { noUnusedModuleExportsRule } from "./no-unused-module-exports.js"
export { noObjectParamsInReactCacheRule } from "./no-object-params-in-react-cache.js"

const plugin = {
  meta: {
    name: "project",
  },
  rules: {
    "no-unused-module-exports": noUnusedModuleExportsRule,
    "no-object-params-in-react-cache": noObjectParamsInReactCacheRule,
  },
}

export default plugin
