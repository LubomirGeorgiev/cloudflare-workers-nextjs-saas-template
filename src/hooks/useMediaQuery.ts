import { useMediaQuery as useMediaQueryHook } from "usehooks-ts"

const tailwindBreakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

const MEDIA_QUERIES = {
  // Single breakpoint queries
  SM_AND_SMALLER: `(max-width: ${tailwindBreakpoints.sm - 1}px)`,
  MD_AND_SMALLER: `(max-width: ${tailwindBreakpoints.md - 1}px)`,
  LG_AND_SMALLER: `(max-width: ${tailwindBreakpoints.lg - 1}px)`,
  XL_AND_SMALLER: `(max-width: ${tailwindBreakpoints.xl - 1}px)`,
  "2XL_AND_SMALLER": `(max-width: ${tailwindBreakpoints["2xl"] - 1}px)`,

  SM_AND_LARGER: `(min-width: ${tailwindBreakpoints.sm}px)`,
  MD_AND_LARGER: `(min-width: ${tailwindBreakpoints.md}px)`,
  LG_AND_LARGER: `(min-width: ${tailwindBreakpoints.lg}px)`,
  XL_AND_LARGER: `(min-width: ${tailwindBreakpoints.xl}px)`,
  "2XL_AND_LARGER": `(min-width: ${tailwindBreakpoints["2xl"]}px)`,

  // Range queries
  SMALLER_THAN_SM: `(max-width: ${tailwindBreakpoints.sm - 1}px)`,
  SM_TO_MD: `(min-width: ${tailwindBreakpoints.sm}px) and (max-width: ${tailwindBreakpoints.md - 1}px)`,
  SM_TO_LG: `(min-width: ${tailwindBreakpoints.sm}px) and (max-width: ${tailwindBreakpoints.lg - 1}px)`,
  SM_TO_XL: `(min-width: ${tailwindBreakpoints.sm}px) and (max-width: ${tailwindBreakpoints.xl - 1}px)`,
  SM_TO_2XL: `(min-width: ${tailwindBreakpoints.sm}px) and (max-width: ${tailwindBreakpoints["2xl"] - 1}px)`,

  MD_TO_LG: `(min-width: ${tailwindBreakpoints.md}px) and (max-width: ${tailwindBreakpoints.lg - 1}px)`,
  MD_TO_XL: `(min-width: ${tailwindBreakpoints.md}px) and (max-width: ${tailwindBreakpoints.xl - 1}px)`,
  MD_TO_2XL: `(min-width: ${tailwindBreakpoints.md}px) and (max-width: ${tailwindBreakpoints["2xl"] - 1}px)`,

  LG_TO_XL: `(min-width: ${tailwindBreakpoints.lg}px) and (max-width: ${tailwindBreakpoints.xl - 1}px)`,
  LG_TO_2XL: `(min-width: ${tailwindBreakpoints.lg}px) and (max-width: ${tailwindBreakpoints["2xl"] - 1}px)`,

  XL_TO_2XL: `(min-width: ${tailwindBreakpoints.xl}px) and (max-width: ${tailwindBreakpoints["2xl"] - 1}px)`,

  // Legacy names (kept for backwards compatibility)
  MOBILE: `(max-width: ${tailwindBreakpoints.sm - 1}px)`,
  TABLET: `(min-width: ${tailwindBreakpoints.sm}px) and (max-width: ${tailwindBreakpoints.lg - 1}px)`,
  DESKTOP: `(min-width: ${tailwindBreakpoints.lg}px)`,
} as const;

type MediaQuery = keyof typeof MEDIA_QUERIES;

export const useMediaQuery = (query: MediaQuery) => {
  return useMediaQueryHook(MEDIA_QUERIES[query], {
    initializeWithValue: false,
  })
}
