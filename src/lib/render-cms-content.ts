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
  // First, render the Tiptap content to HTML
  const htmlContent = renderToHTMLString({
    extensions: getTiptapBaseExtensions(),
    content,
  })

  // Post-process the HTML to add syntax highlighting
  // Match code blocks with language classes
  let processedHtml = htmlContent.replace(
    /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
    (match, language, code) => {
      try {
        // Decode HTML entities in the code
        const decodedCode = code
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")

        // Highlight the code using lowlight
        const result = lowlight.highlight(language, decodedCode)

        // Convert lowlight's AST to HTML with hljs classes
        const highlightedCode = astToHtml(result.children as LowlightASTNode[])

        return `<pre><code class="language-${language}">${highlightedCode}</code></pre>`
      } catch (error) {
        // If highlighting fails, return the original code
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
      // Remove nofollow and noreferrer, keep only noopener for security
      const cleanedRel = relValue
        .split(/\s+/)
        .filter((attr: string) => attr && attr !== 'nofollow' && attr !== 'noreferrer')
        .join(' ')
        .trim()

      // If rel becomes empty after removing nofollow/noreferrer, remove the attribute entirely
      if (!cleanedRel) {
        return match.replace(/\s*rel="[^"]*"/, '')
      }
      return `${prefix}${cleanedRel}${suffix}`
    }
  )

  // Remove class=null (without quotes) from links
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
