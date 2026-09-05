export const IMAGE_DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
export const CMS_IMAGE_SIZES = "(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px";
export const CMS_IMAGE_QUALITY = 80;

// Smallest device width that still fills the 1200px slot `CMS_IMAGE_SIZES` caps the image at.
// A client that ignores `srcset` would otherwise download the 3840px render of every CMS image.
export const CMS_IMAGE_FALLBACK_WIDTH = 1200;

// Vinext types the negotiated output format as a plain string, but only ever emits these three.
export const CMS_IMAGE_FORMATS = ["image/avif", "image/webp", "image/jpeg"] as const;
export type CmsImageFormat = (typeof CMS_IMAGE_FORMATS)[number];
