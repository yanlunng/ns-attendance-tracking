const ExcelJS = require('exceljs');

const STATUS_LABEL = { present: 'Present', off: 'Off', mc: 'MC', outpro: '1st Day Outpro' };

function formatStatus(s) {
  if (s.status === 'off') {
    const period = s.off_period === 'TIME' ? `from ${s.off_time}` : s.off_period;
    return `Off (${period}, ${s.approval_status})`;
  }
  if (s.status === 'outpro') return `1st Day Outpro (${s.approval_status})`;
  return STATUS_LABEL[s.status] || s.status;
}

async function buildSummaryWorkbook(summary) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Attendance ${summary.date}`);

  sheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Rank', key: 'ref_id', width: 14 },
    { header: 'Unit', key: 'unit', width: 18 },
    { header: 'Merged Status', key: 'status', width: 22 },
    { header: 'Conflict?', key: 'conflict', width: 10 },
    { header: 'Submitted By', key: 'submitters', width: 30 },
    { header: 'Details', key: 'details', width: 60 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of summary.rows) {
    const details = row.submissions
      .map((s) => `${s.username}: ${formatStatus(s)}${s.remarks ? ` (${s.remarks})` : ''}`)
      .join('; ');

    let mergedStatusLabel;
    if (row.unreported) mergedStatusLabel = 'NOT REPORTED';
    else if (row.conflict) mergedStatusLabel = 'CONFLICT';
    else if (row.status === 'off') {
      const period = row.offPeriod === 'TIME' ? `from ${row.offTime}` : row.offPeriod;
      mergedStatusLabel = `Off (${period}, ${row.approvalState})`;
    } else if (row.status === 'outpro') mergedStatusLabel = `1st Day Outpro (${row.approvalState})`;
    else mergedStatusLabel = STATUS_LABEL[row.status] || row.status;

    const excelRow = sheet.addRow({
      name: row.person.name,
      ref_id: row.person.ref_id || '',
      unit: row.person.unit || '',
      status: mergedStatusLabel,
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

module.exports = { buildSummaryWorkbook, buildEstablishmentWorkbook };

async function buildEstablishmentWorkbook(roster) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Battery Establishment');

  sheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Rank/ID', key: 'ref_id', width: 12 },
    { header: 'Unit', key: 'unit', width: 18 },
    { header: 'Sub Unit 1', key: 'subunit1_raw', width: 28 },
    { header: 'Group', key: 'group_code', width: 10 },
    { header: 'Group Set By', key: 'group_source', width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const person of roster) {
    sheet.addRow({
      name: person.name,
      ref_id: person.ref_id || '',
      unit: person.unit || '',
      subunit1_raw: person.subunit1_raw || '',
      group_code: person.group_code || 'Unassigned',
      group_source: person.group_source === 'manual' ? 'Manual' : 'Auto',
    });
  }

  return workbook;
}
