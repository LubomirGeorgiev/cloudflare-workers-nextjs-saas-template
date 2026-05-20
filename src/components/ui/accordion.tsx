"use client"

import * as React from "react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

type AccordionValue = string | string[]

interface AccordionProps
  extends Omit<
    AccordionPrimitive.Root.Props<string>,
    "defaultValue" | "multiple" | "onValueChange" | "value"
  > {
  collapsible?: boolean
  defaultValue?: AccordionValue
  onValueChange?: (value: AccordionValue) => void
  type?: "single" | "multiple"
  value?: AccordionValue
}

function toAccordionArray(value: AccordionValue | undefined) {
  if (value === undefined) {
    return undefined
  }

  return Array.isArray(value) ? value : [value]
}

function Accordion({
  collapsible: __collapsible,
  defaultValue,
  onValueChange,
  type = "single",
  value,
  ...props
}: AccordionProps) {
  const isMultiple = type === "multiple"

  return (
    <AccordionPrimitive.Root
      multiple={isMultiple}
      defaultValue={toAccordionArray(defaultValue)}
      value={toAccordionArray(value)}
      onValueChange={(nextValue) => {
        onValueChange?.(isMultiple ? nextValue : nextValue[0] ?? "")
      }}
      {...props}
    />
  )
}

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("border-b", className)}
    {...props}
  />
))
AccordionItem.displayName = "AccordionItem"

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-panel-open]>svg]:rotate-180",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
))
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Panel>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Panel>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Panel
    ref={ref}
    className="overflow-hidden text-sm"
    {...props}
  >
    <div className={cn("pb-4 pt-0", className)}>{children}</div>
  </AccordionPrimitive.Panel>
))

AccordionContent.displayName = "AccordionContent"

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
