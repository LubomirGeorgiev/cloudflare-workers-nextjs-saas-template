import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@/constants";
import { canonicalEmailString, trimmedString, v } from "@/lib/validation"
import { returnToField } from "@/schemas/fields";
import { captchaSchema } from "./captcha.schema";
import { newPasswordSchema } from "./password.schema";

export const signUpSchema = v.object({
  email: canonicalEmailString(),
  firstName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  lastName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  password: newPasswordSchema,
  captchaToken: captchaSchema,
  returnTo: returnToField(),
})

export type SignUpSchema = v.InferOutput<typeof signUpSchema>
