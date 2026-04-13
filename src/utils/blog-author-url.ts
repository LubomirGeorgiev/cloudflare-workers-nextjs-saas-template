import { generateSlug } from "@/utils/slugify"

const AUTHOR_ROUTE_ID_SEPARATOR = "--"

export interface AuthorUrlIdentity {
  id: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

export function getAuthorDisplayName(author: AuthorUrlIdentity): string {
  const fullName = [author.firstName, author.lastName].filter(Boolean).join(" ")

  if (fullName) return fullName

  return author.email || "Unknown Author"
}

function getAuthorSlugBase(author: AuthorUrlIdentity): string {
  const fullName = [author.firstName, author.lastName].filter(Boolean).join(" ")
  const slugSource = fullName || "author"
  const slug = generateSlug(slugSource)

  return slug || "author"
}

export function getAuthorRouteParam(author: AuthorUrlIdentity): string {
  const slugBase = getAuthorSlugBase(author)

  return `${slugBase}${AUTHOR_ROUTE_ID_SEPARATOR}${author.id}`
}

export function parseAuthorIdFromRouteParam(routeParam: string): string | null {
  if (!routeParam) return null

  // Legacy format: raw ID only.
  if (!routeParam.includes(AUTHOR_ROUTE_ID_SEPARATOR)) return routeParam

  // Name comes first; extract the ID from the final separator.
  const separatorIndex = routeParam.lastIndexOf(AUTHOR_ROUTE_ID_SEPARATOR)

  if (separatorIndex === -1) return null

  const id = routeParam.slice(separatorIndex + AUTHOR_ROUTE_ID_SEPARATOR.length).trim()
  if (!id) return null

  return id
}
