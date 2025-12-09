import "server-only";

import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import { getDB } from "@/db";
import { passKeyCredentialTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PasskeysList } from "./passkey.client";
import { UAParser } from "ua-parser-js";
import type { PassKeyCredential } from "@/db/schema";
import type { ParsedUserAgent } from "@/types";

interface ParsedPasskey extends Omit<PassKeyCredential, 'userAgent'> {
  userAgent: string | null;
  parsedUserAgent: ParsedUserAgent;
}

export default async function SecurityPage() {
  const session = await getSessionFromCookie();

  if (!session) {
    return redirect("/sign-in");
  }

  const db = getDB();
  const passkeys = await db
    .select()
    .from(passKeyCredentialTable)
    .where(eq(passKeyCredentialTable.userId, session.user.id));

  // Parse user agent for each passkey
  const passkeysWithParsedUA = passkeys.map((passkey: PassKeyCredential): ParsedPasskey => {
    // Since userAgent is text() in the schema, it can be null or undefined
    // Convert undefined to null to match our Passkey interface
    const userAgent = passkey.userAgent ?? null;
    const result = new UAParser(userAgent ?? '').getResult();
    const passkeyWithParsedUA = {
      ...passkey,
      userAgent: userAgent ?? null,
      parsedUserAgent: {
        ua: userAgent ?? '',
        browser: {
          name: result.browser.name,
          version: result.browser.version,
          major: result.browser.major
        },
        device: {
          model: result.device.model,
          type: result.device.type,
          vendor: result.device.vendor
        },
        engine: {
          name: result.engine.name,
          version: result.engine.version
        },
        os: {
          name: result.os.name,
          version: result.os.version
        }
      }
    };
    return passkeyWithParsedUA;
  });

  return (
    <PasskeysList
      passkeys={passkeysWithParsedUA}
      currentPasskeyId={session.passkeyCredentialId ?? null}
      email={session.user.email}
    />
  )
}
