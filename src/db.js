const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const raw = new DatabaseSync(path.join(dataDir, 'attendance.db'));
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

raw.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS roster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ref_id TEXT,
    unit TEXT,
    extra TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    roster_id INTEGER NOT NULL REFERENCES roster(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('present', 'off', 'mc', 'outpro')),
    off_period TEXT CHECK (off_period IN ('AM', 'PM', 'TIME') OR off_period IS NULL),
    off_time TEXT,
    off_time_end TEXT,
    approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    approved_by INTEGER REFERENCES users(id),
    approved_at TEXT,
    attachment_path TEXT,
    remarks TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(date, roster_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS outfield_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_code TEXT,
    platoon TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_staging INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS telegram_sessions (
    chat_id INTEGER PRIMARY KEY,
    state TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS telegram_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_telegram_links_user_id ON telegram_links(user_id);
`);

// Additive, idempotent migrations for columns introduced after the tables
// above already shipped — safe to run against a fresh or existing database.
function addColumnIfMissing(table, column, definition) {
  const existing = raw.prepare(`PRAGMA table_info(${table})`).all();
  if (existing.some((c) => c.name === column)) return;
  raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('roster', 'date_of_birth', 'TEXT');
addColumnIfMissing('roster', 'group_code', 'TEXT');
addColumnIfMissing('roster', 'group_source', "TEXT NOT NULL DEFAULT 'auto'");
addColumnIfMissing('roster', 'subunit1_raw', 'TEXT');
addColumnIfMissing('roster', 'is_deferred', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('roster', 'is_ict_cancelled', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('roster', 'mobile', 'TEXT');
addColumnIfMissing('roster', 'is_commander_phase', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('roster', 'position_descr', 'TEXT');
addColumnIfMissing('roster', 'outfield_section_id', 'INTEGER REFERENCES outfield_sections(id) ON DELETE SET NULL');
addColumnIfMissing('roster', 'outfield_slot', 'TEXT');
addColumnIfMissing('attendance_submissions', 'off_time_end', 'TEXT');
addColumnIfMissing('users', 'needs_password', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'roster_id', 'INTEGER REFERENCES roster(id) ON DELETE CASCADE');
addColumnIfMissing('users', 'telegram_link_code', 'TEXT');
raw.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_roster_id ON users(roster_id) WHERE roster_id IS NOT NULL');

// Superseded by the telegram_links table (which supports multiple linked
// chats per user, needed for KAH role accounts) — drop the old 1:1 column
// if an earlier local run of this feature created it.
{
  const cols = raw.prepare('PRAGMA table_info(users)').all();
  if (cols.some((c) => c.name === 'telegram_chat_id')) {
    raw.exec('DROP INDEX IF EXISTS idx_users_telegram_chat_id');
    raw.exec('ALTER TABLE users DROP COLUMN telegram_chat_id');
  }
}

// attendance_submissions' status set/columns changed after it first shipped
// (added mc/outpro, off_period/off_time, approval workflow, attachments).
// SQLite can't relax a CHECK constraint in place, so rebuild the table when
// an old-shaped one is found, carrying existing data forward (legacy 'leave'
// rows become 'off', and are grandfathered in as already-approved).
function needsSubmissionsRebuild() {
  const cols = raw.prepare('PRAGMA table_info(attendance_submissions)').all();
  return !cols.some((c) => c.name === 'approval_status');
}

if (needsSubmissionsRebuild()) {
  raw.exec('ALTER TABLE attendance_submissions RENAME TO attendance_submissions_old');
  raw.exec(`
    CREATE TABLE attendance_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      roster_id INTEGER NOT NULL REFERENCES roster(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('present', 'off', 'mc', 'outpro')),
      off_period TEXT CHECK (off_period IN ('AM', 'PM', 'TIME') OR off_period IS NULL),
      off_time TEXT,
      off_time_end TEXT,
      approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      attachment_path TEXT,
      remarks TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(date, roster_id, user_id)
    )
  `);
  raw.exec(`
    INSERT INTO attendance_submissions (id, date, roster_id, user_id, status, approval_status, remarks, submitted_at)
    SELECT id, date, roster_id, user_id,
           CASE WHEN status = 'leave' THEN 'off' ELSE status END,
           'approved',
           remarks, submitted_at
    FROM attendance_submissions_old
  `);
  raw.exec('DROP TABLE attendance_submissions_old');
}

// Thin wrapper so call sites read like better-sqlite3 (prepare/get/all/run,
// plus a transaction() helper), backed by Node's built-in node:sqlite.
const db = {
  prepare(sql) {
    return raw.prepare(sql);
  },
  exec(sql) {
    return raw.exec(sql);
  },
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  },
};

function bootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
  ).run(username, hash, 'admin');
  console.log(`[bootstrap] Created initial admin user "${username}". Recreate the user via the Users page to change its password if needed.`);
}

// Key Appointment Holder accounts: fixed per role slot (not tied to whoever
// currently holds the appointment), created once with no usable password —
// an admin sets each one's password via the Users page, after which the
// holder can change it themselves at their own discretion.
const KAH_ROLES = [
  { username: 'bc', role: 'admin', telegramLinkCap: 3, editScope: null },
  { username: 'bsm', role: 'admin', telegramLinkCap: 3, editScope: null },
  { username: 'b2ic', role: 'editor', telegramLinkCap: 3, editScope: null },
  { username: 'pc', role: 'editor', telegramLinkCap: 4, editScope: ['RBS', 'HQ', 'DVR'] },
  { username: 'ps', role: 'editor', telegramLinkCap: 4, editScope: ['RBS', 'HQ', 'DVR'] },
  { username: 'p2ic', role: 'editor', telegramLinkCap: 4, editScope: ['RBS', 'HQ', 'DVR'] },
  { username: 'fpcom', role: 'editor', telegramLinkCap: 12, editScope: ['FP'] },
  { username: 'rcom', role: 'editor', telegramLinkCap: 4, editScope: ['PSTAR'] },
  { username: 'fucom', role: 'editor', telegramLinkCap: 12, editScope: ['RBS', 'DVR'] },
];

function bootstrapKahRoles() {
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, role, needs_password) VALUES (?, ?, ?, 1)'
  );
  for (const { username, role } of KAH_ROLES) {
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) continue;
    const placeholderHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
    insert.run(username, placeholderHash, role);
    console.log(`[bootstrap] Created "${username}" (${role}) with no password set — an admin must set one via the Users page.`);
  }
}

bootstrapAdmin();
bootstrapKahRoles();

const KAH_USERNAMES = new Set(KAH_ROLES.map((r) => r.username));
function isKahUsername(username) {
  return KAH_USERNAMES.has(username);
}

const KAH_LINK_CAPS = new Map(KAH_ROLES.map((r) => [r.username, r.telegramLinkCap]));
const DEFAULT_TELEGRAM_LINK_CAP = 1;
function telegramLinkCapFor(username) {
  return KAH_LINK_CAPS.get(username) ?? DEFAULT_TELEGRAM_LINK_CAP;
}

// null = unrestricted (can mark anyone); an array restricts marking to only
// roster members whose group_code is in that list. Only applies to the named
// KAH accounts above — any other admin/editor/user account is unrestricted.
const KAH_EDIT_SCOPES = new Map(KAH_ROLES.map((r) => [r.username, r.editScope]));
function editScopeFor(username) {
  return KAH_EDIT_SCOPES.has(username) ? KAH_EDIT_SCOPES.get(username) : null;
}

module.exports = db;
module.exports.KAH_ROLES = KAH_ROLES;
module.exports.isKahUsername = isKahUsername;
module.exports.telegramLinkCapFor = telegramLinkCapFor;
module.exports.editScopeFor = editScopeFor;
