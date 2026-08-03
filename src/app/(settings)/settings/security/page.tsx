import "server-only";

import { getCurrentSession } from "@/utils/auth";
import { redirectToSignIn } from "@/utils/auth-redirect";
import { getDB } from "@/db";
import { passKeyCredentialTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PasskeysList } from "./passkey.client";
import { parseUserAgent } from "@/utils/parse-user-agent";
import type { PassKeyCredential } from "@/db/schema";
import type { ParsedUserAgent } from "@/types";

interface ParsedPasskey extends Omit<PassKeyCredential, 'userAgent'> {
  userAgent: string | null;
  parsedUserAgent: ParsedUserAgent;
}

export default async function SecurityPage() {
  const session = await getCurrentSession();

  if (!session) {
    return redirectToSignIn();
  }

  const db = getDB();
  const passkeys = await db
    .select()
    .from(passKeyCredentialTable)
    .where(eq(passKeyCredentialTable.userId, session.user.id));

  const passkeysWithParsedUA = passkeys.map((passkey: PassKeyCredential): ParsedPasskey => {
    // Since userAgent is text() in the schema, it can be null or undefined
    // Convert undefined to null to match our Passkey interface
    const userAgent = passkey.userAgent ?? null;

    return {
      ...passkey,
      userAgent,
      parsedUserAgent: parseUserAgent(userAgent),
    };
  });

  return (
    <PasskeysList
      passkeys={passkeysWithParsedUA}
      currentPasskeyId={session.passkeyCredentialId ?? null}
      email={session.user.email}
    />
  )
}
