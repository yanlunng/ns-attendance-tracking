const express = require('express');
const { requireLogin, requireEditor, blockSelfRole } = require('../auth');
const { GROUP_CODES } = require('../lib/rosterImport');
const { getBoard, assignPerson } = require('../lib/outfield');

const router = express.Router();

router.get('/outfield', requireLogin, blockSelfRole, (req, res) => {
  const group = GROUP_CODES.includes(req.query.group) ? req.query.group : 'RBS';
  const board = getBoard(group);
  res.render('outfield', {
    group,
    groups: GROUP_CODES,
    board,
    canEdit: ['admin', 'editor'].includes(req.session.user.role),
  });
});

router.post('/outfield/assign', requireEditor, (req, res) => {
  const personId = Number(req.body.personId);
  const sectionId = Number(req.body.sectionId);
  const slot = req.body.slot || null;

  if (!personId || !sectionId) return res.status(400).json({ error: 'Missing personId or sectionId.' });

  try {
    assignPerson(personId, sectionId, slot);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
