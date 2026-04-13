import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const TableRowPlusIcon = memo(({ className, ...props }: SvgProps) => {
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
        x="3"
        y="5"
        width="13"
        height="14"
        rx="1"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="3"
        y1="12"
        x2="16"
        y2="12"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="19"
        cy="12"
        r="3"
        fill="currentColor"
      />
      <line
        x1="19"
        y1="10.5"
        x2="19"
        y2="13.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="17.5"
        y1="12"
        x2="20.5"
        y2="12"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
})

TableRowPlusIcon.displayName = "TableRowPlusIcon"
