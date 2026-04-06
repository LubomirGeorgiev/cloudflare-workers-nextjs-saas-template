export interface MarketplaceComponent {
  id: string
  name: string
  description: string
  credits: number
  containerClass?: string
}

export const COMPONENTS: MarketplaceComponent[] = [
  {
    id: "team-switcher",
    name: "Team Switcher",
    description: "A sleek dropdown menu for switching between teams with custom logos and plans",
    credits: 4,
    containerClass: "w-[300px]",
  },
  {
    id: "theme-switch",
    name: "Theme Switch",
    description: "An animated theme switcher with system, light, and dark mode options",
    credits: 4,
  },
  {
    id: "separator-with-text",
    name: "Separator With Text",
    description: "A clean separator component with customizable text and styling",
    credits: 3,
    containerClass: "w-full",
  },
  {
    id: "nav-user",
    name: "User Navigation Dropdown",
    description: "A professional user navigation dropdown with avatar, user info, and action items",
    credits: 10,
    containerClass: "w-[300px]",
  },
  {
    id: "page-header",
    name: "Page Header with Breadcrumbs",
    description: "A responsive page header with collapsible sidebar trigger and breadcrumb navigation",
    credits: 12,
    containerClass: "w-full",
  },
  {
    id: 'button',
    name: "Button",
    description: "A button component with customizable text and styling",
    credits: 8,
    containerClass: "w-full flex justify-center",
  }
]
