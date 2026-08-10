"use server";

import { prisma } from "@/lib/prisma";
import { recordSubmission } from "@/lib/google";
import type { FormField } from "@/types/form-builder";
import type { SubmitState } from "@/types/submission";

export async function submitFormAction(
  slug: string,
  _prevState: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const form = await prisma.form.findUnique({ where: { slug } });
  if (!form || form.status !== "published") {
    return {
      status: "error",
      message: "This form isn't accepting responses right now.",
    };
  }
  if (!form.googleSheetId || !form.googleDriveFolderId) {
    return {
      status: "error",
      message:
        "This form isn't fully set up yet. Please contact the organizer.",
    };
  }

  const admin = await prisma.admin.findUnique({ where: { id: form.adminId } });
  if (!admin?.googleRefreshToken) {
    return {
      status: "error",
      message:
        "This form isn't fully set up yet. Please contact the organizer.",
    };
  }

  try {
    await recordSubmission({
      refreshToken: admin.googleRefreshToken,
      spreadsheetId: form.googleSheetId,
      formFolderId: form.googleDriveFolderId,
      fields: JSON.parse(form.schema) as FormField[],
      formData,
    });
  } catch (err) {
    console.error("Submission failed:", err);
    return {
      status: "error",
      message: "Something went wrong submitting your response. Please try again.",
    };
  }

  return { status: "success" };
}
