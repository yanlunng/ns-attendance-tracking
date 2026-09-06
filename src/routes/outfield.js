const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireLogin, requireEditor, blockSelfRole } = require('../auth');
const { getBoard, assignPerson, OUTFIELD_GROUPS } = require('../lib/outfield');
const { listKahDesignations, addKahDesignation, removeKahDesignation } = require('../lib/kahDesignations');
const { buildOutfieldTemplateWorkbook, importOutfieldTemplateWorkbook } = require('../lib/outfieldTemplate');

const router = express.Router();
const uploadTemplate = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/outfield', requireLogin, blockSelfRole, (req, res) => {
  const group = OUTFIELD_GROUPS.includes(req.query.group) ? req.query.group : 'RBS';
  const canEdit = ['admin', 'editor'].includes(req.session.user.role);
  const importError = req.query.importError || null;

  if (group === 'KAH') {
    return res.render('outfield', {
      group,
      groups: OUTFIELD_GROUPS,
      board: null,
      kahDesignations: listKahDesignations(),
      fullRoster: db.prepare('SELECT id, name, ref_id FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE').all(),
      canEdit,
      kahError: req.query.error || null,
      importError,
    });
  }

  const board = getBoard(group === 'Others' ? 'HQ' : group);
  res.render('outfield', { group, groups: OUTFIELD_GROUPS, board, kahDesignations: null, fullRoster: null, canEdit, kahError: null, importError });
});

router.post('/outfield/kah/add', requireEditor, (req, res) => {
  const rosterId = Number(req.body.rosterId);
  const roleText = (req.body.roleText || '').trim();

  if (!rosterId || !roleText) {
    return res.redirect('/outfield?group=KAH&error=' + encodeURIComponent('Pick a person and enter a role.'));
  }

  try {
    addKahDesignation(rosterId, roleText);
    res.redirect('/outfield?group=KAH');
  } catch (err) {
    res.redirect('/outfield?group=KAH&error=' + encodeURIComponent(err.message));
  }
});

router.post('/outfield/kah/:id/remove', requireEditor, (req, res) => {
  removeKahDesignation(req.params.id);
  res.redirect('/outfield?group=KAH');
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

router.get('/outfield/export', requireLogin, blockSelfRole, async (req, res) => {
  const workbook = await buildOutfieldTemplateWorkbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="outfield_designation.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

router.post('/outfield/import', requireEditor, uploadTemplate.single('file'), async (req, res) => {
  if (!req.file) {
    return res.redirect('/outfield?importError=' + encodeURIComponent('No file uploaded.'));
  }
  try {
    const results = await importOutfieldTemplateWorkbook(req.file.buffer);
    res.render('outfield-import-result', { results });
  } catch (err) {
    res.redirect('/outfield?importError=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
