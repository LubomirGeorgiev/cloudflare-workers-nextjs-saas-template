/**
 * Geometry of the brand mark: three isometric planes cascading up-right on a 32x32 grid, and the
 * one place a fork edits to move the artwork. `src/app/icon.svg`, `src/app/favicon.ico`,
 * `public/logo.svg`, and `public/logo.png` are written from `renderLogoSvg` below by
 * `pnpm logo:generate`, which also stamps `logo-version.ts` next to this file;
 * `tools/logo-assets.test.ts` fails on drift.
 */

export const LOGO_VIEW_BOX = "0 0 32 32"

// Email clients strip SVG, so the transactional templates point an <img> at the generated PNG.
// The box is the tight bounds rounded to whole pixels (45 * 270 / 248 = 48.99); `width`/`height`
// attributes are mandatory there, because Outlook lays the message out before the image arrives.
export const EMAIL_LOGO = { pathname: "/logo.png", width: 49, height: 45 } as const

// Tight bounds of the painted mark. `renderLogoSvg` draws on these instead of the square grid,
// because a standalone file must fill its box (the favicon, where every one of 16 pixels counts).
const LOGO_TIGHT_VIEW_BOX = "2.5 3.6 27 24.8"

// Corner rounding is the stroke, not the path: each plane is stroked with its own fill under
// `stroke-linejoin: round`, so the radius is half this and the painted mark is that much larger
// than the raw path bounds. Changing it rescales the mark, not just its corners.
export const LOGO_STROKE_WIDTH = 1.6

// Back (lowest, shaded) to front (highest, lit) — the gradient runs along the same axis.
export const LOGO_PLANE_PATHS = [
  "M3.3 23.45 9.52 19.28 15.74 23.45 9.52 27.62Z",
  "M9.78 16 16 11.83 22.22 16 16 20.17Z",
  "M16.26 8.55 22.48 4.38 28.7 8.55 22.48 12.72Z",
] as const

// Rebranding the mark is swapping these two stops; the geometry above carries no brand meaning.
// Endpoints match the tight bounds so the ramp spans exactly the artwork and the front plane
// always lands on the lit end.
export const LOGO_GRADIENT = {
  from: "#d95a00", // --edge at its light-theme value, the shaded low end
  to: "#f8962d", // --edge (marketing amber), the lit high end
  x1: 2.5,
  y1: 28.4,
  x2: 29.5,
  y2: 3.6,
} as const

// Fixed, so a page with two marks (nav and footer) holds two elements with this id and every mark
// paints from the first. Left alone on purpose: the gradients are identical, so nothing changes, and
// a unique id needs `useId`, which would make `<Logo>` a client component for no visible gain.
export const LOGO_GRADIENT_ID = "brand-logo-gradient"

/**
 * Serializes the mark as standalone SVG markup, on the tight bounds: the static copies and the
 * OpenGraph card all want the artwork to fill its box, and none of them sit on a backing tile.
 * Pass `size` for a file that needs intrinsic pixels; omit it where CSS sizes the mark.
 */
export function renderLogoSvg({ size }: { size?: { width: number; height: number } } = {}): string {
  const sizeAttributes = size ? ` width="${size.width}" height="${size.height}"` : ""
  const gradientCoordinates = `x1="${LOGO_GRADIENT.x1}" y1="${LOGO_GRADIENT.y1}" x2="${LOGO_GRADIENT.x2}" y2="${LOGO_GRADIENT.y2}"`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"${sizeAttributes} viewBox="${LOGO_TIGHT_VIEW_BOX}" fill="none">`,
    `  <defs>`,
    `    <linearGradient id="${LOGO_GRADIENT_ID}" ${gradientCoordinates} gradientUnits="userSpaceOnUse">`,
    `      <stop offset="0" stop-color="${LOGO_GRADIENT.from}" />`,
    `      <stop offset="1" stop-color="${LOGO_GRADIENT.to}" />`,
    `    </linearGradient>`,
    `  </defs>`,
    `  <g fill="url(#${LOGO_GRADIENT_ID})" stroke="url(#${LOGO_GRADIENT_ID})" stroke-width="${LOGO_STROKE_WIDTH}" stroke-linejoin="round">`,
    ...LOGO_PLANE_PATHS.map((planePath) => `    <path d="${planePath}" />`),
    `  </g>`,
    `</svg>`,
  ].join("\n")
}
