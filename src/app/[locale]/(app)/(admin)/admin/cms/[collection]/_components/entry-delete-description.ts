/** The delete dialog's warning. `translationCount` counts only the siblings that go with the entry. */
export function describeEntryDelete(translationCount: number): string {
  if (translationCount <= 0) {
    return "This will permanently delete this entry.";
  }

  if (translationCount === 1) {
    return "This will permanently delete this entry and its translation.";
  }

  return `This will permanently delete this entry and all ${translationCount} of its translations.`;
}
