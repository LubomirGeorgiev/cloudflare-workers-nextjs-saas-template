"use client"

import { toast } from "sonner"
import ShinyButton from "@/components/ui/shiny-button"
import { useAction } from "next-safe-action/hooks"
import { purchaseAction } from "@/app/(dashboard)/dashboard/marketplace/purchase.action"
import type { PURCHASABLE_ITEM_TYPE } from "@/db/schema"
import { useRouter } from "next/navigation"

interface PurchaseButtonProps {
  itemId: string
  itemType: keyof typeof PURCHASABLE_ITEM_TYPE
}

export default function PurchaseButton({ itemId, itemType }: PurchaseButtonProps) {
  const router = useRouter()

  const { executeAsync: handlePurchase, isExecuting } = useAction(purchaseAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Failed to purchase item")
    },
    onExecute: () => {
      toast.loading("Processing purchase...")
    },
    onSuccess: () => {
      toast.dismiss()
      toast.success("Item purchased successfully!")
      router.refresh()
    },
  })

  return (
    <ShinyButton
      onClick={() => {
        void handlePurchase({ itemId, itemType })
      }}
    >
      {isExecuting ? "Processing..." : "Purchase"}
    </ShinyButton>
  )
}
