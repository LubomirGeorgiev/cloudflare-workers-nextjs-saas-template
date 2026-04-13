import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const TableColumnPlusIcon = memo(({ className, ...props }: SvgProps) => {
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
      <rect
        x="5"
        y="3"
        width="14"
        height="13"
        rx="1"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="12"
        y1="3"
        x2="12"
        y2="16"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="19"
        r="3"
        fill="currentColor"
      />
      <line
        x1="12"
        y1="17.5"
        x2="12"
        y2="20.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="10.5"
        y1="19"
        x2="13.5"
        y2="19"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
})

TableColumnPlusIcon.displayName = "TableColumnPlusIcon"
