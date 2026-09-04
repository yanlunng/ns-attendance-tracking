const bcrypt = require('bcryptjs');
const db = require('../db');

// Used when someone has no DOB on file, since the password can't be derived.
const DEFAULT_PASSWORD_NO_DOB = '123456';

function normalizeMobile(mobile) {
  return String(mobile || '').replace(/\D/g, '');
}

/** "1997-12-27" -> "12271997" (MMDDYYYY). */
function dobToPassword(dobIso) {
  const [yyyy, mm, dd] = dobIso.split('-');
  return `${mm}${dd}${yyyy}`;
}

function uniqueUsername(base) {
  let username = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    username = `${base}-${suffix}`;
    suffix++;
  }
  return username;
}

/**
 * Creates a read-only "self" account for every active roster person who
 * doesn't already have one linked (matched via users.roster_id, which
 * survives re-uploads thanks to the roster's own identity matching).
 * Username = mobile number (digits only); password = date of birth as
 * MMDDYYYY, or "123456" if DOB is missing — both derivable directly from the
 * roster sheet, so there's no admin distribution step. People missing a
 * mobile number can't be provisioned at all (no way to derive a username)
 * and are surfaced separately so the gap is visible instead of silently
 * missing. Existing accounts are never touched — this never resets a
 * password someone has already personalized via "Change password".
 */
function provisionSelfAccounts(rosterRows) {
  const insert = db.prepare(
    "INSERT INTO users (username, password_hash, role, roster_id, needs_password) VALUES (?, ?, 'self', ?, 0)"
  );

  const created = [];
  const skipped = [];

  for (const person of rosterRows) {
    const existing = db.prepare('SELECT 1 FROM users WHERE roster_id = ?').get(person.id);
    if (existing) continue;

    const mobile = normalizeMobile(person.mobile);
    if (!mobile) {
      skipped.push({ name: person.name, reason: 'no mobile number on file' });
      continue;
    }

    const username = uniqueUsername(mobile);
    const usedDefaultPassword = !person.date_of_birth;
    const password = usedDefaultPassword ? DEFAULT_PASSWORD_NO_DOB : dobToPassword(person.date_of_birth);
    insert.run(username, bcrypt.hashSync(password, 10), person.id);
    created.push({ name: person.name, username, password, usedDefaultPassword });
  }

  return { created, skipped };
}

module.exports = { provisionSelfAccounts };
