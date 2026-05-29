"use client"

import { ChevronRight } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import Link from "next/link"
import type { Route } from "next"
import type { NavMainItem } from "./app-sidebar-data"

type Props = {
  items: NavMainItem[]
}

export function NavMain({
  items,
}: Props) {
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          // If there are no child items, render a direct link
          if (!item.items?.length) {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  render={
                    <Link
                      href={item.url as Route}
                      prefetch={false}
                      onClick={() => setOpenMobile(false)}
                    />
                  }
                >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          }

          // Otherwise render the collapsible menu
          return (
            <Collapsible
              key={item.title}
              render={<SidebarMenuItem />}
              defaultOpen={item.isActive}
              className="group/collapsible"
            >
                <CollapsibleTrigger
                  render={<SidebarMenuButton tooltip={item.title} />}
                >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          render={
                            subItem.url.startsWith('/') ? (
                              <Link
                                href={subItem.url as Route}
                                prefetch={false}
                                onClick={() => setOpenMobile(false)}
                              />
                            ) : (
                              <a
                                href={subItem.url}
                                onClick={() => setOpenMobile(false)}
                              />
                            )
                          }
                        >
                              <span>{subItem.title}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
            </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
