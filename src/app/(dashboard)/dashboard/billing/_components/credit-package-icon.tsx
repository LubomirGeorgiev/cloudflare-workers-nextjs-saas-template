import { Coins, Sparkles, Zap } from "lucide-react";

import { CREDIT_PACKAGES } from "@/constants";

export function getCreditPackageIcon(packageId: string) {
  const packageIndex = CREDIT_PACKAGES.findIndex((pkg) => pkg.id === packageId);

  if (packageIndex === 2) return <Zap className="h-6 w-6 text-yellow-500" />;
  if (packageIndex === 1) return <Sparkles className="h-6 w-6 text-blue-500" />;

  return <Coins className="h-6 w-6 text-green-500" />;
}
