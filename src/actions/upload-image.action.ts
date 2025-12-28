"use server";

import { z } from "zod";
import { ZSAError, createServerAction } from "zsa";
import { requireAdmin } from "@/utils/auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createId } from "@paralleldrive/cuid2";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { fileTypeFromBuffer } from "file-type";
import imageSize from "image-size";
import { CMS_IMAGE_MAX_FILE_SIZE, CMS_ALLOWED_IMAGE_TYPES } from "@/constants";
import { getCmsImageR2Key, getCmsImagePublicUrl } from "@/lib/cms/cms-images";
import { getDB } from "@/db";
import { cmsMediaTable } from "@/db/schema";

/**
 * Validates and sanitizes the filename
 */
function sanitizeFilename(filename: string): string {
  // Remove any path separators and keep only alphanumeric, dash, underscore, and dot
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 100); // Limit length
}

/**
 * Generate a unique filename for R2 storage
 */
function generateUniqueFilename({
  originalFilename,
  extension,
}: {
  originalFilename: string;
  extension: string;
}): string {
  const uniqueId = createId();
  const sanitizedName = sanitizeFilename(originalFilename);
  const nameWithoutExt = sanitizedName.replace(/\.[^/.]+$/, "");

  return `${uniqueId}-${nameWithoutExt}.${extension}`;
}

const uploadImageSchema = z.object({
  file: z.instanceof(File),
  collection: z.string().min(1, "Collection slug is required"),
});

/**
 * Upload an image to R2 bucket
 * Returns the public URL of the uploaded image
 */
export const uploadImageAction = createServerAction()
  .input(uploadImageSchema)
  .handler(async ({ input }) => {
    return withRateLimit(async () => {
      try {
        const session = await requireAdmin({ doNotThrowError: true });

        if (!session?.user?.id) {
          throw new ZSAError("FORBIDDEN", "You must be logged in to upload images");
        }

        const { file, collection } = input;

        // Validate file size first
        if (file.size > CMS_IMAGE_MAX_FILE_SIZE) {
          throw new ZSAError(
            "INPUT_PARSE_ERROR",
            `File size exceeds maximum allowed size of ${CMS_IMAGE_MAX_FILE_SIZE / 1024 / 1024}MB`
          );
        }

        // Convert File to ArrayBuffer for validation and upload
        const arrayBuffer = await file.arrayBuffer();

        // Validate actual file type using file-type (checks magic bytes, not just MIME type)
        const detectedType = await fileTypeFromBuffer(arrayBuffer);

        // Special handling for SVG (file-type doesn't detect SVG via magic bytes)
        let actualMimeType: string;
        let fileExtension: string;

        if (!detectedType && file.type === "image/svg+xml") {
          // Basic SVG validation - check if it starts with SVG markers
          const decoder = new TextDecoder();
          const start = decoder.decode(arrayBuffer.slice(0, 1000));
          if (start.includes("<svg") || start.includes("<?xml")) {
            actualMimeType = "image/svg+xml";
            fileExtension = "svg";
          } else {
            throw new ZSAError(
              "INPUT_PARSE_ERROR",
              "File does not appear to be a valid SVG image"
            );
          }
        } else if (!detectedType) {
          throw new ZSAError(
            "INPUT_PARSE_ERROR",
            "Unable to determine file type. Please upload a valid image file."
          );
        } else {
          actualMimeType = detectedType.mime;
          fileExtension = detectedType.ext;
        }

        // Validate against allowed types
        if (!(CMS_ALLOWED_IMAGE_TYPES as readonly string[]).includes(actualMimeType)) {
          throw new ZSAError(
            "INPUT_PARSE_ERROR",
            `Invalid file type: ${actualMimeType}. Allowed types: ${CMS_ALLOWED_IMAGE_TYPES.join(", ")}`
          );
        }

        // Get Cloudflare context
        const { env } = getCloudflareContext();

        if (!env.NEXT_INC_CACHE_R2_BUCKET) {
          throw new ZSAError("INTERNAL_SERVER_ERROR", "R2 bucket not configured");
        }

        // Generate unique filename using the detected extension
        const uniqueFilename = generateUniqueFilename({
          originalFilename: file.name,
          extension: fileExtension,
        });

        // Generate R2 key with collection slug structure
        const r2Key = getCmsImageR2Key({
          collection,
          filename: uniqueFilename,
        });

        // Extract image dimensions (skip for SVG as they don't have fixed dimensions)
        let width: number | undefined;
        let height: number | undefined;

        if (actualMimeType !== "image/svg+xml") {
          try {
            const dimensions = imageSize(Buffer.from(arrayBuffer));
            width = dimensions.width;
            height = dimensions.height;
          } catch (error) {
            // If dimension extraction fails, log it but continue with upload
            console.warn("Failed to extract image dimensions:", error);
          }
        }

        // Upload to R2
        await env.NEXT_INC_CACHE_R2_BUCKET.put(r2Key, arrayBuffer, {
          httpMetadata: {
            contentType: actualMimeType,
            cacheControl: "public, max-age=31536000, immutable",
          },
          customMetadata: {
            originalFilename: file.name,
            uploadedBy: session.user.id,
            uploadedAt: new Date().toISOString(),
            detectedMimeType: actualMimeType,
            collection,
            ...(width && { width: width.toString() }),
            ...(height && { height: height.toString() }),
          },
        });

        // Save media record to database
        const db = getDB();
        const [mediaRecord] = await db.insert(cmsMediaTable).values({
          fileName: file.name,
          mimeType: actualMimeType,
          sizeInBytes: file.size,
          bucketKey: r2Key,
          uploadedBy: session.user.id,
          width,
          height,
        }).returning();

        // Generate public URL
        const publicUrl = getCmsImagePublicUrl(r2Key);

        return {
          success: true,
          url: publicUrl,
          key: r2Key,
          mediaId: mediaRecord.id,
        };
      } catch (error) {
        console.error("Image upload error:", error);

        if (error instanceof ZSAError) {
          throw error;
        }

        throw new ZSAError("INTERNAL_SERVER_ERROR", "Failed to upload image");
      }
    }, RATE_LIMITS.UPLOAD);
  });
