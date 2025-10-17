import { Card, CardContent } from "@/components/ui/card";
import { Coins } from "lucide-react";

export function CreditSystemDisabled() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 px-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="flex justify-center">
            <Coins className="h-16 w-16 text-muted-foreground/50" />
          </div>
          <h2 className="text-2xl font-semibold">Credit System Disabled</h2>
          <p className="text-muted-foreground">
            The credit billing system is currently disabled. All features are available without credit restrictions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
