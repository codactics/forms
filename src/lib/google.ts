import { Readable } from "node:stream";
import { google } from "googleapis";
import type { drive_v3, sheets_v4 } from "googleapis";
import type {
  FormField,
  PlayerListColumn,
  PlayerListField,
} from "@/types/form-builder";
import { formatComputedResult, resolveComputedValues } from "@/lib/computed";

export function getGoogleClients(refreshToken: string) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
  return { drive, sheets };
}

export function sanitizeName(input: string): string {
  const cleaned = input.trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "form";
}

function timestampSuffix(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const q = [
    `name = '${escapedName}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(" and ");

  const existing = await drive.files.list({
    q,
    fields: "files(id, name)",
    spaces: "drive",
  });
  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Failed to create Drive folder");
  return created.data.id;
}

const NON_DATA_TYPES = new Set(["static-text", "section-break", "player-list"]);

function isPlayerListField(field: FormField): field is PlayerListField {
  return field.type === "player-list";
}

export async function publishFormToGoogle({
  refreshToken,
  title,
  fields,
}: {
  refreshToken: string;
  title: string;
  fields: FormField[];
}) {
  const { drive, sheets } = getGoogleClients(refreshToken);

  const codacticsFolderId = await findOrCreateFolder(drive, "codactics");
  const formsFolderId = await findOrCreateFolder(drive, "form", codacticsFolderId);

  const sanitizedTitle = sanitizeName(title);
  const folderName = `${sanitizedTitle}_${timestampSuffix()}`;

  const formFolder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [formsFolderId],
    },
    fields: "id",
  });
  const formFolderId = formFolder.data.id;
  if (!formFolderId) throw new Error("Failed to create form folder");

  await drive.files.create({
    requestBody: {
      name: "Files",
      mimeType: "application/vnd.google-apps.folder",
      parents: [formFolderId],
    },
    fields: "id",
  });

  const playerListFields = fields.filter(isPlayerListField);
  const dataFields = fields.filter((f) => !NON_DATA_TYPES.has(f.type));

  const sheetTabs: sheets_v4.Schema$Sheet[] = [
    { properties: { title: "Submissions" } },
    ...playerListFields.map((f) => ({
      properties: { title: sanitizeName(f.label || "Entries").slice(0, 90) },
    })),
  ];

  const createdSheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: sanitizedTitle },
      sheets: sheetTabs,
    },
  });
  const spreadsheetId = createdSheet.data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Failed to create spreadsheet");

  // Sheets API always creates the file in "My Drive" root — move it into
  // the form folder we just built.
  const fileMeta = await drive.files.get({
    fileId: spreadsheetId,
    fields: "parents",
  });
  await drive.files.update({
    fileId: spreadsheetId,
    addParents: formFolderId,
    removeParents: (fileMeta.data.parents ?? []).join(","),
    fields: "id, parents",
  });

  const submissionsHeader = [
    "Submission ID",
    "Submitted At",
    ...dataFields.map((f) => f.label || "Untitled"),
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Submissions!A1",
    valueInputOption: "RAW",
    requestBody: { values: [submissionsHeader] },
  });

  for (const playerListField of playerListFields) {
    const tabTitle = sanitizeName(playerListField.label || "Entries").slice(0, 90);
    const header = [
      "Submission ID",
      "Entry #",
      ...playerListField.columns.map((c) => c.label || "Untitled"),
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabTitle}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
  }

  return { spreadsheetId, formFolderId };
}

// Appends any header columns the current field list needs but the sheet
// doesn't have yet. Never renames, reorders, or removes existing columns —
// once a submission has been written under a column, that column is
// permanent, even if the field is later removed from the form.
async function syncTabHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string,
  desiredHeader: string[],
) {
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabTitle}!1:1`,
  });
  const currentHeader = (existing.data.values?.[0] ?? []) as string[];
  const newColumns = desiredHeader.filter((h) => !currentHeader.includes(h));
  if (newColumns.length === 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...currentHeader, ...newColumns]] },
  });
}

export async function syncSheetColumns({
  refreshToken,
  spreadsheetId,
  fields,
}: {
  refreshToken: string;
  spreadsheetId: string;
  fields: FormField[];
}) {
  const { sheets } = getGoogleClients(refreshToken);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title))",
  });
  const existingTabs = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title ?? ""),
  );

  const playerListFields = fields.filter(isPlayerListField);
  const dataFields = fields.filter((f) => !NON_DATA_TYPES.has(f.type));

  await syncTabHeader(sheets, spreadsheetId, "Submissions", [
    "Submission ID",
    "Submitted At",
    ...dataFields.map((f) => f.label || "Untitled"),
  ]);

  for (const playerListField of playerListFields) {
    const tabTitle = sanitizeName(playerListField.label || "Entries").slice(0, 90);
    const header = [
      "Submission ID",
      "Entry #",
      ...playerListField.columns.map((c) => c.label || "Untitled"),
    ];

    if (!existingTabs.has(tabTitle)) {
      // A brand-new repeating-list field added after publish — give it its
      // own tab, same as at initial publish time.
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabTitle } } }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabTitle}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [header] },
      });
    } else {
      await syncTabHeader(sheets, spreadsheetId, tabTitle, header);
    }
  }
}

async function uploadFileToFolder(
  drive: drive_v3.Drive,
  folderId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id, webViewLink",
  });
  return (
    res.data.webViewLink ??
    (res.data.id ? `https://drive.google.com/file/d/${res.data.id}/view` : "")
  );
}

