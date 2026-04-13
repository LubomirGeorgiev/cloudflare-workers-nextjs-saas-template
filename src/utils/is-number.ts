export function isNumber({
  value,
}: {
  value: unknown
}): boolean {
  if (typeof value !== "string") {
    return false
  }

  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return false
  }

  const parsedValue = Number(normalizedValue)

  if (!Number.isFinite(parsedValue)) {
    return false
  }

  return true
}
