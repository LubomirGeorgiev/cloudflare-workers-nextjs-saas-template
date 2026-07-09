import slugify from 'slugify';

export function generateSlug(str: string): string {
  return slugify(str, {
    lower: true,      // Convert to lowercase
    strict: true,     // Strip special characters
    trim: true        // Trim leading and trailing spaces
  });
}
