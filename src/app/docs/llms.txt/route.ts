import { LLMS_TXT_PATH, SITE_URL } from "@/constants";

export function GET() {
  return Response.redirect(`${SITE_URL}${LLMS_TXT_PATH}`, 301);
}
