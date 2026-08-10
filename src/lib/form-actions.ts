"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { publishFormToGoogle, syncSheetColumns } from "@/lib/google";
import { slugify } from "@/lib/slug";
import { generateUniqueTitle } from "@/lib/form-naming";
import { MAX_DRAFTS_PER_ADMIN, MAX_PUBLISHED_PER_ADMIN } from "@/lib/form-limits";
import type { FormField } from "@/types/form-builder";
import { DEFAULT_THEME, type FormTheme } from "@/types/theme";

async function uniqueSlugFor(title: string, excludeFormId?: string) {
  const base = slugify(title);
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.form.findUnique({ where: { slug } });
    if (!clash || clash.id === excludeFormId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

export type CreateDraftResult =
  | { ok: true; formId: string; title: string }
  | { ok: false; error: "not-signed-in" | "draft-limit" };

export async function createDraft(): Promise<CreateDraftResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const draftCount = await prisma.form.count({
    where: { adminId: session.user.id, status: "draft" },
  });
  if (draftCount >= MAX_DRAFTS_PER_ADMIN) {
    return { ok: false, error: "draft-limit" };
  }

  const title = await generateUniqueTitle(session.user.id, "Untitled");
  const slug = await uniqueSlugFor(title);

  const form = await prisma.form.create({
    data: {
      adminId: session.user.id,
      slug,
      title,
      status: "draft",
      schema: JSON.stringify([]),
      theme: JSON.stringify(DEFAULT_THEME),
    },
  });

  return { ok: true, formId: form.id, title: form.title };
}

export type UpdateDraftResult =
  | { ok: true; title: string }
  | { ok: false; error: "not-signed-in" | "not-found" };

export async function updateDraft(
  formId: string,
  input: { title: string; fields: FormField[]; theme: FormTheme },
): Promise<UpdateDraftResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const existing = await prisma.form.findUnique({ where: { id: formId } });
  if (!existing || existing.adminId !== session.user.id) {
    return { ok: false, error: "not-found" };
  }

  const rawTitle = input.title.trim() || "Untitled";
  const title = await generateUniqueTitle(session.user.id, rawTitle, formId);

  await prisma.form.update({
    where: { id: formId },
    data: {
      title,
      schema: JSON.stringify(input.fields),
      theme: JSON.stringify(input.theme),
    },
  });

  return { ok: true, title };
}

export type TitleAvailability =
  | { taken: false }
  | { taken: true; status: string };

// Real-time check used by the Design step so the admin sees a warning the
// moment they type a name that collides with one of their own forms —
// separate from (and purely informational alongside) the actual
// auto-suffixing that happens for real when the form is saved/published.
export async function checkTitleAvailability(
  title: string,
  excludeFormId?: string,
): Promise<TitleAvailability> {
  const session = await auth();
  if (!session?.user?.id) return { taken: false };

  const trimmed = title.trim();
  if (!trimmed) return { taken: false };

  const forms = await prisma.form.findMany({
    where: {
      adminId: session.user.id,
      ...(excludeFormId ? { id: { not: excludeFormId } } : {}),
    },
    select: { title: true, status: true },
  });

  const match = forms.find(
    (f) => f.title.toLowerCase() === trimmed.toLowerCase(),
  );
  return match ? { taken: true, status: match.status } : { taken: false };
}

export type UpdateLiveFormResult =
  | { ok: true; title: string }
  | { ok: false; error: "not-signed-in" | "not-found" };

// Edits an already-published (or under-maintenance) form. The live public
// page reflects the change immediately. On the Google Sheet side this only
// ever ADDS columns for new fields — it never renames, reorders, or removes
// a column, so data already collected under the old field list is untouched.
export async function updateLiveForm(
  formId: string,
  input: { title: string; fields: FormField[]; theme: FormTheme },
): Promise<UpdateLiveFormResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const existing = await prisma.form.findUnique({ where: { id: formId } });
  if (
    !existing ||
    existing.adminId !== session.user.id ||
    existing.status === "draft" ||
    !existing.googleSheetId
  ) {
    return { ok: false, error: "not-found" };
  }

  const admin = await prisma.admin.findUnique({
    where: { id: session.user.id },
  });
  if (!admin?.googleRefreshToken) {
    return { ok: false, error: "not-found" };
  }

  const rawTitle = input.title.trim() || "Untitled";
  const title = await generateUniqueTitle(session.user.id, rawTitle, formId);

  try {
    await syncSheetColumns({
      refreshToken: admin.googleRefreshToken,
      spreadsheetId: existing.googleSheetId,
      fields: input.fields,
    });
  } catch (err) {
    // Don't block saving the form definition itself just because a
    // transient Google API error kept the sheet from syncing — the admin's
    // edits (and what visitors see) should still save.
    console.error("Sheet column sync failed:", err);
  }

  await prisma.form.update({
    where: { id: formId },
    data: {
      title,
      schema: JSON.stringify(input.fields),
      theme: JSON.stringify(input.theme),
    },
  });

  return { ok: true, title };
}

