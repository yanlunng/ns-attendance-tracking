const ExcelJS = require('exceljs');

const NAME_HEADERS = ['name', 'full name', 'fullname', 'complete name', 'nominal roll', 'personnel'];
const ID_HEADERS = ['id', 'ref id', 'staff id', 'rank', 'rank/id', 'employee id', 'nric'];
const UNIT_HEADERS = ['unit', 'department', 'dept', 'section', 'team'];
const DOB_HEADERS = ['date of birth', 'dob', 'd.o.b', 'birthdate', 'birth date'];
const GROUP_SOURCE_HEADERS = ['subunit-1', 'sub unit 1', 'sub-unit 1', 'subunit 1'];
const DEFERMENT_HEADERS = ['deferment status'];
const MOBILE_HEADERS = ['mobile', 'mobile number', 'mobile no', 'handphone', 'hp', 'contact'];
const PHASE_HEADERS = ['phases', 'phase'];
const POSITION_HEADERS = ['position descr', 'position'];

// Sheet names preferred over "just take the first sheet", checked case-insensitively.
const PREFERRED_SHEET_NAMES = ['ehrnominal'];

const GROUP_CODES = ['KAH', 'RBS', 'PSTAR', 'FP'];

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

/** Unwraps ExcelJS formula-cell objects ({formula, result}) and rich text; returns plain text. */
function cellText(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return value.result != null ? String(value.result) : null;
    if ('text' in value) return String(value.text);
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    return null;
  }
  return String(value);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Parses "27/12/1997" (DD/MM/YYYY) or a native Excel date cell into "1997-12-27". */
function parseDob(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const str = String(value).trim();
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
  }
  const iso = str.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return null;
}

/** KAH/RBS/PSTAR/FP appear as substrings of the Sub Unit 1 text, e.g. "RBS ADA BTY (NS)-A BTY". */
function deriveGroup(subunit1Text) {
  if (!subunit1Text) return null;
  const upper = String(subunit1Text).toUpperCase();
  return GROUP_CODES.find((code) => upper.includes(code)) || null;
}

/** True if the sheet's Deferment Status column text mentions "deferred". */
function deriveDeferred(defermentStatusText) {
  if (!defermentStatusText) return false;
  return String(defermentStatusText).toUpperCase().includes('DEFERRED');
}

/** Everyone not explicitly in "Commander Phase" is treated as Main Body. */
function deriveCommanderPhase(phaseText) {
  if (!phaseText) return false;
  return String(phaseText).toUpperCase().includes('COMMANDER');
}

function findHeaderRow(sheet) {
  for (let rowNumber = 1; rowNumber <= 3; rowNumber++) {
    const headers = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber] = normalizeHeader(cell.value);
    });
    if (headers.some((h) => NAME_HEADERS.includes(h))) {
      return { rowNumber, headers };
    }
  }
  return null;
}

function pickSheet(workbook) {
  const preferred = workbook.worksheets.find((ws) =>
    PREFERRED_SHEET_NAMES.includes(String(ws.name || '').trim().toLowerCase())
  );
  return preferred || workbook.worksheets[0];
}

/**
 * Parses an uploaded nominal-roll workbook. Prefers a sheet named "ehrNominal"
 * (the richer HR export format, header on row 2) over the first sheet; scans
 * the first few rows of whichever sheet is used to find the header row. A
 * "Name" column (or close variant) is required; ID/Unit/DOB/Sub-Unit columns
 * are optional; any other columns are kept as free-form "extra" data so
 * nothing from the sheet is silently dropped.
 */
async function parseRosterWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = pickSheet(workbook);
  if (!sheet) throw new Error('Workbook has no sheets.');

  const found = findHeaderRow(sheet);
  if (!found) {
    throw new Error('Could not find a "Name" column in the first few rows of the sheet.');
  }
  const { rowNumber: headerRowNumber, headers } = found;

  const nameCol = headers.findIndex((h) => NAME_HEADERS.includes(h));
  const idCol = headers.findIndex((h) => ID_HEADERS.includes(h));
  const unitCol = headers.findIndex((h) => UNIT_HEADERS.includes(h));
  const dobCol = headers.findIndex((h) => DOB_HEADERS.includes(h));
  const subunit1Col = headers.findIndex((h) => GROUP_SOURCE_HEADERS.includes(h));
  const defermentCol = headers.findIndex((h) => DEFERMENT_HEADERS.includes(h));
  const mobileCol = headers.findIndex((h) => MOBILE_HEADERS.includes(h));
  const phaseCol = headers.findIndex((h) => PHASE_HEADERS.includes(h));
  const positionCol = headers.findIndex((h) => POSITION_HEADERS.includes(h));
  const mappedCols = new Set(
    [nameCol, idCol, unitCol, dobCol, subunit1Col, defermentCol, mobileCol, phaseCol, positionCol].filter(
      (c) => c !== -1
    )
  );

  const people = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const name = cellText(row.getCell(nameCol).value)?.trim() || '';
    if (!name) return; // skip blank rows

    const extra = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (mappedCols.has(colNumber)) return;
      const header = headers[colNumber];
      const text = cellText(cell.value);
      if (header && text != null) extra[header] = text;
    });

    const subunit1 = subunit1Col !== -1 ? cellText(row.getCell(subunit1Col).value) : null;
    const defermentText = defermentCol !== -1 ? cellText(row.getCell(defermentCol).value) : null;
    const phaseText = phaseCol !== -1 ? cellText(row.getCell(phaseCol).value) : null;

    people.push({
      name,
      ref_id: idCol !== -1 ? cellText(row.getCell(idCol).value) : null,
      unit: unitCol !== -1 ? cellText(row.getCell(unitCol).value) : null,
      date_of_birth: dobCol !== -1 ? parseDob(row.getCell(dobCol).value) : null,
      mobile: mobileCol !== -1 ? cellText(row.getCell(mobileCol).value) : null,
      subunit1_raw: subunit1,
      group_code: deriveGroup(subunit1),
      is_deferred: deriveDeferred(defermentText) ? 1 : 0,
      is_commander_phase: deriveCommanderPhase(phaseText) ? 1 : 0,
      position_descr: positionCol !== -1 ? cellText(row.getCell(positionCol).value) : null,
      extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
    });
  });

  if (people.length === 0) {
    throw new Error('No rows with a name were found under the header row.');
  }

  return people;
}

module.exports = { parseRosterWorkbook, deriveGroup, GROUP_CODES };
