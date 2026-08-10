import "server-only"

import { ImageResponse } from "next/og"

import {
  OG_DESCRIPTION_MAX_LENGTH,
  OG_EYEBROW_MAX_LENGTH,
  OG_IMAGE_CACHE_CONTROL,
  OG_IMAGE_SIZE,
  OG_META_MAX_LENGTH,
  OG_TITLE_MAX_LENGTH,
} from "@/constants/og-image"
import { renderLogoSvg } from "@/constants/logo"
import { SITE_DOMAIN, SITE_NAME } from "@/constants"

// The card rides on the Noto Sans regular that @vercel/og already inlines — no webfont is shipped,
// matching the app's own system-font stack. That font has a single weight, so satori cannot render
// bold: hierarchy here comes from scale, color, and the amber accents, never `fontWeight`.
const FONT_FAMILY = "sans-serif"

// Literal hex mirrors of the dark-theme tokens in globals.css. satori resolves neither CSS variables
// nor oklch(), so the values live here — keep in sync with the `.dark` block.
const COLORS = {
  background: "#0c0a09", // --background
  foreground: "#fafaf9", // --foreground
  muted: "#a6a09b", // --muted-foreground
  edge: "#f8962d", // --edge (marketing amber)
  edgeDeep: "#d95a00", // light-theme --edge, used as the gradient's far end
  hairline: "rgba(255, 255, 255, 0.10)", // --border
  panel: "rgba(255, 255, 255, 0.04)",
} as const

// satori draws no SVG children of its own — an inline <svg> renders as nothing at all — so the
// brand mark ships as an <img> data URI. Base64 rather than percent-encoding, because the gradient
// stops contain `#`, which terminates a data URI early.
const LOGO_DATA_URI = `data:image/svg+xml;base64,${btoa(renderLogoSvg())}`

// Matches the 56px `bg-grid` utility on the marketing surfaces, so a shared card reads as the same
// product as the page it links to. Drawn as explicit 1px divs because satori does not tile a
// background-image gradient across background-size — that silently renders nothing.
const GRID_CELL_PX = 56
const GRID_LINE_COLOR = "rgba(255, 255, 255, 0.06)"

// Title steps down as the string grows so a long CMS headline still fits three lines.
const TITLE_SIZE_STEPS = [
  { maxLength: 32, fontSize: 76 },
  { maxLength: 58, fontSize: 64 },
  { maxLength: 82, fontSize: 54 },
] as const
const TITLE_MIN_FONT_SIZE = 46

// satori ignores the `inset` shorthand — an element positioned with it renders nothing at all.
const ABSOLUTE_FILL = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
} as const

interface OgImageOptions {
  title: string
  description?: string
  // Small uppercase kicker naming the section ("Blog", "Documentation", ...).
  eyebrow?: string
  // Right-aligned footer detail — a date, an author, a reading time.
  meta?: string
}

