"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { type Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent } from "@/components/ui/dialog"

const Command = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <ComboboxPrimitive.Root>
    <div
      ref={ref}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className
      )}
      {...props}
    />
  </ComboboxPrimitive.Root>
))
Command.displayName = "Command"

const CommandDialog = ({
  children,
  ...props
}: Omit<DialogPrimitive.Root.Props, "children"> & {
  children?: React.ReactNode
}) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[data-command-group-heading]]:px-2 [&_[data-command-group-heading]]:font-medium [&_[data-command-group-heading]]:text-muted-foreground [&_[data-command-group]:not([hidden])_~[data-command-group]]:pt-0 [&_[data-command-group]]:px-2 [&_[data-command-input-wrapper]_svg]:h-5 [&_[data-command-input-wrapper]_svg]:w-5 [&_[data-command-input]]:h-12 [&_[data-command-item]]:px-2 [&_[data-command-item]]:py-3 [&_[data-command-item]_svg]:h-5 [&_[data-command-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

interface CommandInputProps
  extends Omit<ComboboxPrimitive.Input.Props, "onChange"> {
  onChange?: React.ChangeEventHandler<HTMLInputElement>
  onValueChange?: (value: string) => void
}

const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(
  ({ className, onChange, onValueChange, ...props }, ref) => (
    <div className="flex items-center border-b px-3" data-command-input-wrapper="">
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <ComboboxPrimitive.Input
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        data-command-input=""
        onChange={(event) => {
          onChange?.(event)
          onValueChange?.(event.currentTarget.value)
        }}
        {...props}
      />
    </div>
  )
)
CommandInput.displayName = "CommandInput"

interface CommandItemProps
  extends Omit<ComboboxPrimitive.Item.Props, "onSelect"> {
  onSelect?: (value: string) => void
  value?: string
}

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(
  ({ className, onClick, onSelect, value, ...props }, ref) => (
    <ComboboxPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      data-command-item=""
      value={value}
      onClick={(event) => {
        onClick?.(event)

        if (!event.defaultPrevented) {
          onSelect?.(value ?? event.currentTarget.textContent ?? "")
        }
      }}
      {...props}
    />
  )
)
CommandItem.displayName = "CommandItem"

interface CommandListProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.List>, "children"> {
  children?: React.ReactNode
}

const CommandList = React.forwardRef<
  React.ElementRef<typeof ComboboxPrimitive.List>,
  CommandListProps
>(({ className, children, ...props }, ref) => {
  const hasItems = hasCommandItems(children)

  return (
    <ComboboxPrimitive.List
      ref={ref}
      className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
      {...props}
    >
      {renderCommandListChildren(children, hasItems)}
    </ComboboxPrimitive.List>
  )
})
CommandList.displayName = "CommandList"

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof ComboboxPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Empty>
>(({ hidden, ...props }, ref) => (
  <ComboboxPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    hidden={hidden}
    {...props}
  />
))
CommandEmpty.displayName = "CommandEmpty"

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof ComboboxPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Group> & {
    heading?: React.ReactNode
  }
>(({ className, children, heading, ...props }, ref) => (
  <ComboboxPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[data-command-group-heading]]:px-2 [&_[data-command-group-heading]]:py-1.5 [&_[data-command-group-heading]]:text-xs [&_[data-command-group-heading]]:font-medium [&_[data-command-group-heading]]:text-muted-foreground",
      className
    )}
    data-command-group=""
    {...props}
  >
    {heading ? (
      <ComboboxPrimitive.GroupLabel data-command-group-heading="">
        {heading}
      </ComboboxPrimitive.GroupLabel>
    ) : null}
    {children}
  </ComboboxPrimitive.Group>
))
CommandGroup.displayName = "CommandGroup"

const CommandSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
))
CommandSeparator.displayName = "CommandSeparator"

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
CommandShortcut.displayName = "CommandShortcut"

function hasCommandItems(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) {
      return false
    }

    if (child.type === CommandItem) {
      return true
    }

    return hasCommandItems(
      (child as React.ReactElement<{ children?: React.ReactNode }>).props
        .children
    )
  })
}

function renderCommandListChildren(children: React.ReactNode, hasItems: boolean) {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) {
      return child
    }

    if (child.type === CommandEmpty && hasItems) {
      return React.cloneElement(
        child as React.ReactElement<{ hidden?: boolean }>,
        { hidden: true }
      )
    }

    return child
  })
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
// oxlint-disable-next-line project/no-unused-module-exports -- Shadcn/Radix modules intentionally expose optional composition slots.
  CommandShortcut,
  CommandSeparator,
}
