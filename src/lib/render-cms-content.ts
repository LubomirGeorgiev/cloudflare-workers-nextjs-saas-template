import "server-only"
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string"
import type { JSONContent } from "@tiptap/core"
import { getTiptapBaseExtensions } from "@/lib/tiptap-base-extensions"
import { createLowlight, common } from "lowlight"

/**
 * Minimal type for lowlight AST nodes based on what we actually use.
 * Lowlight returns hast (Hypertext Abstract Syntax Tree) nodes, but we only
 * need a subset of the properties for our HTML conversion.
 */
interface LowlightASTNode {
  type: 'text' | 'element'
  value?: string
  properties?: {
    className?: string[]
  }
  children?: LowlightASTNode[]
}

const lowlight = createLowlight(common)

/**
 * Renders Tiptap JSON content to HTML with syntax highlighting applied.
 * This processes code blocks to add syntax highlighting classes using lowlight.
 * Can be used for any CMS content (blog posts, pages, documentation, etc.)
 */
export function renderCmsContent(content: JSONContent): string {
  const htmlContent = renderToHTMLString({
    extensions: getTiptapBaseExtensions(),
    content,
  })

  let processedHtml = htmlContent.replace(
    /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
    (match, language, code) => {
      try {
        const decodedCode = code
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")

        const result = lowlight.highlight(language, decodedCode)

        const highlightedCode = astToHtml(result.children as LowlightASTNode[])

        return `<pre><code class="language-${language}">${highlightedCode}</code></pre>`
      } catch (error) {
        console.error(`Failed to highlight ${language} code:`, error)
        return match
      }
    }
  )

  // Remove nofollow and noreferrer from links to make them dofollow
  // TODO We need to add target="_blank" for external links based on SITE_URL in constants.ts
  processedHtml = processedHtml.replace(
    /(<a[^>]*\srel=")([^"]*)(")/g,
    (match, prefix, relValue, suffix) => {
      // Keep only noopener for security
      const cleanedRel = relValue
        .split(/\s+/)
        .filter((attr: string) => attr && attr !== 'nofollow' && attr !== 'noreferrer')
        .join(' ')
        .trim()

      if (!cleanedRel) {
        return match.replace(/\s*rel="[^"]*"/, '')
      }
      return `${prefix}${cleanedRel}${suffix}`
    }
  )

  processedHtml = processedHtml.replace(/\sclass=null\b/g, '')

  return processedHtml
}

/**
 * Converts lowlight's AST (hast) to HTML string with hljs classes
 */
function astToHtml(nodes: LowlightASTNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') {
        // Escape HTML entities
        const textValue = node.value ?? ''
        return textValue
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
      }

      if (node.type === 'element') {
        // Convert lowlight classes to hljs classes
        const className = Array.isArray(node.properties?.className)
          ? node.properties.className.join(' ')
          : ''

        const children = node.children ? astToHtml(node.children) : ''

        if (className) {
          return `<span class="${className}">${children}</span>`
        }

        return children
      }

      return ''
    })
    .join('')
}
