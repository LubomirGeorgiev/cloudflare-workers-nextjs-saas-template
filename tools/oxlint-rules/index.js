import { noUnusedModuleExportsRule } from "./no-unused-module-exports.js"

export { noUnusedModuleExportsRule } from "./no-unused-module-exports.js"

const plugin = {
  meta: {
    name: "project",
  },
  rules: {
    "no-unused-module-exports": noUnusedModuleExportsRule,
  },
}

export default plugin
