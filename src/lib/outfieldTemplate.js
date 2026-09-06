const ExcelJS = require('exceljs');
const db = require('../db');
const { getBoard, eligibleRosterForGroups, assignPerson } = require('./outfield');

// Only groups with a real (non-flat) slot structure have anything worth
// exporting/importing — PCP is currently flatPool (roles TBD, see
// PLATOON_STRUCTURE.PCP) and has no fixed slots yet. Once it gets real
// slots, adding it here is all that's needed.
const TEMPLATE_GROUPS = ['RBS', 'FP', 'PSTAR'];

function normalizeName(name) {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function matchKey(name, dob) {
  if (!dob) return null; // DOB is required for a match — no name-only fallback
  return `${normalizeName(name)}|${dob}`;
}

// getBoard() auto-drops any unplaced-but-eligible person into the group's
// staging "Unassigned" pool as a side effect of just reading the board — so
// a non-null outfield_section_id alone doesn't mean "really placed". Only a
// real (non-staging) section counts.
function isReallyPlaced(sectionId) {
  if (sectionId == null) return false;
  const section = db.prepare('SELECT is_staging FROM outfield_sections WHERE id = ?').get(sectionId);
  return !!section && section.is_staging === 0;
}

/**
 * One workbook, one sheet per slot-based group, one row per currently
 * filled slot. Includes Date of Birth (already stored/used internally for
 * roster identity matching) so a later import can match people back up
 * even after a roster re-upload changes their internal id.
 */
async function buildOutfieldTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();

  for (const groupCode of TEMPLATE_GROUPS) {
    const board = getBoard(groupCode);
    const sheet = workbook.addWorksheet(groupCode);
    sheet.columns = [
      { header: 'Platoon', key: 'platoon', width: 14 },
      { header: 'Section', key: 'section', width: 16 },
      { header: 'Slot', key: 'slot', width: 18 },
      { header: 'Rank/ID', key: 'ref_id', width: 12 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Date of Birth', key: 'dob', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const platoon of board.platoons) {
      if (!platoon.sections) continue; // flatPool groups have no slots to export
      for (const section of platoon.sections) {
        for (const [slot, person] of Object.entries(section.slots)) {
          if (!person) continue;
          sheet.addRow({
            platoon: platoon.name,
            section: section.name,
            slot,
            ref_id: person.ref_id || '',
            name: person.name,
            dob: person.date_of_birth || '',
          });
        }
      }
    }
  }

  return workbook;
}

/**
 * Re-applies a previously exported workbook onto the current board. Purely
 * additive: matches each row to a currently eligible roster member by Name
 * + Date of Birth, then places them ONLY if the target slot is empty AND
 * they aren't already placed anywhere else on the board — never overwrites
 * an occupied slot, and never moves someone out of a slot they're already
 * in. Anyone from the old file who no longer matches (left, deferred, ICT
 * cancelled, changed group, etc.) is simply skipped, not an error.
 */
async function importOutfieldTemplateWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const placed = [];
  const skipped = [];

  for (const groupCode of TEMPLATE_GROUPS) {
    const sheet = workbook.getWorksheet(groupCode);
    if (!sheet) continue;

    const board = getBoard(groupCode);
    const sectionsByPlatoonName = new Map();
    for (const platoon of board.platoons) {
      if (platoon.sections) sectionsByPlatoonName.set(platoon.name, new Map(platoon.sections.map((s) => [s.name, s])));
    }

    const eligible = eligibleRosterForGroups([groupCode]);
    const byKey = new Map();
    const ambiguousKeys = new Set();
    for (const person of eligible) {
      const key = matchKey(person.name, person.date_of_birth);
      if (!key) continue;
      if (byKey.has(key)) ambiguousKeys.add(key);
      byKey.set(key, person);
    }

    const filledThisRun = new Set(); // `${sectionId}:${slot}` — guards duplicate rows in one import
    const placedPersonIds = new Set();

    let rowNum = 0;
    sheet.eachRow((row) => {
      rowNum++;
      if (rowNum === 1) return; // header

      const platoonName = String(row.getCell(1).value || '').trim();
      const sectionName = String(row.getCell(2).value || '').trim();
      const slot = String(row.getCell(3).value || '').trim();
      const name = String(row.getCell(5).value || '').trim();
      const dobCell = row.getCell(6).value;
      const dob = dobCell instanceof Date ? dobCell.toISOString().slice(0, 10) : String(dobCell || '').trim();
      if (!name) return;

      const base = { groupCode, platoon: platoonName, section: sectionName, slot, name };

      const key = matchKey(name, dob);
      const person = key && !ambiguousKeys.has(key) ? byKey.get(key) : null;
      if (!person) {
        skipped.push({ ...base, reason: 'Not found in the current eligible roster for this group' });
        return;
      }
      if (placedPersonIds.has(person.id)) {
        skipped.push({ ...base, reason: 'Duplicate row for this person in the file' });
        return;
      }
      if (isReallyPlaced(person.outfield_section_id)) {
        skipped.push({ ...base, reason: 'Already placed elsewhere on the board' });
        return;
      }

      const section = sectionsByPlatoonName.get(platoonName)?.get(sectionName);
      if (!section || !(slot in section.slots)) {
        skipped.push({ ...base, reason: 'That platoon/section/slot no longer exists' });
        return;
      }

      const slotKey = `${section.id}:${slot}`;
      if (section.slots[slot] || filledThisRun.has(slotKey)) {
        skipped.push({ ...base, reason: 'Slot is already occupied' });
        return;
      }

      assignPerson(person.id, section.id, slot);
      filledThisRun.add(slotKey);
      placedPersonIds.add(person.id);
      placed.push({ ...base, ref_id: person.ref_id || '' });
    });
  }

  return { placed, skipped };
}

module.exports = { buildOutfieldTemplateWorkbook, importOutfieldTemplateWorkbook };
