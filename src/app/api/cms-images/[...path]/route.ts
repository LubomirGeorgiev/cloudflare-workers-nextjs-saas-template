import { getCloudflareContext } from "@/utils/cloudflare-context";
import { NextResponse } from "next/server";
import { CMS_IMAGES_BASE_PATH } from "@/constants";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

/**
 * API route handler to serve CMS images from R2 bucket
 *
 * This route ONLY serves images uploaded through the CMS system.
 * Images must be stored under the CMS_IMAGES_BASE_PATH prefix.
 *
 * Path format: /api/cms-images/cms-images/{collection}/{filename}
 * Example: /api/cms-images/cms-images/blog/cm2x3y4z5-photo.jpg
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return withRateLimit(async () => {
    try {
      const { env } = await getCloudflareContext();

      if (!env.NEXT_INC_CACHE_R2_BUCKET) {
        return NextResponse.json(
          { error: "R2 bucket not configured" },
          { status: 500 }
        );
      }

      // Await params for Next.js 15 compatibility
      const resolvedParams = await params;

      // Reconstruct the full R2 key from the path segments
      const r2Key = resolvedParams.path.join("/");

      if (!r2Key) {
        return NextResponse.json(
          { error: "Invalid image path" },
          { status: 400 }
        );
      }

      // Security: Validate that the path starts with the CMS images base path
      // This prevents accessing arbitrary files in the R2 bucket
      if (!r2Key.startsWith(CMS_IMAGES_BASE_PATH + "/")) {
        console.warn(`Attempted to access non-CMS image: ${r2Key}`);
        return NextResponse.json(
          { error: "Access denied: Not a CMS image" },
          { status: 403 }
        );
      }

      // Security: Prevent path traversal attacks
      if (r2Key.includes("..") || r2Key.includes("//")) {
        console.warn(`Path traversal attempt detected: ${r2Key}`);
        return NextResponse.json(
          { error: "Invalid path" },
          { status: 400 }
        );
      }

      // Validate path structure: cms-images/{collection}/{filename}
      const pathParts = r2Key.split("/");
      if (pathParts.length < 3) {
        return NextResponse.json(
          { error: "Invalid CMS image path structure" },
          { status: 400 }
        );
      }

      // Fetch the object from R2
      const object = await env.NEXT_INC_CACHE_R2_BUCKET.get(r2Key);

      if (!object) {
        return NextResponse.json(
          { error: "Image not found" },
          { status: 404 }
        );
      }

      // Get the content type from the object metadata
      const contentType = object.httpMetadata?.contentType || "application/octet-stream";

      // Additional security: Verify this is actually an image content type
      if (!contentType.startsWith("image/")) {
        console.warn(`Non-image content type detected: ${contentType} for key: ${r2Key}`);
        return NextResponse.json(
          { error: "Invalid content type" },
          { status: 400 }
        );
      }

      // Return the image with proper headers
      return new Response(object.body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "ETag": object.httpEtag || "",
          "Last-Modified": object.uploaded.toUTCString(),
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.error("Error serving CMS image from R2:", error);
      return NextResponse.json(
        { error: "Failed to serve image" },
        { status: 500 }
      );
    }
  }, RATE_LIMITS.CMS_IMAGES_API);
}