function dataUrlToBuffer(
  dataUrl: string,
): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function appendRowMatchingHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string,
  valuesByHeader: Record<string, string>,
) {
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabTitle}!1:1`,
  });
  const header = (existing.data.values?.[0] ?? []) as string[];
  const row = header.map((h) => valuesByHeader[h] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabTitle}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

async function extractTopLevelValue(
  field: FormField,
  formData: FormData,
  drive: drive_v3.Drive,
  filesFolderId: string,
  fileNamePrefix: string,
): Promise<string> {
  switch (field.type) {
    case "photo":
    case "document": {
      const file = formData.get(field.id);
      if (!(file instanceof File) || file.size === 0) return "";
      const buffer = Buffer.from(await file.arrayBuffer());
      return uploadFileToFolder(
        drive,
        filesFolderId,
        `${fileNamePrefix}_${sanitizeName(file.name)}`,
        buffer,
        file.type || "application/octet-stream",
      );
    }
    case "signature": {
      const raw = formData.get(field.id);
      const dataUrl = typeof raw === "string" ? raw : "";
      const parsed = dataUrl ? dataUrlToBuffer(dataUrl) : null;
      if (!parsed) return "";
      return uploadFileToFolder(
        drive,
        filesFolderId,
        `${fileNamePrefix}_signature.png`,
        parsed.buffer,
        parsed.mimeType,
      );
    }
    case "dropdown": {
      const otherText = String(formData.get(`${field.id}__other`) ?? "").trim();
      if (field.allowMultiple) {
        return formData
          .getAll(field.id)
          .map(String)
          .map((v) => (v === "__other__" ? otherText : v))
          .filter(Boolean)
          .join(", ");
      }
      const selected = String(formData.get(field.id) ?? "");
      return selected === "__other__" ? otherText : selected;
    }
    case "static-text":
    case "section-break":
      return "";
    default: {
      const value = formData.get(field.id);
      return typeof value === "string" ? value : "";
    }
  }
}

async function extractPlayerColumnValue(
  column: PlayerListColumn,
  formData: FormData,
  key: string,
  drive: drive_v3.Drive,
  filesFolderId: string,
  fileNamePrefix: string,
): Promise<string> {
  if (column.type === "photo") {
    const file = formData.get(key);
    if (!(file instanceof File) || file.size === 0) return "";
    const buffer = Buffer.from(await file.arrayBuffer());
    return uploadFileToFolder(
      drive,
      filesFolderId,
      `${fileNamePrefix}_${sanitizeName(file.name)}`,
      buffer,
      file.type || "application/octet-stream",
    );
  }
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function recordSubmission({
  refreshToken,
  spreadsheetId,
  formFolderId,
  fields,
  formData,
}: {
  refreshToken: string;
  spreadsheetId: string;
  formFolderId: string;
  fields: FormField[];
  formData: FormData;
}): Promise<{ submissionId: string }> {
  const { drive, sheets } = getGoogleClients(refreshToken);
  const filesFolderId = await findOrCreateFolder(drive, "Files", formFolderId);

  const submissionId = crypto.randomUUID();
  const submittedAt = new Date().toLocaleString();

  const playerListFields = fields.filter(isPlayerListField);
  const dataFields = fields.filter((f) => !NON_DATA_TYPES.has(f.type));

  // Computed fields are recalculated from the submitted Number/Rating
  // values here — never trusted from the client's hidden input — so a
  // respondent can't tamper with something like a total price by editing
  // the DOM before submitting.
  const numericValues = new Map<string, number>();
  for (const field of fields) {
    if (field.type === "number" || field.type === "rating") {
      const raw = formData.get(field.id);
      const num = typeof raw === "string" ? parseFloat(raw) : NaN;
      if (Number.isFinite(num)) numericValues.set(field.id, num);
    }
  }
  const computedValues = resolveComputedValues(fields, numericValues);

  const submissionRow: Record<string, string> = {
    "Submission ID": submissionId,
    "Submitted At": submittedAt,
  };
  for (const field of dataFields) {
    submissionRow[field.label || "Untitled"] =
      field.type === "computed"
        ? formatComputedResult(computedValues.get(field.id) ?? 0)
        : await extractTopLevelValue(
            field,
            formData,
            drive,
            filesFolderId,
            submissionId,
          );
  }
  await appendRowMatchingHeader(
    sheets,
    spreadsheetId,
    "Submissions",
    submissionRow,
  );

  for (const playerListField of playerListFields) {
    const tabTitle = sanitizeName(playerListField.label || "Entries").slice(
      0,
      90,
    );
    for (let i = 0; i < playerListField.playerCount; i++) {
      const row: Record<string, string> = {};
      let hasValue = false;
      for (const column of playerListField.columns) {
        const key = `player-${i}-${column.id}`;
        const value = await extractPlayerColumnValue(
          column,
          formData,
          key,
          drive,
          filesFolderId,
          `${submissionId}_p${i + 1}`,
        );
        if (value) hasValue = true;
        row[column.label || "Untitled"] = value;
      }
      // Skip fully-blank player rows (e.g. a squad of 7 in an 11-slot form).
      if (!hasValue) continue;
      await appendRowMatchingHeader(sheets, spreadsheetId, tabTitle, {
        "Submission ID": submissionId,
        "Entry #": String(i + 1),
        ...row,
      });
    }
  }

  return { submissionId };
}
