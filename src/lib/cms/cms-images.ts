import "server-only";
import { CMS_IMAGES_BASE_PATH, CMS_IMAGES_API_ROUTE } from "@/constants";

/**
 * Generate R2 key for CMS image
 * @param collection - The CMS collection slug (e.g., "blog", "products")
 * @param filename - The filename with extension
 * @returns The full R2 key path
 */
export function getCmsImageR2Key({
  collection,
  filename,
}: {
  collection: string;
  filename: string;
}): string {
  return `${CMS_IMAGES_BASE_PATH}/${collection}/${filename}`;
}

/**
 * Generate public URL for CMS image
 * @param r2Key - The R2 key for the image
 * @returns The public URL to access the image
 */
export function getCmsImagePublicUrl(r2Key: string): string {
  return `${CMS_IMAGES_API_ROUTE}/${r2Key}`;
}
