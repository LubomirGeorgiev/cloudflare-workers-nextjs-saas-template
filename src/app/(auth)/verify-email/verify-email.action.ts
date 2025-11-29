"use server";

import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getVerificationTokenKey } from "@/utils/auth-utils";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { updateAllSessionsOfUser } from "@/utils/kv-session";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { verifyEmailSchema } from "@/schemas/verify-email.schema";
import { createServerAction, ZSAError } from "zsa";
import { getSessionFromCookie } from "@/utils/auth";
import isProd from "@/utils/is-prod";

export const verifyEmailAction = createServerAction()
  .input(verifyEmailSchema)
  .handler(async ({ input }) => {
    return withRateLimit(
      async () => {
        const { env } = getCloudflareContext();

        if (!env?.NEXT_INC_CACHE_KV) {
          // In development, try to verify by session as fallback
          if (!isProd) {
            console.warn("⚠️ KV store not available. Attempting development mode fallback...");
            const session = await getSessionFromCookie();
            
            if (session && session.user && !session.user.emailVerified) {
              const db = getDB();
              await db.update(userTable)
                .set({ emailVerified: new Date() })
                .where(eq(userTable.id, session.user.id));
              
              await updateAllSessionsOfUser(session.user.id);
              console.warn("✅ Email verified using development mode fallback");
              return { success: true };
            }
          }
          throw new Error("Can't connect to KV store");
        }

        const tokenKey = getVerificationTokenKey(input.token);
        const verificationTokenStr = await env.NEXT_INC_CACHE_KV.get(tokenKey);

        if (!verificationTokenStr) {
          // In development, provide helpful error message
          if (!isProd) {
            console.error(`❌ Token not found in KV. Key: ${tokenKey}`);
            console.error("💡 Make sure you:");
            console.error("   1. Copied the FULL link from the console (including ?token=...)");
            console.error("   2. Used a FRESH link (click 'Resend verification email' if needed)");
            console.error("   3. The link hasn't expired (tokens expire in 24 hours)");
            
            // Try development fallback
            const session = await getSessionFromCookie();
            if (session && session.user && !session.user.emailVerified) {
              console.warn("⚠️ Attempting development mode fallback...");
              const db = getDB();
              await db.update(userTable)
                .set({ emailVerified: new Date() })
                .where(eq(userTable.id, session.user.id));
              
              await updateAllSessionsOfUser(session.user.id);
              console.warn("✅ Email verified using development mode fallback");
              return { success: true };
            }
          }
          
          throw new ZSAError(
            "NOT_FOUND",
            "Verification token not found or expired. Please request a new verification email."
          );
        }

        const verificationToken = JSON.parse(verificationTokenStr) as {
          userId: string;
          expiresAt: string;
        };

        // Check if token is expired (although KV should have auto-deleted it)
        if (new Date() > new Date(verificationToken.expiresAt)) {
          throw new ZSAError(
            "NOT_FOUND",
            "Verification token not found or expired"
          );
        }

        const db = getDB();

        // Find user
        const user = await db.query.userTable.findFirst({
          where: eq(userTable.id, verificationToken.userId),
        });

        if (!user) {
          throw new ZSAError(
            "NOT_FOUND",
            "User not found"
          );
        }

        try {
          // Update user's email verification status
          await db.update(userTable)
            .set({ emailVerified: new Date() })
            .where(eq(userTable.id, verificationToken.userId));

          // Update all sessions of the user to reflect the new email verification status
          await updateAllSessionsOfUser(verificationToken.userId);

          // Delete the used token
          await env.NEXT_INC_CACHE_KV.delete(getVerificationTokenKey(input.token));

          // Add a small delay to ensure all updates are processed
          await new Promise((resolve) => setTimeout(resolve, 500));

          return { success: true };
        } catch (error) {
          console.error(error);

          throw new ZSAError(
            "INTERNAL_SERVER_ERROR",
            "An unexpected error occurred"
          );
        }
      },
      RATE_LIMITS.EMAIL
    );
  });
