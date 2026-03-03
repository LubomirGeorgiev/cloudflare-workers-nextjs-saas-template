interface GetValidDateOrNowParams {
  value: Date | null | undefined
  fallback?: Date
}

interface GetCmsEntryDatesParams {
  publishedAt: Date | null | undefined
  createdAt: Date | null | undefined
  updatedAt: Date | null | undefined
}

export function getValidDateOrNow({
  value,
  fallback,
}: GetValidDateOrNowParams): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  return fallback ?? new Date()
}

export function getCmsEntryDates({
  publishedAt,
  createdAt,
  updatedAt,
}: GetCmsEntryDatesParams): { publishedDate: Date; modifiedDate: Date } {
  const publishedDate = getValidDateOrNow({
    value: publishedAt,
    fallback: getValidDateOrNow({ value: createdAt }),
  })

  const modifiedDate = getValidDateOrNow({
    value: updatedAt,
    fallback: publishedDate,
  })

  return { publishedDate, modifiedDate }
}
