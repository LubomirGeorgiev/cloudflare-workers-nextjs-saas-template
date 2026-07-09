
export function getInitials(name: string, maxLength = 2): string {
  if (!name) return ""

  // Split the name into parts and filter out empty strings
  const parts = name.split(/\s+/).filter(Boolean)

  // If we have no parts, return empty string
  if (parts.length === 0) return ""

  // Take the first letter of each part up to maxLength
  const initials = parts
    .slice(0, maxLength)
    .map(part => part[0].toUpperCase())
    .join("")

  return initials
}
