"use client"

import { forwardRef } from "react"
import { Menu as DropdownMenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/tiptap-utils"
import "@/components/tiptap-ui-primitive/dropdown-menu/dropdown-menu.scss"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root modal={false} {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal {...props} />
}

const DropdownMenuTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ ...props }, ref) => (
  <DropdownMenuPrimitive.Trigger ref={ref} {...props} />
))
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuSub = DropdownMenuPrimitive.SubmenuRoot

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ nativeButton = true, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    nativeButton={nativeButton}
    {...props}
  />
))
DropdownMenuItem.displayName = "DropdownMenuItem"

const DropdownMenuSubTrigger = DropdownMenuPrimitive.SubmenuTrigger

const DropdownMenuSubContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Popup> &
    Pick<
      DropdownMenuPrimitive.Positioner.Props,
      "align" | "alignOffset" | "side" | "sideOffset"
    > & {
    portal?: boolean | React.ComponentProps<typeof DropdownMenuPortal>
  }
>(
  (
    {
      className,
      portal = true,
      align = "start",
      alignOffset = 0,
      side = "right",
      sideOffset = 4,
      ...props
    },
    ref
  ) => {
    const content = (
      <DropdownMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <DropdownMenuPrimitive.Popup
          ref={ref}
          className={cn("tiptap-dropdown-menu", className as string)}
          {...props}
        />
      </DropdownMenuPrimitive.Positioner>
    )

    return (
      <DropdownMenuPortal {...(typeof portal === "object" ? portal : {})}>
        {content}
      </DropdownMenuPortal>
    )
  }
)
DropdownMenuSubContent.displayName = "DropdownMenuSubContent"

const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Popup> &
    Pick<
      DropdownMenuPrimitive.Positioner.Props,
      "align" | "alignOffset" | "side" | "sideOffset"
    > & {
    portal?: boolean | React.ComponentProps<typeof DropdownMenuPortal>
  }
>(
  (
    {
      className,
      sideOffset = 4,
      portal = false,
      align = "start",
      alignOffset = 0,
      side = "bottom",
      onKeyDown,
      ...props
    },
    ref
  ) => {
    const content = (
      <DropdownMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <DropdownMenuPrimitive.Popup
          ref={ref}
          className={cn("tiptap-dropdown-menu", className as string)}
          onKeyDown={onKeyDown}
          {...props}
        />
      </DropdownMenuPrimitive.Positioner>
    )

    return (
      <DropdownMenuPortal {...(typeof portal === "object" ? portal : {})}>
        {content}
      </DropdownMenuPortal>
    )
  }
)
DropdownMenuContent.displayName = "DropdownMenuContent"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
  DropdownMenuGroup,
// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
  DropdownMenuSub,
// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
  DropdownMenuPortal,
// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
  DropdownMenuSubContent,
// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
  DropdownMenuSubTrigger,
// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
  DropdownMenuRadioGroup,
}
