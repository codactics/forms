"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createAccessToken, accessCookieName } from "@/lib/access-code";
import type { GateState } from "./gate-state";

export async function submitAccessCode(
  slug: string,
  _prevState: GateState,
  formData: FormData,
): Promise<GateState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { status: "error", message: "Enter both a username and password." };
  }

  const form = await prisma.form.findUnique({ where: { slug } });
  if (!form) {
    return { status: "error", message: "Form not found." };
  }

  const code = await prisma.formAccessCode.findUnique({
    where: { formId_username: { formId: form.id, username } },
  });
  if (!code || !verifyPassword(password, code.passwordHash)) {
    return { status: "error", message: "Incorrect username or password." };
  }

  // Only proves the visitor passed the gate for the submit action's
  // defense-in-depth check below — the page itself never trusts this
  // cookie to skip the gate, so a fresh page load/refresh always asks for
  // credentials again, and the unlock only lasts for the current in-memory
  // client session (see AccessGate).
  const token = createAccessToken(form.id, username);
  const cookieStore = await cookies();
  cookieStore.set(accessCookieName(form.id), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return { status: "success" };
}
