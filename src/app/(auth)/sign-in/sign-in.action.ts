"use server";

import { actionClient } from "@/lib/safe-action";
import { signInSchema } from "@/schemas/signin.schema";

import { signInWithPassword } from "./sign-in-auth";

export const signInAction = actionClient
  .inputSchema(signInSchema)
  .action(async ({ parsedInput: input }) => {
    return signInWithPassword(input);
  });
