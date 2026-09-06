const ExcelJS = require('exceljs');
const db = require('../db');
const { GROUP_CODES } = require('./rosterImport');

function normalizeName(name) {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function matchKey(name, dob) {
  if (!dob) return null; // DOB is required for a match — no name-only fallback
  return `${normalizeName(name)}|${dob}`;
}

/**
 * Re-applies a previously exported Battery Establishment workbook onto the
 * current roster. Matches by Name + Date of Birth. Only touches people
 * whose group is still auto-derived (group_source != 'manual') — never
 * overwrites a manual designation someone has already set, and anyone who
 * no longer matches the current active roster is skipped, not an error.
 *
 * Mainly useful when a new NR carries stale/wrong battery data for
 * continuing people: repairing group_code here first means the Outfield
 * Designation import (which is scoped per-group) can then actually find
 * them again.
 */
async function importEstablishmentWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Battery Establishment');
  if (!sheet) throw new Error('Expected a "Battery Establishment" sheet — is this the right file?');

  const current = db.prepare('SELECT * FROM roster WHERE active = 1').all();
  const byKey = new Map();
  const ambiguousKeys = new Set();
  for (const person of current) {
    const key = matchKey(person.name, person.date_of_birth);
    if (!key) continue;
    if (byKey.has(key)) ambiguousKeys.add(key);
    byKey.set(key, person);
  }

  const updateStmt = db.prepare("UPDATE roster SET group_code = ?, group_source = 'manual' WHERE id = ?");

  const placed = [];
  const skipped = [];

  let rowNum = 0;
  sheet.eachRow((row) => {
    rowNum++;
    if (rowNum === 1) return; // header

    const name = String(row.getCell(1).value || '').trim();
    const refId = String(row.getCell(2).value || '').trim();
    const groupCell = String(row.getCell(5).value || '').trim();
    const dobCell = row.getCell(7).value;
    const dob = dobCell instanceof Date ? dobCell.toISOString().slice(0, 10) : String(dobCell || '').trim();
    if (!name) return;

    const base = { name, ref_id: refId, importedGroup: groupCell || 'Unassigned' };

    const key = matchKey(name, dob);
    const person = key && !ambiguousKeys.has(key) ? byKey.get(key) : null;
    if (!person) {
      skipped.push({ ...base, reason: 'Not found in the current active roster' });
      return;
    }
    if (person.group_source === 'manual') {
      skipped.push({ ...base, reason: 'Already has a manual designation set — not overwritten' });
      return;
    }

    const newGroup = groupCell && groupCell !== 'Unassigned' ? groupCell : null;
    if (newGroup && !GROUP_CODES.includes(newGroup)) {
      skipped.push({ ...base, reason: `Unrecognized group "${groupCell}"` });
      return;
    }

    updateStmt.run(newGroup, person.id);
    placed.push(base);
  });

  return { placed, skipped };
}

module.exports = { importEstablishmentWorkbook };
