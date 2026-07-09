import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";

export function truncateSeoDescription(value: string): string {
  if (value.length <= CMS_SEO_DESCRIPTION_MAX_LENGTH) {
    return value;
  }
  return value.slice(0, CMS_SEO_DESCRIPTION_MAX_LENGTH - 3) + "...";
}
