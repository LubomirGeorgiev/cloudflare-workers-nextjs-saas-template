"use server"

import { env as workerEnv } from "cloudflare:workers"

import { VINEXT_CACHE_PREFIX } from "@/constants/vinext-cache"
import { ActionError } from "@/lib/action-error"
import { actionClient } from "@/lib/safe-action"
import { requireAdmin } from "@/utils/auth"

function getVinextCache(): KVNamespace {
  const cache = workerEnv.NEXT_INC_CACHE_KV

  if (!cache) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "Vinext cache KV binding is unavailable")
  }

  return cache
}

function formatDeletedKeyMessage(deletedKeyCount: number): string {
  const keyLabel = deletedKeyCount === 1 ? "key" : "keys"
  return `Deleted ${deletedKeyCount} Vinext cache ${keyLabel}`
}

export const purgeVinextCacheAction = actionClient.action(async () => {
  await requireAdmin()

  const cache = getVinextCache()

  let cursor: string | undefined
  let deletedKeyCount = 0

  do {
    const page = await cache.list({
      cursor,
      prefix: VINEXT_CACHE_PREFIX,
    })

    await Promise.all(page.keys.map(({ name }) => cache.delete(name)))
    deletedKeyCount += page.keys.length
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  return {
    deletedKeyCount,
    message: formatDeletedKeyMessage(deletedKeyCount),
  }
})
