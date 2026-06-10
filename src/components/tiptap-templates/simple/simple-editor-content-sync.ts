type EditorContentSyncAction = "skip" | "mark-synced" | "sync"

export function getSerializableContentKey(content: unknown) {
  if (!content) {
    return null
  }

  return JSON.stringify(content)
}

export function getEditorContentSyncAction({
  incomingContentKey,
  lastSyncedContentKey,
  editorContentKey,
}: {
  incomingContentKey: string | null
  lastSyncedContentKey: string | null
  editorContentKey: string | null
}): EditorContentSyncAction {
  if (!incomingContentKey || incomingContentKey === lastSyncedContentKey) {
    return "skip"
  }

  if (incomingContentKey === editorContentKey) {
    return "mark-synced"
  }

  return "sync"
}

export function syncEditorContentFromProps({
  getEditorContent,
  setEditorContent,
  content,
  lastSyncedContentKey,
}: {
  getEditorContent: (() => unknown) | null
  setEditorContent: ((content: unknown) => void) | null
  content: unknown
  lastSyncedContentKey: string | null
}) {
  if (!getEditorContent || !setEditorContent || !content) {
    return lastSyncedContentKey
  }

  const incomingContentKey = getSerializableContentKey(content)

  if (!incomingContentKey || incomingContentKey === lastSyncedContentKey) {
    return lastSyncedContentKey
  }

  const syncAction = getEditorContentSyncAction({
    incomingContentKey,
    lastSyncedContentKey,
    editorContentKey: getSerializableContentKey(getEditorContent()),
  })

  if (syncAction === "sync") {
    setEditorContent(content)
  }

  return syncAction === "skip" ? lastSyncedContentKey : incomingContentKey
}
