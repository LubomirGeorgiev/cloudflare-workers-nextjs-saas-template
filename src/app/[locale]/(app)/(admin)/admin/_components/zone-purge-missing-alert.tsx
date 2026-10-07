import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EDGE_HTML_CACHE_TTL_MINUTES } from "@/constants/cache-control";

export function ZonePurgeMissingAlert() {
  return (
    <Alert variant="warning">
      <AlertTriangle className="size-4" />
      <AlertTitle>{ZONE_PURGE_MISSING_TITLE}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          Set <code className="font-mono text-xs">CLOUDFLARE_API_TOKEN</code> with the Zone Cache
          Purge permission. The Worker also needs the zone: set{" "}
          <code className="font-mono text-xs">CLOUDFLARE_ZONE_ID</code>, or set{" "}
          <code className="font-mono text-xs">CLOUDFLARE_ACCOUNT_ID</code> and give the token
          Workers Scripts Read so that the Worker can look up the zone.
        </p>
        <p>{ZONE_PURGE_MISSING_EFFECT}</p>
      </AlertDescription>
    </Alert>
  );
}

export const ZONE_PURGE_MISSING_TITLE =
  "The Cloudflare zone purge is not configured";

const ZONE_PURGE_MISSING_EFFECT =
  "Until then, a CMS edit and the Purge Edge HTML Cache action clear the stored HTML pages only " +
  "in the data center that runs them. Other data centers keep serving the old pages until their " +
  `copies expire, within ${EDGE_HTML_CACHE_TTL_MINUTES} minutes. The other purge actions still work.`;
