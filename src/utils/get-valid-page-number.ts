import { isNumber } from "@/utils/is-number"

export function getValidPageNumber({
  value,
}: {
  value: unknown
}): number | null {
  // Route params arrive as strings; nuqs `parseAsInteger` already hands over a number.
  if (typeof value !== "number" && !isNumber({ value })) {
    return null
  }

  const pageNumber = Number(value)

  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : null
}
