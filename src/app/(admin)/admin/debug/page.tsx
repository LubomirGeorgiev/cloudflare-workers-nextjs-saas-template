import { env as workerEnv } from "cloudflare:workers"
import type { Metadata } from "next"

import { PageHeader } from "@/components/page-header"
import { isTestMode } from "@/utils/is-test-mode"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Environment Debug | Admin",
  description: "Dump runtime environment variables",
}

interface SerializableEnvDump {
  appTestMode: boolean
  nodeEnv: string | undefined
  processEnv: Record<string, string | undefined>
  workerEnv: Record<string, unknown>
}

function stringifyEnvValue(value: unknown): unknown {
  if (value === null || value === undefined) return value

  const valueType = typeof value
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return value
  }

  if (valueType === "bigint") {
    return String(value)
  }

  if (valueType === "function") {
    return `[Function ${(value as { name?: string }).name || "anonymous"}]`
  }

  try {
    const serialized = JSON.stringify(value)
    if (serialized && serialized !== "{}") {
      return JSON.parse(serialized)
    }
  } catch {
    // Cloudflare binding objects are not always JSON serializable.
  }

  const constructorName = value.constructor?.name
  return constructorName ? `[${constructorName}]` : Object.prototype.toString.call(value)
}

function buildEnvDump(): SerializableEnvDump {
  const workerEntries = Object.entries(workerEnv)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => [key, stringifyEnvValue(value)])

  const processEntries = Object.entries(process.env).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  )

  return {
    appTestMode: isTestMode(),
    nodeEnv: process.env.NODE_ENV,
    processEnv: Object.fromEntries(processEntries),
    workerEnv: Object.fromEntries(workerEntries),
  }
}

export default function AdminDebugPage() {
  const envDump = buildEnvDump()

  return (
    <>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/debug", label: "Debug" },
        ]}
      />
      <main className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Environment Debug</h1>
          <p className="mt-2 text-muted-foreground">
            Runtime Worker env bindings and process environment variables.
          </p>
        </div>
        <pre className="max-h-[calc(100vh-14rem)] overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
          {JSON.stringify(envDump, null, 2)}
        </pre>
      </main>
    </>
  )
}
