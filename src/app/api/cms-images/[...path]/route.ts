import { getCloudflareContext } from "@/utils/cloudflare-context";
import { NextResponse } from "next/server";
import { CMS_IMAGES_BASE_PATH } from "@/constants";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

// Only serves R2 objects uploaded through the CMS under CMS_IMAGES_BASE_PATH.
// Path format: /api/cms-images/cms-images/{collection}/{filename}.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return withRateLimit(async () => {
    try {
      const { env } = await getCloudflareContext();

      if (!env.R2_BUCKET) {
        return NextResponse.json(
          { error: "R2 bucket not configured" },
          { status: 500 }
        );
      }

      const resolvedParams = await params;

      const r2Key = resolvedParams.path.join("/");

      if (!r2Key) {
        return NextResponse.json(
          { error: "Invalid image path" },
          { status: 400 }
        );
      }

      // Prevent arbitrary R2 reads outside the CMS image prefix.
      if (!r2Key.startsWith(CMS_IMAGES_BASE_PATH + "/")) {
        console.warn(`Attempted to access non-CMS image: ${r2Key}`);
        return NextResponse.json(
          { error: "Access denied: Not a CMS image" },
          { status: 403 }
        );
      }

      if (r2Key.includes("..") || r2Key.includes("//")) {
        console.warn(`Path traversal attempt detected: ${r2Key}`);
        return NextResponse.json(
          { error: "Invalid path" },
          { status: 400 }
        );
      }

      const pathParts = r2Key.split("/");
      if (pathParts.length < 3) {
        return NextResponse.json(
          { error: "Invalid CMS image path structure" },
          { status: 400 }
        );
      }

      const object = await env.R2_BUCKET.get(r2Key);

      if (!object) {
        return NextResponse.json(
          { error: "Image not found" },
          { status: 404 }
        );
      }

      const contentType = object.httpMetadata?.contentType || "application/octet-stream";

      if (!contentType.startsWith("image/")) {
        console.warn(`Non-image content type detected: ${contentType} for key: ${r2Key}`);
        return NextResponse.json(
          { error: "Invalid content type" },
          { status: 400 }
        );
      }

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