export async function setMaintenanceMode(
  formId: string,
  underMaintenance: boolean,
): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };

  const existing = await prisma.form.findUnique({ where: { id: formId } });
  if (
    !existing ||
    existing.adminId !== session.user.id ||
    existing.status === "draft"
  ) {
    return { ok: false };
  }

  await prisma.form.update({
    where: { id: formId },
    data: { status: underMaintenance ? "maintenance" : "published" },
  });
  return { ok: true };
}

export type LoadFormResult =
  | {
      ok: true;
      title: string;
      fields: FormField[];
      theme: FormTheme;
      status: string;
    }
  | { ok: false; error: "not-signed-in" | "not-found" };

export async function loadForm(formId: string): Promise<LoadFormResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const form = await prisma.form.findUnique({ where: { id: formId } });
  if (!form || form.adminId !== session.user.id) {
    return { ok: false, error: "not-found" };
  }

  return {
    ok: true,
    title: form.title,
    fields: JSON.parse(form.schema) as FormField[],
    theme: JSON.parse(form.theme) as FormTheme,
    status: form.status,
  };
}

export async function deleteForm(formId: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };

  const form = await prisma.form.findUnique({ where: { id: formId } });
  if (!form || form.adminId !== session.user.id) return { ok: false };

  await prisma.form.delete({ where: { id: formId } });
  return { ok: true };
}

export type PublishResult =
  | { ok: true; slug: string }
  | {
      ok: false;
      error:
        | "not-signed-in"
        | "no-google-access"
        | "google-error"
        | "empty-title"
        | "publish-limit";
    };

export async function publishForm(input: {
  formId?: string;
  title: string;
  fields: FormField[];
  theme: FormTheme;
}): Promise<PublishResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "not-signed-in" };
  }

  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "empty-title" };
  }

  const admin = await prisma.admin.findUnique({
    where: { id: session.user.id },
  });
  if (!admin?.googleRefreshToken) {
    return { ok: false, error: "no-google-access" };
  }

  // If we're publishing an existing draft, make sure it's actually this
  // admin's and isn't already published (so we don't double-count it).
  let existing = null;
  if (input.formId) {
    existing = await prisma.form.findUnique({ where: { id: input.formId } });
    if (!existing || existing.adminId !== admin.id) {
      existing = null;
    }
  }

  const alreadyLive =
    existing && (existing.status === "published" || existing.status === "maintenance");
  if (!alreadyLive) {
    const publishedCount = await prisma.form.count({
      where: { adminId: admin.id, status: { in: ["published", "maintenance"] } },
    });
    if (publishedCount >= MAX_PUBLISHED_PER_ADMIN) {
      return { ok: false, error: "publish-limit" };
    }
  }

  const finalTitle = await generateUniqueTitle(admin.id, title, input.formId);
  const slug = await uniqueSlugFor(finalTitle, input.formId);

  let googleResult;
  try {
    googleResult = await publishFormToGoogle({
      refreshToken: admin.googleRefreshToken,
      title: finalTitle,
      fields: input.fields,
    });
  } catch (err) {
    console.error("Publish to Google failed:", err);
    return { ok: false, error: "google-error" };
  }

  const data = {
    adminId: admin.id,
    slug,
    title: finalTitle,
    status: "published",
    schema: JSON.stringify(input.fields),
    theme: JSON.stringify(input.theme),
    googleSheetId: googleResult.spreadsheetId,
    googleDriveFolderId: googleResult.formFolderId,
    publishedAt: new Date(),
  };

  if (input.formId) {
    await prisma.form.update({ where: { id: input.formId }, data });
  } else {
    await prisma.form.create({ data });
  }

  return { ok: true, slug };
}
