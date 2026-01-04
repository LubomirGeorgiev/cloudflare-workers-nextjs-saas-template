/**
 * Format a date into a human-readable string (date only)
 * @param date Date to format
 * @returns Formatted date string (e.g., "Jan 15, 2024")
 */
export function formatDate(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);
}

/**
 * Format a date and time into a human-readable string
 * @param date Date to format
 * @returns Formatted date-time string (e.g., "Jan 15, 2024, 02:30 PM")
 */
export function formatDateTime(date: string | Date | number): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
