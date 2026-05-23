"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const COMMON_LANGUAGES = [
  { value: "plaintext", label: "Plain Text" },
  { value: "js", label: "JavaScript" },
  { value: "ts", label: "TypeScript" },
  { value: "jsx", label: "JSX" },
  { value: "tsx", label: "TSX" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Bash" },
  { value: "shell", label: "Shell" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
  { value: "sql", label: "SQL" },
  { value: "docker", label: "Docker" },
  { value: "markdown", label: "Markdown" },
  { value: "python", label: "Python" },
]

const LANGUAGE_ALIASES: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  dockerfile: "docker",
  yml: "yaml",
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export interface CodeBlockLanguageSelectorProps {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
}

/**
 * Language selector component for code blocks.
 * Allows users to change the syntax highlighting language of the current code block.
 *
 * @example
 * ```tsx
 * function MyToolbar() {
 *   return (
 *     <div>
 *       <CodeBlockButton />
 *       <CodeBlockLanguageSelector />
 *     </div>
 *   )
 * }
 * ```
 */
export function CodeBlockLanguageSelector({
  editor: providedEditor,
}: CodeBlockLanguageSelectorProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const [currentLanguage, setCurrentLanguage] = useState<string>("plaintext")

  // Check if we're currently in a code block
  const isInCodeBlock = editor?.isActive("codeBlock") ?? false

  // Update current language when selection changes
  useEffect(() => {
    if (!editor || !isInCodeBlock) {
      setCurrentLanguage("plaintext")
      return
    }

    const handleUpdate = () => {
      // Find the code block node by checking parent nodes
      const { $from } = editor.state.selection
      
      // Traverse up the tree to find the code block
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth)
        
        if (node.type.name === "codeBlock") {
          const attrs = node.attrs as { language?: string | null }
          const language = attrs?.language
          
          // Only update if we have a valid language, otherwise keep current or default to plaintext
          if (language !== null && language !== undefined && language !== "") {
            setCurrentLanguage(language)
          } else {
            setCurrentLanguage("plaintext")
          }
          return
        }
      }
      
      // If no code block found in parents, default to plaintext
      setCurrentLanguage("plaintext")
    }

    handleUpdate()
    editor.on("selectionUpdate", handleUpdate)
    editor.on("transaction", handleUpdate)

    return () => {
      editor.off("selectionUpdate", handleUpdate)
      editor.off("transaction", handleUpdate)
    }
  }, [editor, isInCodeBlock])

  const handleLanguageChange = useCallback(
    (language: string) => {
      // Prevent setting empty or invalid language
      if (!language || language.trim() === "") {
        return;
      }
      
      if (!editor) return

      editor
        .chain()
        .focus()
        .updateAttributes("codeBlock", { language })
        .run()

      setCurrentLanguage(language)
    },
    [editor]
  )

  // Don't show the selector if we're not in a code block
  if (!isInCodeBlock) {
    return null
  }

  // Ensure the current language is valid, otherwise use plaintext
  const normalizedLanguage = LANGUAGE_ALIASES[currentLanguage] ?? currentLanguage
  const validLanguage = COMMON_LANGUAGES.some(lang => lang.value === normalizedLanguage) 
    ? normalizedLanguage 
    : "plaintext"

  return (
    <Select 
      value={validLanguage} 
      onValueChange={handleLanguageChange}
    >
      <SelectTrigger className="w-[180px] h-8 text-xs">
        <SelectValue placeholder="Select language" />
      </SelectTrigger>
      <SelectContent>
        {COMMON_LANGUAGES.map((lang) => (
          <SelectItem key={lang.value} value={lang.value}>
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
