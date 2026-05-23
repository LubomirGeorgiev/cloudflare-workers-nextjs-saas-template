import { emailString, minString, v } from "@/lib/validation";

export const signInSchema = v.object({
  email: emailString("Please enter a valid email address"),
  password: minString(8, "Password must be at least 8 characters"),
});

export type SignInSchema = v.InferOutput<typeof signInSchema>;
