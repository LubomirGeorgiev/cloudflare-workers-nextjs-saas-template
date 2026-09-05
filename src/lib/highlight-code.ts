import type { RootContent } from "hast";
import { sharedLowlight } from "@/lib/lowlight";

export function highlightCode({ code, language }: { code: string; language?: string }): RootContent[] {
  if (typeof language === "string" && language && sharedLowlight.registered(language)) {
    try {
      return sharedLowlight.highlight(language, code).children;
    } catch {
      // An invalid language input must not hide the source text.
    }
  }
  return [{ type: "text", value: code }];
}
