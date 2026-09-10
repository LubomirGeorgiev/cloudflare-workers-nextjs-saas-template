"use client";

import { BadgeCheck, ShieldQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * Whether anyone vouched for the OAuth client behind a grant. Shared because the answer must look
 * the same to the person who approved it and to the admin reviewing it — the label differs per
 * surface, the mark must not.
 */
export function ClientVerificationBadge({
  isVerified,
  label,
}: {
  isVerified: boolean;
  label: string;
}) {
  return (
    <Badge variant={isVerified ? "default" : "secondary"} className="gap-1">
      {isVerified ? <BadgeCheck className="size-3.5" /> : <ShieldQuestion className="size-3.5" />}
      {label}
    </Badge>
  );
}
