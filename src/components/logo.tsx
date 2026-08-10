import {
  LOGO_GRADIENT,
  LOGO_GRADIENT_ID,
  LOGO_PLANE_PATHS,
  LOGO_STROKE_WIDTH,
  LOGO_VIEW_BOX,
} from "@/constants/logo";
import { SITE_NAME } from "@/constants";
import { cn } from "@/lib/utils";

export function Logo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={LOGO_VIEW_BOX}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient
          id={LOGO_GRADIENT_ID}
          x1={LOGO_GRADIENT.x1}
          y1={LOGO_GRADIENT.y1}
          x2={LOGO_GRADIENT.x2}
          y2={LOGO_GRADIENT.y2}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={LOGO_GRADIENT.from} />
          <stop offset="1" stopColor={LOGO_GRADIENT.to} />
        </linearGradient>
      </defs>

      <g
        fill={`url(#${LOGO_GRADIENT_ID})`}
        stroke={`url(#${LOGO_GRADIENT_ID})`}
        strokeWidth={LOGO_STROKE_WIDTH}
        strokeLinejoin="round"
      >
        {LOGO_PLANE_PATHS.map((planePath) => (
          <path key={planePath} d={planePath} />
        ))}
      </g>
    </svg>
  );
}

/**
 * Horizontal lockup: mark plus wordmark. The mark is decorative here because the wordmark next to
 * it already names the product to a screen reader.
 */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-bold", className)}>
      <Logo className="h-6 w-6 shrink-0" />
      {SITE_NAME}
    </span>
  );
}
