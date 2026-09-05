const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');
const { isWorkingDay } = require('../lib/workingDays');
const { getDailySummary } = require('../lib/merge');
const { REPORT_LINES, canConfirmLine } = require('../lib/reportLines');
const { getConfirmedLines } = require('../lib/reportConfirmations');

const router = express.Router();

function todayStr() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

// The landing page after login — a role-aware "what can I do here" dashboard
// instead of dropping straight into Mark Attendance. Self accounts (no
// editing rights) go straight to their own read-only view instead.
router.get('/', requireLogin, (req, res) => {
  if (req.session.user.role === 'self') return res.redirect('/my-attendance');

  const date = todayStr();
  const workingDay = isWorkingDay(date);
  const summary = workingDay ? getDailySummary(date) : null;

  const pendingApprovals =
    req.session.user.role === 'admin'
      ? db.prepare("SELECT COUNT(*) AS c FROM attendance_submissions WHERE approval_status = 'pending'").get().c
      : 0;

  let unconfirmedLines = [];
  if (workingDay) {
    const confirmedLines = getConfirmedLines(date);
    unconfirmedLines = REPORT_LINES.filter(
      ({ key }) => !confirmedLines.has(key) && canConfirmLine(req.session.user.username, key)
    );
  }

  res.render('home', {
    date,
    workingDay,
    summary,
    pendingApprovals,
    unconfirmedLines,
  });
});

module.exports = router;
