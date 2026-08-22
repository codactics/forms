"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  publishFormToGoogle,
  syncSheetColumns,
  uploadFormImagesToDrive,
} from "@/lib/google";
import { saveFormImagesLocally } from "@/lib/local-storage";
import { slugify } from "@/lib/slug";
import { generateUniqueTitle } from "@/lib/form-naming";
import { MAX_DRAFTS_PER_ADMIN, MAX_PUBLISHED_PER_ADMIN } from "@/lib/form-limits";
import { localToUtcInstant, getTimezoneOffset, utcInstantToLocal } from "@/lib/timezones";
import { hashPassword } from "@/lib/access-code";
import type { FormField } from "@/types/form-builder";
import { DEFAULT_THEME, type FormTheme } from "@/types/theme";
import { DEFAULT_CLOSING, type FormClosing } from "@/types/closing";

export type StorageChoice = "google" | "local";

// Computes the { closeMode, closesAt, closeTimezoneLabel } columns from the
// builder's FormClosing state. An incomplete "deadline" pick (date/time not
// both filled in yet) is saved as if it were "open", rather than half-
// applying a closing that isn't actually configured.
function closingToDbFields(closing: FormClosing) {
  if (closing.mode === "manual") {
    return { closeMode: "manual", closesAt: null, closeTimezoneLabel: null };
  }
  if (closing.mode === "deadline" && closing.dateStr && closing.timeStr) {
    const closesAt = localToUtcInstant(
      closing.dateStr,
      closing.timeStr,
      getTimezoneOffset(closing.timezoneId),
    );
    if (closesAt) {
      return {
        closeMode: "deadline",
        closesAt,
        closeTimezoneLabel: closing.timezoneId,
      };
    }
  }
  return { closeMode: null, closesAt: null, closeTimezoneLabel: null };
}

function dbFieldsToClosing(form: {
  closeMode: string | null;
  closesAt: Date | null;
  closeTimezoneLabel: string | null;
}): FormClosing {
  if (form.closeMode === "manual") {
    return { ...DEFAULT_CLOSING, mode: "manual" };
  }
  if (form.closeMode === "deadline" && form.closesAt && form.closeTimezoneLabel) {
    const { dateStr, timeStr } = utcInstantToLocal(
      form.closesAt,
      getTimezoneOffset(form.closeTimezoneLabel),
    );
    return { mode: "deadline", dateStr, timeStr, timezoneId: form.closeTimezoneLabel };
  }
  return DEFAULT_CLOSING;
}

// A single-line <input> normally can't have a newline typed into it, but a
// pasted clipboard value can still carry one through on some browsers —
// and a title with an embedded line break wrecks the PDF export's header
// (which draws it as one fixed-position line, not through the wrapping
// logic used elsewhere). Collapse any whitespace run, newlines included,
// into a single space before ever saving it.
function sanitizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

