import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ActionError } from "@/lib/action-error";
import { signInSchema } from "@/schemas/signin.schema";
import { signInWithPassword } from "@/app/(auth)/sign-in/sign-in-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = signInSchema.parse(body);
    const result = await signInWithPassword(input);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          message: error.issues[0]?.message ?? "Invalid request",
        },
        { status: 400 }
      );
    }

    if (error instanceof ActionError) {
      const status =
        error.code === "NOT_AUTHORIZED"
          ? 401
          : error.code === "FORBIDDEN"
            ? 403
            : 500;

      return NextResponse.json(
        {
          message: error.message,
        },
        { status }
      );
    }

    console.error("Sign-in route error:", error);

    return NextResponse.json(
      {
        message: "Something went wrong",
      },
      { status: 500 }
    );
  }
}
