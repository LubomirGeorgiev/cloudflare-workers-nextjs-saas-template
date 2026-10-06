// The user columns that public CMS pages render for an entry author. A change to any of them
// (except the id) makes the cached author copies stale.
export const CMS_AUTHOR_COLUMNS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
} as const;

/** True when a user write changed a field that public CMS pages render for that author. */
export function hasCmsAuthorFieldChange({
  before,
  after,
}: {
  before: CmsAuthorFields;
  after: CmsAuthorFields;
}): boolean {
  return CMS_AUTHOR_RENDERED_FIELDS.some((field) => before[field] !== after[field]);
}

const CMS_AUTHOR_RENDERED_FIELDS = Object.keys(CMS_AUTHOR_COLUMNS).filter(
  (field): field is CmsAuthorRenderedField => field !== "id",
);

type CmsAuthorRenderedField = Exclude<keyof typeof CMS_AUTHOR_COLUMNS, "id">;

export type CmsAuthorFields = Record<CmsAuthorRenderedField, string | null>;
