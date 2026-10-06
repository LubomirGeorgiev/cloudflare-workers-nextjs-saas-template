import "server-only";

import { DEFAULT_IMAGE_SIZES, handleImageOptimization } from "vinext/server/image-optimization";
import { CMS_IMAGE_CACHE_CONTROL } from "@/constants/cache-control";
import { CMS_IMAGE_FORMATS, IMAGE_DEVICE_SIZES, type CmsImageFormat } from "@/constants/images";
import { isCmsImageSource } from "@/utils/cms-image-source";

interface OptimizeCmsImageParams {
  request: Request;
  images: ImagesBinding;
  fetchSource: (request: Request) => Promise<Response>;
}

const ALLOWED_WIDTHS = [...IMAGE_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
const DEFAULT_FORMAT: CmsImageFormat = "image/jpeg";
const CACHE_TAG_HEADER = "Cache-Tag";

export async function optimizeCmsImage({ request, images, fetchSource }: OptimizeCmsImageParams): Promise<Response> {
  let sourceCacheTag: string | null = null;
  const response = await handleImageOptimization(request, {
    fetchAsset: async (imageUrl) => {
      if (!isCmsImageSource({ source: imageUrl, base: request.url })) {
        return new Response(null, { status: 404 });
      }
      const source = await fetchSource(new Request(new URL(imageUrl, request.url), { headers: request.headers }));
      sourceCacheTag = source.headers.get(CACHE_TAG_HEADER);
      return source;
    },
    transformImage: async (body, { width, format, quality }) => {
      const output = await images.input(body).transform({ width }).output({
        format: toCmsImageFormat(format),
        quality,
      });
      return output.response();
    },
  }, ALLOWED_WIDTHS);

  // Vinext stamps a one-year policy and drops the source tag, so a media delete could not purge
  // the resized copies. Give them the source route's policy and tag.
  if (response.ok) {
    response.headers.set("Cache-Control", CMS_IMAGE_CACHE_CONTROL);
    if (sourceCacheTag) {
      response.headers.set(CACHE_TAG_HEADER, sourceCacheTag);
    }
  }

  return request.method === "HEAD" ? new Response(null, response) : response;
}

function toCmsImageFormat(format: string): CmsImageFormat {
  return CMS_IMAGE_FORMATS.find((candidate) => candidate === format) ?? DEFAULT_FORMAT;
}
