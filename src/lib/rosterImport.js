const ExcelJS = require('exceljs');

const NAME_HEADERS = ['name', 'full name', 'fullname', 'complete name', 'nominal roll', 'personnel'];
const ID_HEADERS = ['id', 'ref id', 'staff id', 'rank', 'rank/id', 'employee id', 'nric'];
const UNIT_HEADERS = ['unit', 'department', 'dept', 'section', 'team'];

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

/**
 * Parses an uploaded nominal-roll workbook.
 * Expects a header row on the first sheet. A "Name" column (or close variant)
 * is required; ID/Unit columns are optional; any other columns are kept as
 * free-form "extra" data so nothing from the sheet is silently dropped.
 */
async function parseRosterWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook has no sheets.');

  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = normalizeHeader(cell.value);
  });

  const nameCol = headers.findIndex((h) => NAME_HEADERS.includes(h));
  if (nameCol === -1) {
    throw new Error(
      `Could not find a "Name" column. Detected headers: ${headers.filter(Boolean).join(', ') || '(none)'}`
    );
  }
  const idCol = headers.findIndex((h) => ID_HEADERS.includes(h));
  const unitCol = headers.findIndex((h) => UNIT_HEADERS.includes(h));

  const people = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const nameCell = row.getCell(nameCol);
    const name = nameCell.value ? String(nameCell.value).trim() : '';
    if (!name) return; // skip blank rows

    const extra = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber === nameCol || colNumber === idCol || colNumber === unitCol) return;
      const header = headers[colNumber];
      if (header) extra[header] = cell.value != null ? String(cell.value) : '';
    });

    people.push({
      name,
      ref_id: idCol !== -1 ? (row.getCell(idCol).value != null ? String(row.getCell(idCol).value) : null) : null,
      unit: unitCol !== -1 ? (row.getCell(unitCol).value != null ? String(row.getCell(unitCol).value) : null) : null,
      extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
    });
  });

  if (people.length === 0) {
    throw new Error('No rows with a name were found under the header row.');
  }

  return people;
}

module.exports = { parseRosterWorkbook };
