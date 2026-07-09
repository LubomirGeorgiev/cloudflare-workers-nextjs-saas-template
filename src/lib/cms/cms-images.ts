import "server-only";
import { CMS_IMAGES_BASE_PATH, CMS_IMAGES_API_ROUTE } from "@/constants";

export function getCmsImageR2Key({
  collection,
  filename,
}: {
  collection: string;
  filename: string;
}): string {
  return `${CMS_IMAGES_BASE_PATH}/${collection}/${filename}`;
}

export function getCmsImagePublicUrl(r2Key: string): string {
  return `${CMS_IMAGES_API_ROUTE}/${r2Key}`;
}
