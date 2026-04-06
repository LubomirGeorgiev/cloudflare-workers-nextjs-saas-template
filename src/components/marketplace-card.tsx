"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import PurchaseButton from "@/components/purchase-button"
import type { PURCHASABLE_ITEM_TYPE } from "@/db/schema"
import { Badge } from "@/components/ui/badge"
import { COMPONENTS } from "@/app/(dashboard)/dashboard/marketplace/components-catalog"
import { getMarketplaceComponentPreview } from "@/app/(dashboard)/dashboard/marketplace/components-catalog-preview"

interface MarketplaceCardProps {
  id: string
  name: string
  description: string
  credits: number
  containerClass?: string
  isPurchased: boolean
}

const ITEM_TYPE = 'COMPONENT' as const satisfies keyof typeof PURCHASABLE_ITEM_TYPE;

export function MarketplaceCard({ id, name, description, credits, containerClass, isPurchased }: MarketplaceCardProps) {
  const component = COMPONENTS.find(c => c.id === id);
  if (!component) return null;

  const preview = getMarketplaceComponentPreview(component.id)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{name}</CardTitle>
          {isPurchased && (
            <Badge variant="secondary">Purchased</Badge>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center bg-muted/50 p-6">
        <div className={containerClass}>
          {preview}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between mt-4">
        <div className="text-md lg:text-2xl font-bold">{credits} credits</div>
        {!isPurchased && (
          <PurchaseButton
            itemId={id}
            itemType={ITEM_TYPE}
          />
        )}
      </CardFooter>
    </Card>
  )
}
