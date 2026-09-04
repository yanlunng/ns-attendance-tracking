const express = require('express');
const { requireLogin } = require('../auth');
const { getDailySummary } = require('../lib/merge');
const { buildSummaryWorkbook } = require('../lib/exportXlsx');

const router = express.Router();

router.get('/export', requireLogin, async (req, res) => {
  const date = req.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).render('error', { message: 'Invalid or missing date.' });
  }
  const summary = getDailySummary(date);
  const workbook = await buildSummaryWorkbook(summary);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${date}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
