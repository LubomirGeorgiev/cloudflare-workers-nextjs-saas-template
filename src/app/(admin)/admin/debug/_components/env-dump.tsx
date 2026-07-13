"use client"

import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

interface EnvDumpProps {
  value: unknown
}

interface EnvValueProps {
  label: string
  path: string
  value: unknown
}

function formatPrimitive(value: unknown): string {
  if (value === undefined) return "undefined"
  return JSON.stringify(value)
}

function EnvValue({ label, path, value }: EnvValueProps) {
  const [isRevealed, setIsRevealed] = useState(false)

  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1.5 rounded px-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${isRevealed ? "Hide" : "Reveal"} value for ${label}`}
      aria-expanded={isRevealed}
      onClick={() => setIsRevealed((currentValue) => !currentValue)}
    >
      {isRevealed ? (
        <>
          <span className="break-all">{formatPrimitive(value)}</span>
          <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </>
      ) : (
        <>
          <span className="select-none tracking-widest text-muted-foreground">••••••••</span>
          <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </>
      )}
      <span className="sr-only">{path}</span>
    </button>
  )
}

function EnvNode({ label, path, value }: EnvValueProps) {
  if (value === null || typeof value !== "object") {
    return <EnvValue label={label} path={path} value={value} />
  }

  const entries = Object.entries(value)
  const isArray = Array.isArray(value)

  if (entries.length === 0) {
    return <EnvValue label={label} path={path} value={isArray ? [] : {}} />
  }

  return (
    <span>
      {isArray ? "[" : "{"}
      <span className="block pl-4">
        {entries.map(([key, entryValue], index) => {
          const entryPath = `${path}.${key}`

          return (
            <span className="block" key={entryPath}>
              <span className="text-muted-foreground">{JSON.stringify(key)}: </span>
              <EnvNode label={key} path={entryPath} value={entryValue} />
              {index < entries.length - 1 ? "," : null}
            </span>
          )
        })}
      </span>
      {isArray ? "]" : "}"}
    </span>
  )
}

export function EnvDump({ value }: EnvDumpProps) {
  return (
    <pre className="max-h-[calc(100vh-14rem)] overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
      <EnvNode label="environment" path="environment" value={value} />
    </pre>
  )
}
