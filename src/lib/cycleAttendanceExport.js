const ExcelJS = require('exceljs');
const db = require('../db');
const { formatOffPeriod } = require('./offPeriod');
const { isWorkingDay } = require('./workingDays');
const { getDailySummary } = require('./merge');

const FILL = {
  present: 'FFC6EFCE', // green
  absent: 'FFFFC7CE', // red (Off / MC)
  conflict: 'FFFFEB9C', // amber
  unreported: 'FFD9D9D9', // grey
  notTracked: 'FFF2F2F2', // very light grey
};

function dateRange(fromDate, toDate) {
  const dates = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    if (isWorkingDay(iso)) dates.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function headerLabel(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/** { text, fill } for one person's cell on one date, given that date's getDailySummary row (or undefined if they weren't tracked that date at all). */
function cellFor(row) {
  if (!row) return { text: '–', fill: FILL.notTracked };
  if (row.unreported) return { text: '', fill: FILL.unreported };
  if (row.conflict) return { text: 'CONFLICT', fill: FILL.conflict };
  if (row.status === 'off') {
    return { text: formatOffPeriod(row.offPeriod, row.offTime, row.offTimeEnd), fill: FILL.absent };
  }
  if (row.status === 'mc') {
    return { text: row.missingAttachment ? 'MC!' : 'MC', fill: FILL.absent };
  }
  if (row.status === 'outpro') return { text: 'OUT', fill: FILL.present };
  return { text: '✓', fill: FILL.present }; // present
}

/**
 * One sheet: every roster member as a row, every working day in the given
 * range as a column, colour-coded per cellFor() above. A person not in that
 * date's activeRosterForDate() result (deferred, not yet in Main Body
 * Phase, past an approved outpro, or past their ICT-cancelled date) reads
 * as "–" (not tracked), distinct from "" (tracked but nobody reported).
 */
async function buildCycleAttendanceWorkbook(fromDate, toDate) {
  const dates = dateRange(fromDate, toDate);
  const roster = db.prepare('SELECT id, name, ref_id, group_code FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE').all();

  // rowsByDate[date] = Map(roster_id -> summary row), built once per date.
  const rowsByDate = new Map();
  for (const date of dates) {
    const { rows } = getDailySummary(date);
    rowsByDate.set(date, new Map(rows.map((r) => [r.person.id, r])));
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Cycle Attendance');

  sheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Rank', key: 'ref_id', width: 10 },
    { header: 'Group', key: 'group_code', width: 10 },
    ...dates.map((iso) => ({ header: headerLabel(iso), key: iso, width: 8 })),
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 + dates.length } };
  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

  for (const person of roster) {
    const cells = dates.map((iso) => cellFor(rowsByDate.get(iso).get(person.id)));
    const rowValues = { name: person.name, ref_id: person.ref_id || '', group_code: person.group_code || '' };
    dates.forEach((iso, i) => { rowValues[iso] = cells[i].text; });
    const excelRow = sheet.addRow(rowValues);

    dates.forEach((iso, i) => {
      const cell = excelRow.getCell(4 + i);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cells[i].fill } };
      cell.alignment = { horizontal: 'center' };
    });
  }

  return workbook;
}

module.exports = { buildCycleAttendanceWorkbook };