async function uniqueSlugFor(title: string, excludeFormId?: string) {
  const base = slugify(title);
  let slug = base;
  let n = 1;
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
  input: { title: string; fields: FormField[]; theme: FormTheme; closing: FormClosing },
): Promise<UpdateDraftResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const existing = await prisma.form.findUnique({ where: { id: formId } });
  if (!existing || existing.adminId !== session.user.id) {
    return { ok: false, error: "not-found" };
  }

  const rawTitle = sanitizeTitle(input.title) || "Untitled";
  const title = await generateUniqueTitle(session.user.id, rawTitle, formId);

  await prisma.form.update({
    where: { id: formId },
    data: {
      title,
      schema: JSON.stringify(input.fields),
      theme: JSON.stringify(input.theme),
      ...closingToDbFields(input.closing),
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
  input: { title: string; fields: FormField[]; theme: FormTheme; closing: FormClosing },
): Promise<UpdateLiveFormResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const existing = await prisma.form.findUnique({ where: { id: formId } });
  if (
    !existing ||
    existing.adminId !== session.user.id ||
    existing.status === "draft" ||
    (existing.storageProvider === "google" && !existing.googleSheetId)
  ) {
    return { ok: false, error: "not-found" };
  }

  const rawTitle = sanitizeTitle(input.title) || "Untitled";
  const title = await generateUniqueTitle(session.user.id, rawTitle, formId);

  // Only the Sheet has a shared header to keep in sync as fields change —
  // locally-stored submissions are each a self-contained JSON row, so
  // there's nothing equivalent to sync there.
  let fields = input.fields;
  let theme = input.theme;
  if (existing.storageProvider === "google" && existing.googleSheetId) {
    const admin = await prisma.admin.findUnique({
      where: { id: session.user.id },
    });
    if (!admin?.googleRefreshToken) {
      return { ok: false, error: "not-found" };
    }
    try {
      await syncSheetColumns({
        refreshToken: admin.googleRefreshToken,
        spreadsheetId: existing.googleSheetId,
        fields: input.fields,
      });
    } catch (err) {
      // Don't block saving the form definition itself just because a
      // transient Google API error kept the sheet from syncing — the
      // admin's edits (and what visitors see) should still save.
      console.error("Sheet column sync failed:", err);
    }
    if (existing.googleDriveFolderId) {
      // uploadFormImagesToDrive already logs and degrades independently
      // per side (schema vs theme) rather than blocking the save.
      ({ fields, theme } = await uploadFormImagesToDrive({
        refreshToken: admin.googleRefreshToken,
        formFolderId: existing.googleDriveFolderId,
        fields: input.fields,
        theme: input.theme,
      }));
    }
  } else if (existing.storageProvider === "local") {
    ({ fields, theme } = await saveFormImagesLocally(formId, input.fields, input.theme));
  }

  await prisma.form.update({
    where: { id: formId },
    data: {
      title,
      schema: JSON.stringify(fields),
      theme: JSON.stringify(theme),
      ...closingToDbFields(input.closing),
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
      closing: FormClosing;
      requireAccessCode: boolean;
      accessUsernames: string[];
    }
  | { ok: false; error: "not-signed-in" | "not-found" };

export async function loadForm(formId: string): Promise<LoadFormResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: { accessCodes: { select: { username: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!form || form.adminId !== session.user.id) {
    return { ok: false, error: "not-found" };
  }

  return {
    ok: true,
    title: form.title,
    fields: JSON.parse(form.schema) as FormField[],
    theme: JSON.parse(form.theme) as FormTheme,
    status: form.status,
    closing: dbFieldsToClosing(form),
    requireAccessCode: form.requireAccessCode,
    accessUsernames: form.accessCodes.map((c) => c.username),
  };
}

export type SaveAccessCodesResult =
  | { ok: true }
  | { ok: false; error: "not-signed-in" | "not-found" | "missing-password" | "duplicate-username" };

// Kept separate from the main autosave (title/fields/theme/closing) since
// this involves hashing new passwords — no reason to redo that work on
// every unrelated keystroke, and a password field shouldn't silently
// resubmit itself on a debounce timer the way a text label safely can.
export async function saveAccessCodes(
  formId: string,
  requireAccessCode: boolean,
  codes: { username: string; password?: string }[],
): Promise<SaveAccessCodesResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not-signed-in" };

  const form = await prisma.form.findUnique({ where: { id: formId } });
  if (!form || form.adminId !== session.user.id) {
    return { ok: false, error: "not-found" };
  }

  const trimmed = codes
    .map((c) => ({ username: c.username.trim(), password: c.password?.trim() || undefined }))
    .filter((c) => c.username);

  const seen = new Set<string>();
  for (const c of trimmed) {
    const key = c.username.toLowerCase();
    if (seen.has(key)) return { ok: false, error: "duplicate-username" };
    seen.add(key);
  }

  const existing = await prisma.formAccessCode.findMany({ where: { formId } });
  const existingByUsername = new Map(existing.map((c) => [c.username, c]));

  for (const c of trimmed) {
    if (!existingByUsername.has(c.username) && !c.password) {
      return { ok: false, error: "missing-password" };
    }
  }

  await prisma.$transaction([
    prisma.formAccessCode.deleteMany({
      where: { formId, username: { notIn: trimmed.map((c) => c.username) } },
    }),
    // An entry with no new password is an existing, unchanged row (already
    // validated above) — nothing to write for it, so it's just left out
    // rather than issued as a no-op update.
    ...trimmed
      .filter((c) => c.password)
      .map((c) =>
        prisma.formAccessCode.upsert({
          where: { formId_username: { formId, username: c.username } },
          create: { formId, username: c.username, passwordHash: hashPassword(c.password!) },
          update: { passwordHash: hashPassword(c.password!) },
        }),
      ),
    prisma.form.update({ where: { id: formId }, data: { requireAccessCode } }),
  ]);

  return { ok: true };
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
  storage: StorageChoice;
  closing: FormClosing;
}): Promise<PublishResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "not-signed-in" };
  }

  const title = sanitizeTitle(input.title);
  if (!title) {
    return { ok: false, error: "empty-title" };
  }

  const admin = await prisma.admin.findUnique({
    where: { id: session.user.id },
  });
  if (!admin) {
    return { ok: false, error: "not-signed-in" };
  }
  if (input.storage === "google" && !admin.googleRefreshToken) {
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

  const data: Record<string, unknown> = {
    adminId: admin.id,
    slug,
    title: finalTitle,
    status: "published",
    schema: JSON.stringify(input.fields),
    theme: JSON.stringify(input.theme),
    publishedAt: new Date(),
    ...closingToDbFields(input.closing),
  };

  if (input.storage === "google") {
    let googleResult;
    try {
      googleResult = await publishFormToGoogle({
        refreshToken: admin.googleRefreshToken!,
        title: finalTitle,
        fields: input.fields,
      });
    } catch (err) {
      console.error("Publish to Google failed:", err);
      return { ok: false, error: "google-error" };
    }
    data.storageProvider = "google";
    data.googleSheetId = googleResult.spreadsheetId;
    data.googleDriveFolderId = googleResult.formFolderId;

    // Keeps the base64-embedded schema/theme rather than failing the whole
    // publish over an image upload hiccup — uploadFormImagesToDrive logs
    // and degrades independently per side already.
    const uploaded = await uploadFormImagesToDrive({
      refreshToken: admin.googleRefreshToken!,
      formFolderId: googleResult.formFolderId,
      fields: input.fields,
      theme: input.theme,
    });
    data.schema = JSON.stringify(uploaded.fields);
    data.theme = JSON.stringify(uploaded.theme);
  } else {
    data.storageProvider = "local";
  }

  let formId: string;
  if (input.formId) {
    await prisma.form.update({ where: { id: input.formId }, data });
    formId = input.formId;
  } else {
    const created = await prisma.form.create({ data: data as never });
    formId = created.id;
  }

  // Only knowable once the row exists — a brand-new form has no id (and so
  // nowhere to save files under) until the create above runs, so this is a
  // follow-up pass rather than something foldable into `data` up front.
  if (input.storage === "local") {
    const { fields, theme } = await saveFormImagesLocally(formId, input.fields, input.theme);
    await prisma.form.update({
      where: { id: formId },
      data: { schema: JSON.stringify(fields), theme: JSON.stringify(theme) },
    });
  }

  return { ok: true, slug };
}
