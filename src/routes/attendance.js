const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireLogin, blockSelfRole } = require('../auth');
const { isWorkingDay } = require('../lib/workingDays');
const { getCycleRange } = require('../lib/settings');
const { activeRosterForDate, getPhaseStagger, filterRosterForEditor, getExcludedFromStrength } = require('../lib/roster');
const { submitOne } = require('../lib/attendanceSubmit');
const { REPORT_LINES, canConfirmLine, canConfirmAll } = require('../lib/reportLines');
const { getConfirmedLines, isDayFullyConfirmed, confirmLine, confirmAllLines } = require('../lib/reportConfirmations');
const { formatOffPeriod } = require('../lib/offPeriod');

const router = express.Router();

const attachmentsDir = path.join(__dirname, '..', '..', 'data', 'attachments');
if (!fs.existsSync(attachmentsDir)) fs.mkdirSync(attachmentsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: attachmentsDir,
    filename: (req, file, cb) => {
      cb(null, `${req.params.id}-${Date.now()}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function todayStr() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

// Keys must match summary.stats' field names — the client-side drill-down
// (public/summary.js) filters this per-person index by whichever one was
// clicked.
const PERSONNEL_CATEGORIES = [
  'reported',
  'present',
  'offApproved',
  'offPending',
  'mc',
  'outproApproved',
  'outproPending',
  'conflicts',
];

function buildPersonnelIndex(summary) {
  return summary.rows.map((row) => ({
    id: row.person.id,
    name: row.person.name,
    rank: row.person.ref_id || '',
    group: row.person.group_code || '',
    categories: {
      reported: !row.unreported,
      present: row.status === 'present',
      offApproved: row.status === 'off' && row.approvalState === 'approved',
      offPending: row.status === 'off' && row.approvalState === 'pending',
      mc: row.status === 'mc',
      outproApproved: row.status === 'outpro' && row.approvalState === 'approved',
      outproPending: row.status === 'outpro' && row.approvalState === 'pending',
      conflicts: row.conflict,
    },
  }));
}

router.get('/attendance', requireLogin, blockSelfRole, (req, res) => {
  const date = req.query.date || todayStr();
  const cycle = getCycleRange();

  if (!isWorkingDay(date)) {
    return res.render('attendance', {
      date,
      rows: [],
      todayStr: todayStr(),
      saved: false,
      hasSubmitted: false,
      lastSubmittedAt: null,
      weekendBlocked: true,
      cycle,
    });
  }

  const roster = filterRosterForEditor(activeRosterForDate(date), req.session.user.username);

  const mySubs = db
    .prepare('SELECT * FROM attendance_submissions WHERE date = ? AND user_id = ?')
    .all(date, req.session.user.id);
  const mySubsByRoster = new Map(mySubs.map((s) => [s.roster_id, s]));

  const rows = roster.map((person) => ({
    person,
    existing: mySubsByRoster.get(person.id) || null,
  }));

  const hasSubmitted = mySubs.length > 0;
  const lastSubmittedAt = hasSubmitted
    ? mySubs.reduce((latest, s) => (s.submitted_at > latest ? s.submitted_at : latest), mySubs[0].submitted_at)
    : null;

  res.render('attendance', {
    date,
    rows,
    todayStr: todayStr(),
    saved: req.query.saved === '1',
    hasSubmitted,
    lastSubmittedAt,
    weekendBlocked: false,
    cycle,
    phaseStagger: getPhaseStagger(date),
  });
});

router.post('/attendance', requireLogin, blockSelfRole, (req, res) => {
  const date = req.body.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).render('error', { message: 'Invalid date.' });
  }
  if (!isWorkingDay(date)) {
    return res.status(400).render('error', { message: 'Weekends do not require attendance and cannot be saved.' });
  }

  const roster = filterRosterForEditor(activeRosterForDate(date), req.session.user.username);

  const tx = db.transaction(() => {
    for (const person of roster) {
      const status = req.body[`status_${person.id}`];
      if (!status) continue; // person left unmarked this submission

      submitOne({
        date,
        rosterId: person.id,
        submitterId: req.session.user.id,
        submitterRole: req.session.user.role,
        submitterUsername: req.session.user.username,
        status,
        offPeriod: req.body[`off_period_${person.id}`],
        offTime: req.body[`off_time_${person.id}`],
        offTimeEnd: req.body[`off_time_end_${person.id}`],
        remarks: req.body[`remarks_${person.id}`],
      }); // per-person validation failures (e.g. missing off period) are silently skipped, same as before
    }
  });
  tx();

  res.redirect(`/attendance?date=${encodeURIComponent(date)}&saved=1`);
});

router.post('/attendance/submission/:id/attachment', requireLogin, (req, res, next) => {
  const submission = db.prepare('SELECT * FROM attendance_submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.status(404).render('error', { message: 'Submission not found.' });
  if (submission.status !== 'mc') {
    return res.status(400).render('error', { message: 'Attachments are only accepted for MC entries.' });
  }
  const me = db.prepare('SELECT roster_id FROM users WHERE id = ?').get(req.session.user.id);
  const isOwner =
    submission.user_id === req.session.user.id ||
    (me.roster_id != null && me.roster_id === submission.roster_id);
  if (!isOwner && req.session.user.role !== 'admin') {
    return res.status(403).render('error', { message: "You can only attach a file to your own submissions." });
  }
  req.submission = submission;
  next();
}, upload.single('attachment'), (req, res) => {
  if (!req.file) return res.status(400).render('error', { message: 'No file uploaded.' });
  const submission = req.submission;
  db.prepare('UPDATE attendance_submissions SET attachment_path = ? WHERE id = ?').run(
    req.file.path,
    req.params.id
  );

  // Optional: the same certificate can cover a run of consecutive MC days —
  // fills in any of this same submitter's later MC entries for this person
  // that don't already have their own attachment, without touching ones
  // that do (e.g. a different certificate for a separate MC period).
  const throughDate = req.body.throughDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(throughDate || '') && throughDate > submission.date) {
    db.prepare(
      `UPDATE attendance_submissions
       SET attachment_path = ?
       WHERE roster_id = ? AND user_id = ? AND status = 'mc' AND attachment_path IS NULL
         AND date > ? AND date <= ?`
    ).run(req.file.path, submission.roster_id, submission.user_id, submission.date, throughDate);
  }

  res.redirect(req.body.returnTo || `/summary?date=${encodeURIComponent(req.body.returnDate || '')}`);
});

router.get('/attendance/attachment/:id', requireLogin, (req, res) => {
  const submission = db.prepare('SELECT * FROM attendance_submissions WHERE id = ?').get(req.params.id);
  if (!submission || !submission.attachment_path) {
    return res.status(404).render('error', { message: 'No attachment found.' });
  }
  res.sendFile(submission.attachment_path);
});

router.get('/summary', requireLogin, blockSelfRole, (req, res) => {
  const date = req.query.date || todayStr();
  const cycle = getCycleRange();

  if (!isWorkingDay(date)) {
    return res.render('summary', { summary: null, date, todayStr: todayStr(), weekendBlocked: true, cycle, confirmation: null, formatOffPeriod, excluded: [], personnelIndex: [], initialCategory: null });
  }

  const { getDailySummary } = require('../lib/merge');
  const summary = getDailySummary(date);

  const confirmedLines = getConfirmedLines(date);
  const confirmation = {
    lines: REPORT_LINES.map(({ key, label }) => ({
      key,
      label,
      confirmed: confirmedLines.has(key),
      canConfirm: canConfirmLine(req.session.user.username, key),
    })),
    fullyConfirmed: isDayFullyConfirmed(date),
    canConfirmAll: canConfirmAll(req.session.user.username),
  };

  res.render('summary', {
    summary,
    date,
    todayStr: todayStr(),
    weekendBlocked: false,
    cycle,
    isAdmin: req.session.user.role === 'admin',
    phaseStagger: getPhaseStagger(date),
    confirmation,
    formatOffPeriod,
    excluded: getExcludedFromStrength(date),
    personnelIndex: buildPersonnelIndex(summary),
    initialCategory: PERSONNEL_CATEGORIES.includes(req.query.category) ? req.query.category : null,
  });
});

router.post('/summary/confirm-line', requireLogin, blockSelfRole, (req, res) => {
  const { date, line } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !REPORT_LINES.some((l) => l.key === line)) {
    return res.status(400).render('error', { message: 'Invalid date or line.' });
  }
  if (!canConfirmLine(req.session.user.username, line)) {
    return res.status(403).render('error', { message: "You're not permitted to confirm that line." });
  }
  confirmLine(date, line, req.session.user.id);
  res.redirect(`/summary?date=${encodeURIComponent(date)}`);
});

router.post('/summary/confirm-all', requireLogin, blockSelfRole, (req, res) => {
  const { date } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).render('error', { message: 'Invalid date.' });
  }
  if (!canConfirmAll(req.session.user.username)) {
    return res.status(403).render('error', { message: 'Only an unrestricted account (e.g. BC/BSM/B2IC) can confirm everything at once.' });
  }
  confirmAllLines(date, req.session.user.id);
  res.redirect(`/summary?date=${encodeURIComponent(date)}`);
});

module.exports = router;
