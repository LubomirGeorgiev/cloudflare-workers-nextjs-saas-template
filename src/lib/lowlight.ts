import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import shell from "highlight.js/lib/languages/shell"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import { createLowlight } from "lowlight"

// Lives apart from the tiptap extensions so non-editor consumers (the MCP connect snippets) can
// highlight without pulling the whole editor into their bundle.
export const sharedLowlight = createLowlight({
  bash,
  css,
  docker: dockerfile,
  dockerfile,
  html: xml,
  js: javascript,
  javascript,
  jsx: javascript,
  json,
  markdown,
  python,
  shell,
  sql,
  ts: typescript,
  tsx: typescript,
  typescript,
  xml,
  yaml,
})

export type LowlightInstance = ReturnType<typeof createLowlight>
