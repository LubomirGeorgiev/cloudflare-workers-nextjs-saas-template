import { isNumber } from "@/utils/is-number"

export function getValidPageNumber({
  value,
}: {
  value: unknown
}): number | null {
  if (!isNumber({ value })) {
    return null
  }

  const pageNumber = Number(value)

  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : null
}
