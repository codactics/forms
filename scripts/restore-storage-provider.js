// One-time repair for production databases hit by the broken
// 20260812221402_remove_nextcloud_storage migration, which incorrectly
// dropped the still-in-use Form.storageProvider column before failing on
// its next (already-redundant) statement. Safe to run more than once —
// it checks whether the column already exists before adding it back.
const Database = require("better-sqlite3");

const url = process.env.DATABASE_URL || "file:./dev.db";
const filePath = url.startsWith("file:") ? url.slice(5) : url;

const db = new Database(filePath);
try {
  const columns = db.prepare(`PRAGMA table_info("Form")`).all();
  const hasStorageProvider = columns.some((c) => c.name === "storageProvider");

  if (hasStorageProvider) {
    console.log("Form.storageProvider already present, nothing to do.");
  } else {
    db.exec(
      `ALTER TABLE "Form" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'google';`,
    );
    console.log("Restored Form.storageProvider column.");
  }
} finally {
  db.close();
}