// Truncates on a word boundary when one is close enough, so cards never cut mid-word.
function truncate(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim()
  if (collapsed.length <= maxLength) {
    return collapsed
  }

  const clipped = collapsed.slice(0, maxLength - 1)
  const lastSpace = clipped.lastIndexOf(" ")
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

function getTitleFontSize(title: string): number {
  return (
    TITLE_SIZE_STEPS.find((step) => title.length <= step.maxLength)?.fontSize ?? TITLE_MIN_FONT_SIZE
  )
}

function GridBackdrop() {
  const columns = Math.ceil(OG_IMAGE_SIZE.width / GRID_CELL_PX)
  const rows = Math.ceil(OG_IMAGE_SIZE.height / GRID_CELL_PX)

  return (
    <div style={{ ...ABSOLUTE_FILL, display: "flex" }}>
      {Array.from({ length: columns - 1 }, (_, index) => (
        <div
          key={`column-${index}`}
          style={{
            position: "absolute",
            top: 0,
            left: (index + 1) * GRID_CELL_PX,
            width: 1,
            height: OG_IMAGE_SIZE.height,
            backgroundColor: GRID_LINE_COLOR,
          }}
        />
      ))}
      {Array.from({ length: rows - 1 }, (_, index) => (
        <div
          key={`row-${index}`}
          style={{
            position: "absolute",
            left: 0,
            top: (index + 1) * GRID_CELL_PX,
            width: OG_IMAGE_SIZE.width,
            height: 1,
            backgroundColor: GRID_LINE_COLOR,
          }}
        />
      ))}
    </div>
  )
}

export function renderOgImage({ title, description, eyebrow, meta }: OgImageOptions): ImageResponse {
  const resolvedTitle = truncate(title || SITE_NAME, OG_TITLE_MAX_LENGTH)
  const resolvedDescription = description
    ? truncate(description, OG_DESCRIPTION_MAX_LENGTH)
    : undefined
  const resolvedEyebrow = eyebrow ? truncate(eyebrow, OG_EYEBROW_MAX_LENGTH) : undefined
  const resolvedMeta = meta ? truncate(meta, OG_META_MAX_LENGTH) : undefined

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          backgroundColor: COLORS.background,
          color: COLORS.foreground,
          fontFamily: FONT_FAMILY,
        }}
      >
        <GridBackdrop />

        {/* Warm wash off the top-right corner. Linear, not radial: satori renders radial-gradient
            stops inverted, which reads as a dark blob instead of a glow. */}
        <div
          style={{
            ...ABSOLUTE_FILL,
            display: "flex",
            backgroundImage: `linear-gradient(215deg, rgba(248, 150, 45, 0.22), rgba(248, 150, 45, 0.05) 32%, rgba(248, 150, 45, 0) 58%)`,
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "64px 72px 58px 72px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {/* oxlint-disable-next-line nextjs/no-img-element -- satori renders its own image element; next/image has no meaning here. */}
              <img src={LOGO_DATA_URI} width={58} height={53} alt="" />
              <div
                style={{
                  marginLeft: 20,
                  fontSize: 29,
                  letterSpacing: "-0.02em",
                }}
              >
                {SITE_NAME}
              </div>
            </div>

            {resolvedEyebrow ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "11px 24px 11px 19px",
                  borderRadius: 999,
                  border: `1px solid ${COLORS.hairline}`,
                  backgroundColor: COLORS.panel,
                  fontSize: 19,
                  letterSpacing: "0.16em",
                }}
              >
                <div
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    marginRight: 14,
                    backgroundColor: COLORS.edge,
                  }}
                />
                {resolvedEyebrow.toUpperCase()}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                width: 74,
                height: 5,
                borderRadius: 999,
                marginBottom: 32,
                backgroundColor: COLORS.edge,
              }}
            />
            <div
              style={{
                display: "flex",
                maxWidth: 1000,
                fontSize: getTitleFontSize(resolvedTitle),
                lineHeight: 1.08,
                letterSpacing: "-0.038em",
              }}
            >
              {resolvedTitle}
            </div>
            {resolvedDescription ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 24,
                  maxWidth: 880,
                  fontSize: 26,
                  lineHeight: 1.45,
                  color: COLORS.muted,
                }}
              >
                {resolvedDescription}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 28,
              borderTop: `1px solid ${COLORS.hairline}`,
              fontSize: 22,
              color: COLORS.muted,
            }}
          >
            <div style={{ display: "flex" }}>{SITE_DOMAIN}</div>
            {resolvedMeta ? <div style={{ display: "flex" }}>{resolvedMeta}</div> : null}
          </div>
        </div>

        {/* Bottom edge bar — the one element that stays legible at thumbnail size. */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            height: 8,
            display: "flex",
            backgroundImage: `linear-gradient(to right, ${COLORS.edge}, ${COLORS.edgeDeep} 42%, rgba(217, 90, 0, 0))`,
          }}
        />
      </div>
    ),
    {
      ...OG_IMAGE_SIZE,
      headers: { "cache-control": OG_IMAGE_CACHE_CONTROL },
    },
  )
}
