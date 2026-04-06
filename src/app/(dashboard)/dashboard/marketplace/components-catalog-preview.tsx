"use client"

import type { ReactNode, ComponentProps } from "react"
import { Boxes } from "lucide-react"
import { TeamSwitcher } from "@/components/team-switcher"
import ThemeSwitch from "@/components/theme-switch"
import SeparatorWithText from "@/components/separator-with-text"
import { NavUser } from "@/components/nav-user"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"

type Team = ComponentProps<typeof TeamSwitcher>["teams"][number]

const demoTeams: Team[] = [
  {
    id: "acme-inc",
    name: "Acme Inc",
    logo: Boxes,
    role: "admin",
  },
  {
    id: "monsters-inc",
    name: "Monsters Inc",
    logo: Boxes,
    role: "member",
  },
]

const COMPONENT_PREVIEWS: Record<string, () => ReactNode> = {
  "team-switcher": () => {
    const teams = demoTeams.map(team => ({
      ...team,
      logo: Boxes,
    }))

    return <TeamSwitcher teams={teams} />
  },
  "theme-switch": () => <ThemeSwitch />,
  "separator-with-text": () => (
    <SeparatorWithText>
      <span className="text-muted-foreground">OR</span>
    </SeparatorWithText>
  ),
  "nav-user": () => <NavUser />,
  "page-header": () => (
    <PageHeader
      items={[
        { href: "/dashboard", label: "Dashboard" },
        { href: "/dashboard/settings", label: "Settings" },
      ]}
    />
  ),
  button: () => <Button>Click me</Button>,
}

export function getMarketplaceComponentPreview(componentId: string) {
  return COMPONENT_PREVIEWS[componentId]?.() ?? null
}
