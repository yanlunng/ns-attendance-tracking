const ExcelJS = require('exceljs');

const STATUS_LABEL = { present: 'Present', off: 'Off', leave: 'Leave' };

async function buildSummaryWorkbook(summary) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Attendance ${summary.date}`);

  sheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'ID', key: 'ref_id', width: 14 },
    { header: 'Unit', key: 'unit', width: 18 },
    { header: 'Merged Status', key: 'status', width: 16 },
    { header: 'Conflict?', key: 'conflict', width: 10 },
    { header: 'Submitted By', key: 'submitters', width: 30 },
    { header: 'Details', key: 'details', width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of summary.rows) {
    const details = row.submissions
      .map((s) => `${s.username}: ${STATUS_LABEL[s.status]}${s.remarks ? ` (${s.remarks})` : ''}`)
      .join('; ');

    const excelRow = sheet.addRow({
      name: row.person.name,
      ref_id: row.person.ref_id || '',
      unit: row.person.unit || '',
      status: row.unreported ? 'NOT REPORTED' : row.conflict ? 'CONFLICT' : STATUS_LABEL[row.status],
      conflict: row.conflict ? 'YES' : '',
      submitters: row.submissions.map((s) => s.username).join(', '),
      details,
    });

    if (row.conflict || row.unreported) {
      excelRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: row.conflict ? 'FFFFC7CE' : 'FFFFEB9C' },
        };
      });
    }
  }

  return workbook;
}

module.exports = { buildSummaryWorkbook };
