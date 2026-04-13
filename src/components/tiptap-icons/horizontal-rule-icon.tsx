import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const HorizontalRuleIcon = memo(({ className, ...props }: SvgProps) => {
  return (
    <svg
      width="24"
      height="24"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M3 12H21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
})

HorizontalRuleIcon.displayName = "HorizontalRuleIcon"
