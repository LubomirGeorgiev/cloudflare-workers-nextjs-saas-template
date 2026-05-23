import { minString, v } from "@/lib/validation";

export const resetPasswordSchema = v.pipe(
  v.object({
    token: v.string(),
    password: minString(8, "Password must be at least 8 characters"),
    confirmPassword: v.string(),
  }),
  v.forward(
    v.partialCheck(
      [["password"], ["confirmPassword"]],
      (data) => data.password === data.confirmPassword,
      "Passwords do not match"
    ),
    ["confirmPassword"]
  )
);

export type ResetPasswordSchema = v.InferOutput<typeof resetPasswordSchema>;
