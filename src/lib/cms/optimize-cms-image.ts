import "server-only";

import { DEFAULT_IMAGE_SIZES, handleImageOptimization } from "vinext/server/image-optimization";
import { CMS_IMAGE_FORMATS, IMAGE_DEVICE_SIZES, type CmsImageFormat } from "@/constants/images";
import { isCmsImageSource } from "@/utils/cms-image-source";

interface OptimizeCmsImageParams {
  request: Request;
  images: ImagesBinding;
  fetchSource: (request: Request) => Promise<Response>;
}

const ALLOWED_WIDTHS = [...IMAGE_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
const DEFAULT_FORMAT: CmsImageFormat = "image/jpeg";

export async function optimizeCmsImage({ request, images, fetchSource }: OptimizeCmsImageParams): Promise<Response> {
  const response = await handleImageOptimization(request, {
    fetchAsset: async (imageUrl) => {
      if (!isCmsImageSource({ source: imageUrl, base: request.url })) {
        return new Response(null, { status: 404 });
      }
      const source = new URL(imageUrl, request.url);
      return fetchSource(new Request(source, { headers: request.headers }));
    },
    transformImage: async (body, { width, format, quality }) => {
      const output = await images.input(body).transform({ width }).output({
        format: toCmsImageFormat(format),
        quality,
      });
      return output.response();
    },
  }, ALLOWED_WIDTHS);

  return request.method === "HEAD" ? new Response(null, response) : response;
}

function toCmsImageFormat(format: string): CmsImageFormat {
  return CMS_IMAGE_FORMATS.find((candidate) => candidate === format) ?? DEFAULT_FORMAT;
}
