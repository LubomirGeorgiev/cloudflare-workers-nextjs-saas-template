import type { useTranslations } from "next-intl";

import type { ParsedUserAgent } from "@/types";

type DeviceTranslator = ReturnType<typeof useTranslations<"Client.Settings.Device">>;

export function formatDeviceDescription({
  t,
  parsedUserAgent,
}: {
  t: DeviceTranslator;
  parsedUserAgent?: ParsedUserAgent;
}): string {
  return t("deviceDescription", {
    browserName: parsedUserAgent?.browser.name ?? t("unknownBrowser"),
    browserVersion: parsedUserAgent?.browser.major ?? t("unknownVersion"),
    deviceVendor: parsedUserAgent?.device.vendor ?? t("unknownDevice"),
    deviceModel: parsedUserAgent?.device.model ?? t("unknownModel"),
    deviceType: parsedUserAgent?.device.type ?? t("unknownType"),
    osName: parsedUserAgent?.os.name ?? t("unknownOs"),
    osVersion: parsedUserAgent?.os.version ?? t("unknownVersion"),
  });
}
