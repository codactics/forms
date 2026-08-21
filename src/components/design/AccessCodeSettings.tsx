"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveAccessCodes } from "@/lib/form-actions";

interface CodeRow {
  username: string;
  password: string; // blank on an existing row means "keep the current password"
  isNew: boolean;
}

export function AccessCodeSettings({
  formId,
  initialRequireAccessCode,
  initialUsernames,
}: {
  formId?: string | null;
  initialRequireAccessCode: boolean;
  initialUsernames: string[];
}) {
  const [enabled, setEnabled] = useState(initialRequireAccessCode);
  const [rows, setRows] = useState<CodeRow[]>(
    initialUsernames.map((username) => ({ username, password: "", isNew: false })),
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setRows((prev) => [...prev, { username: "", password: "", isNew: true }]);
  }

  function updateRow(i: number, updates: Partial<CodeRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...updates } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!formId) return;
    setSaveState("saving");
    setError(null);
    const result = await saveAccessCodes(
      formId,
      enabled,
      rows.map((r) => ({ username: r.username, password: r.password || undefined })),
    );
    if (result.ok) {
      setSaveState("saved");
      setRows((prev) => prev.map((r) => ({ ...r, password: "", isNew: false })));
      setTimeout(() => setSaveState("idle"), 2000);
    } else {
      setSaveState("error");
      setError(
        {
          "not-signed-in": "You're signed out — please sign in again.",
          "not-found": "Couldn't find this form.",
          "missing-password": "Every new username needs a password.",
          "duplicate-username": "Two entries have the same username.",
        }[result.error],
      );
    }
  }

  return (
    <div className="border-t border-royal-100 pt-4">
      <label className="mb-2 block text-xs font-medium text-royal-700">
        Access control
      </label>
      {!formId ? (
        <p className="text-xs text-royal-400">
          Save this form first before setting up access codes.
        </p>
      ) : (
        <>
          <label className="mb-3 flex items-center gap-2 text-sm text-royal-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-royal-300"
            />
            Require a username and password to access this form
          </label>

          {enabled && (
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.username}
                    onChange={(e) => updateRow(i, { username: e.target.value })}
                    placeholder="Username"
                    className="min-w-0 flex-1 rounded-md border border-royal-200 px-2.5 py-1.5 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
                  />
                  <input
                    value={row.password}
                    onChange={(e) => updateRow(i, { password: e.target.value })}
                    placeholder={
                      row.isNew ? "Password" : "New password (leave blank to keep)"
                    }
                    className="min-w-0 flex-1 rounded-md border border-royal-200 px-2.5 py-1.5 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="shrink-0 rounded p-1.5 text-royal-300 hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1.5 self-start rounded-md border border-dashed border-royal-300 px-3 py-1.5 text-xs font-medium text-royal-600 hover:bg-royal-50"
              >
                <Plus size={14} />
                Add username
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveState === "saving"}
              className="rounded-full bg-royal-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-royal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving" ? "Saving…" : "Save access settings"}
            </button>
            {saveState === "saved" && (
              <span className="text-xs font-medium text-green-600">Saved</span>
            )}
            {saveState === "error" && error && (
              <span className="text-xs font-medium text-red-600">{error}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
