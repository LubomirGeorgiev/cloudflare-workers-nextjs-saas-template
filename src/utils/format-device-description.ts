import type { useTranslations } from "@/i18n/client";

import type { ParsedUserAgent } from "@/types";

type DeviceTranslator = ReturnType<typeof useTranslations<"Client.Settings.Device">>;

export function formatDeviceDescription({
  t,
  parsedUserAgent,
}: {
  t: DeviceTranslator;
  parsedUserAgent?: ParsedUserAgent;
}): string {
  const { browser, platform } = selectDeviceParts(parsedUserAgent);

  return t("deviceDescription", {
    browser: browser ?? t("unknownBrowser"),
    platform: platform ?? t("unknownDevice"),
  });
}

// Drops each part the parser did not detect, so a headless or rare agent does not read as a row
// of "Unknown" words. The raw device type is English parser output, so it is not shown.
export function selectDeviceParts(parsedUserAgent?: ParsedUserAgent): {
  browser: string | null;
  platform: string | null;
} {
  // A version means nothing without the name it belongs to.
  const browser = parsedUserAgent?.browser.name
    ? joinKnownParts([parsedUserAgent.browser.name, parsedUserAgent.browser.major])
    : null;
  const device = joinKnownParts([parsedUserAgent?.device.vendor, parsedUserAgent?.device.model]);
  const os = parsedUserAgent?.os.name
    ? joinKnownParts([parsedUserAgent.os.name, parsedUserAgent.os.version])
    : null;
  const platform = device && os ? `${device} (${os})` : (device ?? os);

  return { browser, platform };
}

function joinKnownParts(parts: (string | undefined)[]): string | null {
  const known = parts.map((part) => part?.trim()).filter(Boolean);

  return known.length > 0 ? known.join(" ") : null;
}
