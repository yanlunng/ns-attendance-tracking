const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const AdmZip = require('adm-zip');
const db = require('../db');

const dataDir = path.join(__dirname, '..', '..', 'data');
const attachmentsDir = path.join(dataDir, 'attachments');

// Tables that belong to one ICT cycle's roster/outfield state — exported,
// purged, and restored together, parents before children (import runs this
// order; purge runs it in reverse). `users` (logins) and `telegram_sessions`
// (bot scratch state) are deliberately excluded — appointment-holder
// accounts persist across cycles. `telegram_links` is cycle-scoped (same as
// roster upload's existing "Replace" behavior, see routes/roster.js) but
// intentionally never restored on import — a new cycle always starts with
// fresh Telegram linking.
const ICT_TABLES = [
  'outfield_sections',
  'vehicles',
  'roster',
  'vehicle_drivers',
  'vehicle_commanders',
  'attendance_submissions',
  'kah_designations',
  'report_confirmations',
  'outfield_dates',
  'settings',
  'outfield_equipment',
];

function tmpPath(name) {
  return path.join(os.tmpdir(), `attendance-archive-${crypto.randomBytes(8).toString('hex')}-${name}`);
}

function listAttachmentFiles() {
  if (!fs.existsSync(attachmentsDir)) return [];
  return fs.readdirSync(attachmentsDir).filter((f) => fs.statSync(path.join(attachmentsDir, f)).isFile());
}

/**
 * Builds a downloadable zip: a consistent snapshot of the whole database
 * (VACUUM INTO avoids any inconsistency from copying a live WAL-mode file
 * mid-write) plus every attachment file. Includes the `users` table too —
 * harmless on export (importArchive deliberately skips it) — so the zip
 * doubles as a complete audit snapshot, not just the restorable subset.
 */
function exportArchive() {
  const snapshotPath = tmpPath('attendance.db');
  try {
    db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);

    const zip = new AdmZip();
    zip.addLocalFile(snapshotPath, '', 'attendance.db');
    for (const file of listAttachmentFiles()) {
      zip.addLocalFile(path.join(attachmentsDir, file), 'attachments');
    }
    return zip.toBuffer();
  } finally {
    fs.rmSync(snapshotPath, { force: true });
  }
}

/** True if there's any current-cycle data an import would collide with. */
function hasExistingIctData() {
  return db.prepare('SELECT COUNT(*) AS c FROM roster').get().c > 0;
}

/**
 * Deletes every ICT-cycle table's rows (children before parents) and clears
 * attachment files, without touching user accounts/logins. Telegram links
 * are cleared too, matching the existing roster-upload "Replace" behavior.
 */
const purgeIctData = db.transaction(() => {
  for (const table of [...ICT_TABLES].reverse()) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec('DELETE FROM telegram_links');
  db.exec('UPDATE users SET telegram_link_code = NULL');
  for (const file of listAttachmentFiles()) {
    fs.rmSync(path.join(attachmentsDir, file), { force: true });
  }
});

/**
 * Restores a previously exported archive into the live database — refuses
 * if the live roster is non-empty, since import is only meant to follow an
 * export(+purge), never to merge into existing data (explicit row IDs from
 * the archive would otherwise collide with unrelated live rows). Reads the
 * uploaded db file through a separate read-only connection and copies rows
 * table-by-table into the live one, so the live connection's own file
 * handle is never touched — no server restart required.
 */
function importArchive(zipBuffer) {
  if (hasExistingIctData()) {
    throw new Error('Current roster is not empty — export (optionally with purge) before importing a previous archive.');
  }

  const zip = new AdmZip(zipBuffer);
  const dbEntry = zip.getEntry('attendance.db');
  if (!dbEntry) throw new Error('That file is not a valid export archive (missing attendance.db).');

  const extractedDbPath = tmpPath('import.db');
  fs.writeFileSync(extractedDbPath, zip.readFile(dbEntry));

  let importDb;
  try {
    importDb = new DatabaseSync(extractedDbPath, { readOnly: true });

    const run = db.transaction(() => {
      for (const table of ICT_TABLES) {
        const importCols = importDb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        if (importCols.length === 0) continue; // table didn't exist in that export (older schema)
        const liveCols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
        const cols = importCols.filter((c) => liveCols.has(c));
        if (cols.length === 0) continue;

        const rows = importDb.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
        if (rows.length === 0) continue;

        const placeholders = cols.map(() => '?').join(', ');
        const insert = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
        for (const row of rows) insert.run(...cols.map((c) => row[c]));
      }
    });
    run();
  } finally {
    if (importDb) importDb.close();
    fs.rmSync(extractedDbPath, { force: true });
  }

  if (!fs.existsSync(attachmentsDir)) fs.mkdirSync(attachmentsDir, { recursive: true });
  const attachmentEntries = zip.getEntries().filter((e) => e.entryName.startsWith('attachments/') && !e.isDirectory);
  for (const entry of attachmentEntries) {
    fs.writeFileSync(path.join(attachmentsDir, path.basename(entry.entryName)), entry.getData());
  }
}

module.exports = { exportArchive, purgeIctData, importArchive, hasExistingIctData };
